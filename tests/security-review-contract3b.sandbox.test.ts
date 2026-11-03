// Security review 3, "Not checked" of docs/security-review-3.md: (1) does `exit` remove the open intents and the open grants of a member, and (2) what does `prune_epoch` cost in gas
// for about 200 items. Real contract in near-sandbox (X207_SANDBOX=1). Observations go to the file named by SR3B_NOTES; the asserts say what the contract does today, and an
// `it.fails` marks a behaviour that is unsafe (none is left in this file). Run: SR3B_NOTES=/tmp/sr3b.txt X207_SANDBOX=1 npx vitest run tests/security-review-contract3b.sandbox.test.ts
import { appendFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { base58Encode, createCircleViewFn, onboardMember, signVoucher, type ContractAbi, type ContractCall } from "@x207/core";
import { KeyPair } from "@near-js/crypto";
import { TERMS_HASH, deployCircle, type CircleFixture } from "../sdk/test-support/circle.ts";
import { sandboxAvailable, type SandboxAccount } from "../sdk/test-support/sandbox.ts";
import { keeperPass } from "../scripts/lib/keeper.mjs";

const MESH = 14; // members that owe each other: 14 * 13 = 182 pairs + 14 participants = 196 prune items
const PARAMS = {
  epoch_length: 86_400, payment_window: 900, proposal_window: 60, base_limit_ratio: 8000, limit_growth: 1000, limit_cap: "1000000000", limit_decay: 0,
  fees: { clearing_fee_bps: 0, solver_fee_bps: 0 }, admission: "open",
};
const hash = (n: number): string => base58Encode(Uint8Array.from({ length: 32 }, (_, i) => (i === 31 ? n % 256 : i === 30 ? Math.floor(n / 256) : 9)));
const note = (line: string) => appendFileSync(process.env.SR3B_NOTES ?? "/dev/null", `${line}\n`);

type Member = { account: SandboxAccount; secretKey: `ed25519:${string}` };

describe.skipIf(!sandboxAvailable)("security review 3b: exit and open intents or grants, gas of prune_epoch", () => {
  let fx: CircleFixture;
  const members = new Map<string, Member>();
  const seen: Record<string, unknown> = {};
  afterAll(async () => {
    await fx?.stop();
  });

  const call = (who: SandboxAccount, methodName: string, args: object, deposit = 0n) =>
    who.call({ receiverId: fx.circle.accountId, methodName, args, deposit, gas: 200_000_000_000_000n }, "EXECUTED_OPTIMISTIC");
  const view = <T>(method: string, args: object = {}) => fx.sandbox.view<T>(fx.circle.accountId, method, args);

  async function gasBurnt(hashId: string, signer: string): Promise<bigint> {
    const response = await fetch(fx.sandbox.rpcUrl, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "EXPERIMENTAL_tx_status", params: { tx_hash: hashId, sender_account_id: signer, wait_until: "FINAL" } }),
    });
    const { result } = (await response.json()) as { result: { transaction_outcome: { outcome: { gas_burnt: number } }; receipts_outcome: Array<{ outcome: { gas_burnt: number } }> } };
    return BigInt(result.transaction_outcome.outcome.gas_burnt) + result.receipts_outcome.reduce((sum, r) => sum + BigInt(r.outcome.gas_burnt), 0n);
  }

  async function walkEpoch(epoch: number, keeper: SandboxAccount): Promise<void> {
    const pass = () =>
      keeperPass({
        view: (m: string, a: object) => view(m, a),
        chainNowMs: () => fx.sandbox.blockTimestampMs(),
        send: async ({ methodName, args }: { methodName: string; args: object }) => {
          const r = await call(fx.sandbox.accountFrom(keeper.accountId, keeper.secretKey), methodName, args);
          if (r.failures.length > 0) throw new Error(`${methodName}: ${r.failures.join("; ")}`);
          return r.hash;
        },
      });
    const settle = () => new Promise((r) => setTimeout(r, 2_000));
    const epochView = () => view<ContractAbi.EpochView>("get_epoch", { epoch });
    await fx.sandbox.advanceTo(Number(BigInt((await epochView()).cutoff_at) / 1_000_000n) + 1_000);
    await settle();
    await pass();
    await fx.sandbox.advanceTo(Number(BigInt((await epochView()).proposal_deadline!) / 1_000_000n) + 1_000);
    await settle();
    await pass();
    await fx.sandbox.advanceTo(Number(BigInt((await epochView()).payment_deadline!) / 1_000_000n) + 1_000);
    await settle();
    await pass();
    expect((await epochView()).phase).toBe("finalized");
  }

  it("TC-SR3B-01 setup: 16 members, a mesh of 182 vouchers in epoch 1, intents and grants of the member that will exit", async () => {
    fx = await deployCircle(PARAMS, { mockIntents: true });
    const chainView = createCircleViewFn({ circleContract: fx.circle.accountId, rpcUrls: [fx.sandbox.rpcUrl] });
    const join = async (name: string): Promise<void> => {
      const account = await fx.member(name);
      const joined = await onboardMember(
        { sendCall: async (c: ContractCall) => { const r = await account.call(c); if (r.failures.length > 0) throw new Error(r.failures.join("; ")); return r.value; }, view: chainView, pollIntervalMs: 200, timeoutMs: 60_000 },
        { circleContract: fx.circle.accountId, circleId: fx.circleId, accountId: account.accountId, termsHash: TERMS_HASH, stakeAmount: "50000000", usdtTokenId: fx.usdt.accountId },
      );
      members.set(name, { account, secretKey: joined.secretKey });
    };
    const names = ["exiter", "partner", ...Array.from({ length: MESH }, (_, i) => `m${i}`)];
    for (let i = 0; i < names.length; i += 4) await Promise.all(names.slice(i, i + 4).map(join));
    expect(members.size).toBe(16);

    // the mesh: each of m0..m13 owes each other one (1000 units, seq 1) in epoch 1
    const epoch = (await view<ContractAbi.EpochView>("get_epoch")).epoch;
    expect(epoch).toBe(1);
    const mesh = names.filter((n) => n.startsWith("m"));
    await Promise.all(mesh.map(async (payer) => {
      const from = members.get(payer)!;
      for (const payee of mesh.filter((n) => n !== payer)) {
        const { signature, ...voucher } = signVoucher(
          { circle: fx.circle.accountId, payer: from.account.accountId, payee: members.get(payee)!.account.accountId, epoch, seq: 1, cumulativeAmount: "1000", unit: "credit", resource: "https://seller.example/api" },
          from.secretKey,
        );
        const r = await call(from.account, "register_cumulative", { voucher, signature });
        if (r.failures.length > 0) throw new Error(`register ${payer}->${payee}: ${r.failures.join("; ")}`);
      }
    }));
    const e1 = await view<ContractAbi.EpochView>("get_epoch", { epoch: 1 });
    note(`epoch 1 before the walk: ${JSON.stringify({ edges: (e1 as any).edge_count ?? (e1 as any).edges, participants: (e1 as any).participant_count ?? (e1 as any).participants })}`);

    // the exiter: two open intents, an offered grant, and an active grant that it accepted from the partner
    const dao = await fx.sandbox.createAccount("dao", "10");
    const entry = { asset_type: "near-rpc:access", class: "B", delivery_methods: ["near_access_key"], accepted_proofs: ["rpc_access_key"], terms_hash: "ab".repeat(32) };
    expect((await call(dao, "set_asset_class", { asset_type: "near-rpc:access", entry })).failures).toEqual([]);
    const exiter = members.get("exiter")!.account;
    const partner = members.get("partner")!.account;
    const operator = await fx.sandbox.createAccount("operator", "5");
    expect((await call(exiter, "post_intent", { intent_hash: hash(3001) })).failures).toEqual([]);
    expect((await call(exiter, "post_intent", { intent_hash: hash(3002) })).failures).toEqual([]);
    const expires = ((BigInt(await fx.sandbox.blockTimestampMs()) + 30n * 86_400_000n) * 1_000_000n).toString();
    const offer = async (who: SandboxAccount): Promise<number> => {
      const scope = JSON.stringify({ receiver_id: fx.circle.accountId, method_names: ["get_params"], allowance: "1000000000000000000000000" });
      const r = await call(who, "offer_grant", { input: { asset_type: "near-rpc:access", delivery_method: "near_access_key", limits: { scope, quota: null, expires_at: expires }, unit: "day", unit_price: "1000", operator: operator.accountId, proof_hash: null, proof_kind: null } });
      expect(r.failures).toEqual([]);
      return Number(r.value);
    };
    seen.grantOffered = await offer(exiter); // offered by the exiter, nobody accepts it
    seen.grantActive = await offer(partner);
    const accepted = await call(exiter, "accept_grant", { grant_id: seen.grantActive, delivery_pubkey: KeyPair.fromRandom("ed25519").getPublicKey().toString() });
    expect(accepted.failures).toEqual([]);
    note(`grants before exit: offered ${JSON.stringify(await view("get_grant", { grant_id: seen.grantOffered }))}`);
    note(`grants before exit: active ${JSON.stringify(await view("get_grant", { grant_id: seen.grantActive }))}`);
  }, 1_500_000);

  it("TC-SR3B-02 exit: what happens to the open intents and grants of the member that left", async () => {
    const keeper = await fx.sandbox.createAccount("keeper", "20");
    const exiter = members.get("exiter")!.account;
    const partner = members.get("partner")!.account;
    expect((await call(exiter, "request_exit", {}, 1n)).failures).toEqual([]);
    await walkEpoch(1, keeper);
    const withdrawn = await call(exiter, "withdraw_stake", {}, 1n);
    note(`withdraw_stake failures ${JSON.stringify(withdrawn.failures)}`);
    expect(withdrawn.failures).toEqual([]);
    expect(await view<ContractAbi.MemberView>("member", { account_id: exiter.accountId })).toMatchObject({ status: "exited" });

    // intents
    seen.intent1 = await view("get_intent", { intent_hash: hash(3001) });
    note(`after exit: get_intent(3001) = ${JSON.stringify(seen.intent1)}`);
    const removeByOwner = await call(exiter, "remove_intent", { intent_hash: hash(3001) });
    note(`after exit: the exited owner removes its intent: ${JSON.stringify(removeByOwner.failures)}`);
    const postByExited = await call(exiter, "post_intent", { intent_hash: hash(3003) });
    note(`after exit: the exited member posts a new intent: ${JSON.stringify(postByExited.failures)}`);
    const removeByStranger = await call(partner, "remove_intent", { intent_hash: hash(3002) });
    note(`after exit: a stranger removes the intent of the exited member: ${JSON.stringify(removeByStranger.failures)}`);
    // interface 0.0.9 (ADR-41): the owner can still remove, the exited member cannot post, and anybody may remove the intents of an exited member
    expect(removeByOwner.failures).toEqual([]);
    expect(postByExited.failures.join(" ")).toContain("ERR_PAYER_NOT_ACTIVE");
    expect(removeByStranger.failures).toEqual([]);
    seen.intent2Remains = (await view("get_intent", { intent_hash: hash(3002) })) !== null;

    // grants
    seen.offeredAfter = await view("get_grant", { grant_id: seen.grantOffered });
    seen.activeAfter = await view("get_grant", { grant_id: seen.grantActive });
    note(`after exit: offered grant ${JSON.stringify(seen.offeredAfter)}`);
    note(`after exit: active grant (exited member is the grantee) ${JSON.stringify(seen.activeAfter)}`);
    const acceptFromExited = await call(partner, "accept_grant", { grant_id: seen.grantOffered, delivery_pubkey: KeyPair.fromRandom("ed25519").getPublicKey().toString() });
    note(`after exit: a member accepts a grant offered by the exited member: ${JSON.stringify(acceptFromExited.failures)}`);
    seen.acceptFromExited = acceptFromExited.failures.length === 0;
    const strangerRevoke = await call(partner, "revoke_grant", { grant_id: seen.grantActive, reason: "defaulted" });
    note(`after exit: a stranger revokes the active grant of the exited grantee as defaulted: ${JSON.stringify(strangerRevoke.failures)}`);
    seen.strangerRevokes = strangerRevoke.failures.length === 0;
    expect(strangerRevoke.failures).toEqual([]);
    expect((seen.offeredAfter as { status: string }).status).toBe("offered");
    expect((seen.activeAfter as { status: string }).status).toBe("active"); // read before the revocation above
    expect(acceptFromExited.failures.join(" ")).toContain("ERR_GRANT_NOT_ACTIVE_MEMBER");
    const heldByExited = await view<unknown[]>("grants_of", { account_id: exiter.accountId, role: "grantee", from_index: 0, limit: 10 });
    note(`after exit: grants_of(exited, grantee) = ${JSON.stringify(heldByExited)}`);
  }, 900_000);

  // Findings I-4 and I-5 are fixed in interface 0.0.9 (ADR-41, contracts 4936e58); the comments say what the contract did before.
  // Finding I-4: `exit` does not touch the intents of the member. The owner can still remove them, nobody else can, and the join deposit is not given back, so an intent of a member that left
  // pins the storage of the contract until the owner acts. The safe behaviour: the open intents of an exited member are gone (or anybody may remove them).
  it("TC-SR3B-04 [finding I-4, fixed] the open intents of a member that exited do not stay in the contract", () => {
    expect(seen.intent2Remains).toBeDefined();
    expect(seen.intent2Remains).toBe(false);
  });

  // Finding I-5a: a grant that the exited member offered is still `offered` and another member could accept it: the lessee then holds a grant whose grantor has no stake in the circle.
  it("TC-SR3B-05 [finding I-5a, fixed] a grant offered by a member that exited cannot be accepted", () => {
    expect(seen.acceptFromExited).toBeDefined();
    expect(seen.acceptFromExited).toBe(false);
  });

  // Finding I-5b: a grant that the exited member holds as grantee stays `active`, and a stranger cannot revoke it as `defaulted` (the grantee is `exited`, not `suspended`, and has no defaulted
  // position); only the grantor, the grantee, the operator or the expiry end it. The safe behaviour: anybody may end the grants of an exited grantee.
  it("TC-SR3B-06 [finding I-5b, fixed] anybody can revoke the active grants of a grantee that exited", () => {
    expect(seen.strangerRevokes).toBeDefined();
    expect(seen.strangerRevokes).toBe(true);
  });

  it("TC-SR3B-03 prune_epoch with about 200 items: gas per call and the storage given back", async () => {
    const outsider = members.get("partner")!.account;
    const e1 = await view<Record<string, unknown>>("get_epoch", { epoch: 1 });
    note(`epoch 1 record: ${JSON.stringify(e1)}`);
    const stateBytes = async () => {
      const response = await fetch(fx.sandbox.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "final", account_id: fx.circle.accountId } }) });
      return ((await response.json()) as { result: { storage_usage: number } }).result.storage_usage;
    };
    const before = await stateBytes();
    let removed = 0;
    const calls: Array<{ removed: number; gasTgas: number }> = [];
    for (let i = 0; i < 10; i += 1) {
      const r = await call(outsider, "prune_epoch", { epoch: 1, max_items: 200 });
      expect(r.failures).toEqual([]);
      const n = Number(r.value);
      if (n === 0) break;
      const gas = await gasBurnt(r.hash, outsider.accountId);
      calls.push({ removed: n, gasTgas: Number(gas) / 1e12 });
      removed += n;
    }
    const after = await stateBytes();
    note(`prune_epoch(1, 200): ${JSON.stringify(calls)}; removed ${removed}; storage ${before} -> ${after} bytes (${before - after} freed)`);
    seen.pruneCalls = calls;
    expect(removed).toBeGreaterThan(150); // 182 pairs + 14 participants in this epoch
    expect(Math.max(...calls.map((c) => c.gasTgas))).toBeLessThan(300); // far below the 300 Tgas of one transaction
    expect(after).toBeLessThan(before);
    // a pruned epoch stays final: a second prune removes nothing
    expect(Number((await call(outsider, "prune_epoch", { epoch: 1, max_items: 200 })).value)).toBe(0);
  }, 900_000);
});
