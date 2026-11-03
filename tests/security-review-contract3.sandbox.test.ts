// Third security review (UM-063 follow-up): the contract code of 0.0.9 read as an attacker by someone other than its author. Real contract and the mock
// Intents contract in near-sandbox. A test with `it.fails` documents a finding that is open: it asserts the safe behaviour, and vitest counts it as passing
// while the behaviour is wrong; when the contract is fixed the test turns red and `.fails` is removed. Findings: docs/security-review-3.md.
// Run: X207_SANDBOX=1 npx vitest run tests/security-review-contract3.sandbox.test.ts
import { appendFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { base58Encode, createCircleViewFn, onboardMember, parseEventLog, type ContractCall } from "@x207/core";
import { SHORT_PARAMS, TERMS_HASH, deployCircle, type CircleFixture } from "../sdk/test-support/circle.ts";
import { sandboxAvailable, type SandboxAccount } from "../sdk/test-support/sandbox.ts";

const hash = (n: number): string => base58Encode(Uint8Array.from({ length: 32 }, (_, i) => (i === 31 ? n % 256 : i === 30 ? Math.floor(n / 256) : 7)));

describe.skipIf(!sandboxAvailable)("security review 3: intents, withdrawals, limits (contract 0.0.9)", () => {
  let fx: CircleFixture;
  let attacker: SandboxAccount;
  let victim: SandboxAccount;
  afterAll(async () => {
    await fx?.stop();
  });

  const note = (line: string) => appendFileSync(process.env.SR3_NOTES ?? "/dev/null", `${line}\n`);

  const contractState = async () => {
    const response = await fetch(fx.sandbox.rpcUrl, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "final", account_id: fx.circle.accountId } }),
    });
    const { result } = (await response.json()) as { result: { storage_usage: number; amount: string } };
    return { storage: result.storage_usage, amount: BigInt(result.amount) };
  };

  async function setup() {
    fx = await deployCircle(SHORT_PARAMS, { mockIntents: true });
    const view = createCircleViewFn({ circleContract: fx.circle.accountId, rpcUrls: [fx.sandbox.rpcUrl] });
    const join = async (name: string) => {
      const account = await fx.member(name);
      await onboardMember(
        {
          sendCall: async (c: ContractCall) => {
            const r = await account.call(c);
            if (r.failures.length > 0) throw new Error(r.failures.join("; "));
            return r.value;
          },
          view, pollIntervalMs: 200, timeoutMs: 30_000,
        },
        // the smallest stake the contract accepts: one unit of USDT (0.000001), to price a sybil member
        { circleContract: fx.circle.accountId, circleId: fx.circleId, accountId: account.accountId, termsHash: TERMS_HASH, stakeAmount: "1", usdtTokenId: fx.usdt.accountId },
      );
      return account;
    };
    attacker = await join("attacker");
    victim = await join("victim");
  }

  const post = (who: SandboxAccount, h: string) => who.call({ receiverId: fx.circle.accountId, methodName: "post_intent", args: { intent_hash: h }, deposit: 0n });
  const remove = (who: SandboxAccount, h: string) => who.call({ receiverId: fx.circle.accountId, methodName: "remove_intent", args: { intent_hash: h }, deposit: 0n });

  it("TC-SR3-01 a member can join with a stake of one unit (the cost of a sybil member is the join deposit and 0.000001 USDT)", async () => {
    await setup();
    expect(await fx.sandbox.view<{ status: string; stake: string }>(fx.circle.accountId, "member", { account_id: attacker.accountId })).toMatchObject({ status: "active", stake: "1" });
  }, 300_000);

  it("TC-SR3-02 the limit counts open intents: the 65th is refused, a removal gives the slot back, and post-remove cycles leave no storage behind", async () => {
    const before = await contractState();
    for (let i = 0; i < 64; i += 1) expect((await post(attacker, hash(1000 + i))).failures, `post ${i}`).toEqual([]);
    expect((await post(attacker, hash(2000))).failures.join(" ")).toContain("ERR_INTENT_LIMIT");
    expect((await remove(attacker, hash(1000))).failures).toEqual([]);
    expect((await post(attacker, hash(2000))).failures).toEqual([]);
    expect((await post(attacker, hash(2001))).failures.join(" ")).toContain("ERR_INTENT_LIMIT");
    // cycles of post and remove do not grow the storage
    const mid = await contractState();
    for (let i = 0; i < 10; i += 1) {
      expect((await remove(attacker, hash(2000))).failures).toEqual([]);
      expect((await post(attacker, hash(2000))).failures).toEqual([]);
    }
    expect((await contractState()).storage).toBe(mid.storage);
    // measured for the review: the storage that 64 intents of one member pin in the contract
    const pinned = mid.storage - before.storage;
    note(`64 intents of one member pin ${pinned} bytes = ${(pinned * 1e19) / 1e24} NEAR of the balance of the contract`);
    expect(pinned).toBeGreaterThan(0);
  }, 600_000);

  const joinMinimal = async (name: string) => {
    const account = await fx.member(name);
    const view = createCircleViewFn({ circleContract: fx.circle.accountId, rpcUrls: [fx.sandbox.rpcUrl] });
    await onboardMember(
      { sendCall: async (c: ContractCall) => { const r = await account.call(c); if (r.failures.length > 0) throw new Error(r.failures.join("; ")); return r.value; }, view, pollIntervalMs: 200, timeoutMs: 30_000 },
      { circleContract: fx.circle.accountId, circleId: fx.circleId, accountId: account.accountId, termsHash: TERMS_HASH, stakeAmount: "1", usdtTokenId: fx.usdt.accountId },
    );
    return account;
  };
  const measured: { joinBytes?: number; intentBytes?: number; squatVictim?: string; squatFirst?: string[]; removeLogs?: string[]; removeFailures?: string[] } = {};

  // The setup of the three findings runs here, in plain tests that fail loudly; the `it.fails` tests after it assert only the safe behaviour on the recorded result.
  it("TC-SR3-03a record: storage that a minimal member pins with 64 intents, a squatted hash, and the logs of a removal", async () => {
    const before = await contractState();
    const sybil = await joinMinimal("sybil");
    const afterJoin = await contractState();
    for (let i = 0; i < 64; i += 1) expect((await post(sybil, hash(5000 + i))).failures, `sybil post ${i}`).toEqual([]);
    const afterIntents = await contractState();
    measured.joinBytes = afterJoin.storage - before.storage;
    measured.intentBytes = afterIntents.storage - afterJoin.storage;
    note(`join of a one-unit member: ${measured.joinBytes} bytes; 64 intents of it: ${measured.intentBytes} bytes = ${(measured.intentBytes * 1e19) / 1e24} NEAR (join deposit 0.01 NEAR)`);
    expect(measured.intentBytes).toBeGreaterThan(0);

    // squatting: another minimal member posts a hash first; the owner of the intent then posts the same hash
    const squatter = await joinMinimal("squatter");
    const h = hash(9000);
    measured.squatFirst = (await post(squatter, h)).failures;
    expect(measured.squatFirst).toEqual([]);
    measured.squatVictim = (await post(victim, h)).failures.join(" ");
    note(`victim posts a hash that the squatter posted first: "${measured.squatVictim}"`);

    // removal: logs of remove_intent
    const h2 = hash(9100);
    expect((await post(victim, h2)).failures).toEqual([]);
    const removed = await remove(victim, h2);
    measured.removeFailures = removed.failures;
    measured.removeLogs = removed.logs;
    note(`remove_intent failures ${JSON.stringify(removed.failures)} logs ${JSON.stringify(removed.logs)}`);
    expect(removed.failures).toEqual([]);
  }, 900_000);

  // Finding I-3: post_intent is not payable, so the contract pays the storage of every intent, and an intent is only removed by its owner. A sybil member (join deposit 0.01 NEAR and a stake of one unit)
  // pins the storage of 64 intents for good. The safe behaviour asserted here: what a minimal member can pin with intents does not exceed its join deposit.
  it.fails("TC-SR3-03 [finding I-3] the storage that one minimal member can pin with intents does not exceed its join deposit (0.01 NEAR)", () => {
    expect(measured.intentBytes).toBeDefined();
    expect(BigInt(measured.intentBytes!) * 10n ** 19n <= 10n ** 22n).toBe(true);
  });

  // Finding I-1: the key of an intent is the hash alone, so the first member that posts a hash owns it. The safe behaviour: the owner of the intent can still post it.
  it.fails("TC-SR3-04 [finding I-1] a hash that another member posted first does not block the owner of the intent", () => {
    expect(measured.squatFirst).toEqual([]);
    expect(measured.squatVictim).toBeDefined();
    expect(measured.squatVictim).not.toContain("ERR_INTENT_EXISTS");
  });

  // Finding I-2: the removal of an intent emits no event, so an indexer cannot tell that the slot is free.
  it.fails("TC-SR3-05 [finding I-2] remove_intent emits an event", () => {
    expect(measured.removeFailures).toEqual([]);
    expect(measured.removeLogs!.flatMap((l) => parseEventLog(l) ?? []).length).toBeGreaterThan(0);
  });

  it("TC-SR3-06 only the owner removes an intent, and an unknown hash is refused", async () => {
    const h = hash(9200);
    expect((await post(victim, h)).failures).toEqual([]);
    expect((await remove(attacker, h)).failures.join(" ")).toContain("ERR_NOT_INTENT_OWNER");
    expect((await remove(victim, hash(9201))).failures.join(" ")).toContain("ERR_UNKNOWN_INTENT");
    expect((await remove(victim, h)).failures).toEqual([]);
  }, 300_000);

  it("TC-SR3-07 withdraw_intents_balance with nothing booked can be called many times without costing the contract anything or leaving a withdrawal in flight", async () => {
    const before = await contractState();
    for (let i = 0; i < 8; i += 1) {
      const r = await attacker.call({ receiverId: fx.circle.accountId, methodName: "withdraw_intents_balance", args: {}, deposit: 0n, gas: 150_000_000_000_000n });
      expect(r.failures.join(" "), `call ${i}`).toContain("ERR_NOTHING_TO_WITHDRAW");
    }
    const after = await contractState();
    expect(after.amount).toBeGreaterThanOrEqual(before.amount); // nothing left the balance of the contract (the 1 yocto is attached only after the checks)
    expect(after.storage).toBe(before.storage);
    expect(await fx.sandbox.view<string>(fx.circle.accountId, "intents_balance", {})).toBe("0");
    const lowGas = await attacker.call({ receiverId: fx.circle.accountId, methodName: "withdraw_intents_balance", args: {}, deposit: 0n, gas: 100_000_000_000_000n });
    expect(lowGas.failures.join(" ")).toContain("ERR_GAS_TOO_LOW");
  }, 300_000);

  it("TC-SR3-08 mt_on_transfer is refused from anyone but intents_id, and for any token or shape other than the single nep141 USDT", async () => {
    const call = (who: SandboxAccount, args: object) => who.call({ receiverId: fx.circle.accountId, methodName: "mt_on_transfer", args, deposit: 0n });
    const good = { sender_id: victim.accountId, previous_owner_ids: [victim.accountId], token_ids: [`nep141:${fx.usdt.accountId}`], amounts: ["1000000"], msg: JSON.stringify({ action: "settle", epoch: 1 }) };
    expect((await call(attacker, good)).failures.join(" ")).toContain("ERR_WRONG_TOKEN");
    expect((await call(fx.intents!, { ...good, token_ids: ["nep141:evil.near"] })).failures.join(" ")).toContain("ERR_WRONG_TOKEN");
    expect((await call(fx.intents!, { ...good, token_ids: [`nep141:${fx.usdt.accountId}`, `nep141:${fx.usdt.accountId}`], amounts: ["1", "1"] })).failures.join(" ")).toContain("ERR_WRONG_TOKEN");
    expect((await call(fx.intents!, { ...good, previous_owner_ids: [] })).failures.join(" ")).toContain("ERR_BAD_MSG");
    expect((await call(fx.intents!, { ...good, msg: JSON.stringify({ action: "stake" }) })).failures.join(" ")).toContain("ERR_BAD_MSG");
    expect((await call(fx.intents!, { ...good, amounts: ["0"] })).failures.join(" ")).toContain("ERR_ZERO_AMOUNT");
    // a settle for an epoch that has no payment window yet changes nothing, and nothing is booked at Intents
    expect((await call(fx.intents!, good)).failures.length).toBeGreaterThan(0);
    expect(await fx.sandbox.view<string>(fx.circle.accountId, "intents_balance", {})).toBe("0");
  }, 300_000);

  it("TC-SR3-09 prune_epoch refuses an epoch that is not finalized and an unknown epoch, for any caller", async () => {
    const epoch = (await fx.sandbox.view<{ epoch: number }>(fx.circle.accountId, "get_epoch", {})).epoch;
    const prune = (who: SandboxAccount, e: number) => who.call({ receiverId: fx.circle.accountId, methodName: "prune_epoch", args: { epoch: e, max_items: 200 }, deposit: 0n });
    expect((await prune(attacker, epoch)).failures.join(" ")).toContain("ERR_NOT_FINALIZED");
    expect((await prune(attacker, epoch + 50)).failures.join(" ")).toContain("ERR_UNKNOWN_EPOCH");
  }, 300_000);
});
