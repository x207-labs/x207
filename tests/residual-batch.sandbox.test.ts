// BE-034: the residual of N debtors in ONE `execute_intents` of the REAL Intents contract (`intents.near`, the wasm of mainnet that `contracts/scripts/fetch-intents-wasm.sh` reads, CT-103) in near-sandbox.
// Three net debtors owe one creditor. Each deposits its USDT to Intents, registers a key and signs, with NEP-413, the `transfer` that the worker planned for it (`planResidualBatches`); the worker
// checks the payloads, `simulate_intents` passes (`runResidualBatch`), and the relayer sends one `execute_intents`. Intents moves the three balances to the circle all or nothing, and each
// `mt_on_transfer` is its own receipt on the circle. Balances are looked at at each step: the multi-token balances at Intents, `intents_balance` and the pool of the circle; then
// `withdraw_intents_balance` brings the USDT to the NEP-141 account of the circle and the creditor claims it.
// Needs the wasm: `cd contracts && scripts/fetch-intents-wasm.sh`. Run: X207_SANDBOX=1 npx vitest run tests/residual-batch.sandbox.test.ts
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { KeyPair } from "near-api-js";
import { buildClaimCall, createCircleViewFn, nep413SigningHash, onboardMember, signHash, signVoucher, type ContractAbi, type ContractCall } from "@x207/core";
import { planResidualBatches, runResidualBatch, type DuePosition, type SignedPayload } from "../backend/src/settlement/residual/batch.ts";
import { TERMS_HASH, deployCircle, type CircleFixture } from "../sdk/test-support/circle.ts";
import { sandboxAvailable, type SandboxAccount } from "../sdk/test-support/sandbox.ts";

const INTENTS_WASM = process.env.X207_INTENTS_WASM ?? "contracts/target/intents-near/intents.wasm";
const INTENTS_SHA256 = "a1afab98916d9f213746544dcf8e4e6bdb22c0be6bc5dfbd8ea8814c9922b547";
const haveWasm = existsSync(INTENTS_WASM) && createHash("sha256").update(readFileSync(INTENTS_WASM)).digest("hex") === INTENTS_SHA256;
if (!haveWasm && process.env.X207_REQUIRE_INTENTS_WASM === "1") throw new Error("BE-034: X207_REQUIRE_INTENTS_WASM=1 but there is no wasm of intents.near (contracts/scripts/fetch-intents-wasm.sh)");

type Member = { account: SandboxAccount; secretKey: `ed25519:${string}` };
const credit = (n: number): string => (BigInt(n) * 1_000_000n).toString();

describe.skipIf(!sandboxAvailable || !haveWasm)("BE-034 residual of three debtors in one execute_intents of the real Intents contract", () => {
  let fx: CircleFixture;
  afterAll(async () => {
    await fx?.stop();
  });

  it("TC-BE-034-20 three net debtors pay in one execute_intents; balances match at each step; a bad signature moves nothing", async () => {
    fx = await deployCircle();
    const { sandbox } = fx;
    const circleId = fx.circle.accountId;
    const view = <T,>(contract: string, method: string, args: object = {}) => sandbox.view<T>(contract, method, args);

    // --- the real Intents contract on the account that the circle has as `intents_id`
    const intentsAccount = await sandbox.createAccount("intents", "50");
    expect(intentsAccount.accountId).toBe(`intents.${sandbox.rootAccountId}`);
    await sandbox.deploy(intentsAccount, INTENTS_WASM);
    const admin = await sandbox.createAccount("iadmin", "10");
    const init = await intentsAccount.call({
      receiverId: intentsAccount.accountId, methodName: "new", deposit: 0n, gas: 100_000_000_000_000n,
      args: { config: { wnear_id: `wrap.${sandbox.rootAccountId}`, fees: { fee: 0, fee_collector: admin.accountId }, roles: { super_admins: [admin.accountId], admins: {}, grantees: {} } } },
    });
    expect(init.failures).toEqual([]);
    const intents = intentsAccount.accountId;
    const token = `nep141:${fx.usdt.accountId}`;
    const mtBalance = async (who: string) => BigInt(await view<string>(intents, "mt_balance_of", { account_id: who, token_id: token }));
    const ftBalance = async (who: string) => BigInt(await view<string>(fx.usdt.accountId, "ft_balance_of", { account_id: who }));

    // --- the circle: three debtors and one creditor
    const cview = createCircleViewFn({ circleContract: circleId, rpcUrls: [sandbox.rpcUrl] });
    const join = async (name: string): Promise<Member> => {
      const account = await fx.member(name);
      const joined = await onboardMember(
        { sendCall: async (c: ContractCall) => { const r = await account.call(c); if (r.failures.length > 0) throw new Error(r.failures.join("; ")); return r.value; }, view: cview, pollIntervalMs: 200, timeoutMs: 30_000 },
        { circleContract: circleId, circleId: fx.circleId, accountId: account.accountId, termsHash: TERMS_HASH, stakeAmount: "100000000", usdtTokenId: fx.usdt.accountId },
      );
      return { account, secretKey: joined.secretKey };
    };
    const debtors = { scraper: await join("scraper"), translator: await join("translator"), image: await join("image") };
    const gpu = await join("gpu");
    const owed = { scraper: 12, translator: 9, image: 7 } as const;
    const epoch = (await view<ContractAbi.EpochView>(circleId, "get_epoch")).epoch;
    for (const [name, member] of Object.entries(debtors) as Array<[keyof typeof owed, Member]>) {
      const { signature, ...voucher } = signVoucher(
        { circle: circleId, payer: member.account.accountId, payee: gpu.account.accountId, epoch, seq: 1, cumulativeAmount: credit(owed[name]), unit: "credit", resource: "https://seller.example/api" }, member.secretKey,
      );
      const r = await member.account.call({ receiverId: circleId, methodName: "register_cumulative", args: { voucher, signature }, deposit: 0n, gas: 100_000_000_000_000n }, "EXECUTED_OPTIMISTIC");
      expect(r.failures).toEqual([]);
    }
    const at = async (ns: string | null | undefined) => {
      await sandbox.advanceTo(Number(BigInt(ns!) / 1_000_000n) + 1_000);
      await new Promise((r) => setTimeout(r, 3_000));
    };
    const first = await view<ContractAbi.EpochView>(circleId, "get_epoch", { epoch });
    await at(first.cutoff_at);
    expect((await gpu.account.call({ receiverId: circleId, methodName: "close_epoch", args: { epoch }, deposit: 0n }, "EXECUTED_OPTIMISTIC")).failures).toEqual([]);
    const closing = await view<ContractAbi.EpochView>(circleId, "get_epoch", { epoch });
    await at(closing.proposal_deadline);
    const committed = await gpu.account.call({ receiverId: circleId, methodName: "commit_epoch", args: { epoch }, deposit: 0n, gas: 200_000_000_000_000n }, "EXECUTED_OPTIMISTIC");
    expect(committed.failures).toEqual([]);
    type Position = { account_id: string; role: string; status: string | null; amount: string };
    const positions = () => view<Position[]>(circleId, "list_positions", { epoch, from_index: 0, limit: 100 });
    const due: DuePosition[] = (await positions()).filter((p) => p.role === "debtor").map((p) => ({ account: p.account_id, amount: BigInt(p.amount) }));
    expect(due.map((d) => [d.account, d.amount]).sort()).toEqual(Object.entries(debtors).map(([name, m]) => [m.account.accountId, BigInt(credit(owed[name as keyof typeof owed]))]).sort());
    const total = due.reduce((s, d) => s + d.amount, 0n);
    expect(total).toBe(BigInt(credit(28)));
    expect((await positions()).filter((p) => p.role === "debtor").every((p) => p.status === "due")).toBe(true);

    // --- step 1: every debtor deposits its residual to Intents (a multi-token balance) and registers the key that will sign
    const publicKeyOf = (m: Member) => KeyPair.fromString(m.secretKey).getPublicKey().toString();
    for (const m of Object.values(debtors)) {
      const amount = due.find((d) => d.account === m.account.accountId)!.amount;
      const dep = await m.account.call({ receiverId: fx.usdt.accountId, methodName: "ft_transfer_call", args: { receiver_id: intents, amount: amount.toString(), msg: m.account.accountId }, deposit: 1n, gas: 100_000_000_000_000n });
      expect(dep.failures).toEqual([]);
      const reg = await m.account.call({ receiverId: intents, methodName: "add_public_key", args: { public_key: publicKeyOf(m) }, deposit: 1n, gas: 50_000_000_000_000n });
      expect(reg.failures).toEqual([]);
      expect(await mtBalance(m.account.accountId)).toBe(amount);
    }
    const ftOfCircleBefore = await ftBalance(circleId);
    expect([await mtBalance(circleId), BigInt(await view<string>(circleId, "intents_balance"))]).toEqual([0n, 0n]);

    // --- step 2: the worker plans one transfer per debtor, each debtor signs its own (NEP-413), the payloads are checked and simulated
    const [batch] = planResidualBatches(due, { circleContract: circleId, epoch, tokenId: fx.usdt.accountId });
    expect(batch).toHaveLength(3);
    const salt = await view<string>(intents, "current_salt").catch(() => "00000000");
    const sign = (m: Member, transfer: (typeof batch)[number], tamper = false): SignedPayload => {
      const deadline = new Date((await_now()) + 600_000).toISOString();
      const nonce = Buffer.concat([Buffer.from("5628f6c6", "hex"), Buffer.from([0]), Buffer.from(String(salt).padStart(8, "0").slice(0, 8), "hex"), deadlineBytes(deadline), randomBytes(15)]);
      const message = JSON.stringify({ signer_id: transfer.debtor, verifying_contract: intents, deadline, nonce: nonce.toString("base64"), intents: [transfer.intent] });
      const signature = signHash(nep413SigningHash(tamper ? message + " " : message, nonce, intents), m.secretKey);
      return { standard: "nep413", payload: { message, nonce: nonce.toString("base64"), recipient: intents }, public_key: publicKeyOf(m), signature };
    };
    const byDebtor = (tamper?: string) => new Map<string, SignedPayload>(batch.map((t) => {
      const member = Object.values(debtors).find((m) => m.account.accountId === t.debtor)!;
      return [t.debtor, sign(member, t, t.debtor === tamper)];
    }));
    // a view that says why the contract panicked (the helper of the sandbox only reads the result)
    const rawView = async (contract: string, method: string, args: Record<string, unknown>): Promise<unknown> => {
      const response = await fetch(sandbox.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "optimistic", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }) });
      const body = (await response.json()) as { result?: { result?: number[]; error?: string }; error?: unknown };
      if (body.result?.error) throw new Error(body.result.error);
      if (!body.result?.result) throw new Error(`RPC view failed: ${JSON.stringify(body.error ?? body)}`);
      return JSON.parse(Buffer.from(body.result.result).toString("utf8"));
    };
    const relayer = await sandbox.createAccount("relayer", "20");
    const run = (signed: Map<string, SignedPayload>, execute?: (s: SignedPayload[]) => Promise<string>) => runResidualBatch(batch, {
      mode: "live", verifier: intents, view: rawView, signed,
      ...(execute ? { execute } : {}),
      readStatus: async (debtor) => (await positions()).find((p) => p.account_id === debtor)?.status ?? "none", attempts: 20, waitMs: 1_000,
    });

    // a payload whose signature does not match is stopped by the simulation: nothing moves
    const bad = await run(byDebtor(batch[1]!.debtor), async () => { throw new Error("must not execute"); });
    expect(bad.status).toBe("simulation_failed");
    const badMessage = (bad as { message: string }).message;
    expect(badMessage).not.toMatch(/does not exist/); // the simulation reached the real Verifier and refused the payload, not a missing account
    expect([await mtBalance(circleId), (await positions()).filter((p) => p.status === "due").length]).toEqual([0n, 3]);

    // --- step 3: one execute_intents; the three balances move together
    let txHash = "";
    const result = await run(byDebtor(), async (signed) => {
      const r = await relayer.call({ receiverId: intents, methodName: "execute_intents", args: { signed }, deposit: 0n, gas: 300_000_000_000_000n });
      expect(r.failures).toEqual([]);
      txHash = "executed";
      return txHash;
    });
    expect(result, JSON.stringify(result)).toMatchObject({ status: "executed" });
    expect((result as { outcomes: Array<{ status: string }> }).outcomes.map((o) => o.status)).toEqual(["paid", "paid", "paid"]);
    for (const m of Object.values(debtors)) expect(await mtBalance(m.account.accountId)).toBe(0n); // the debtors have no balance left at Intents
    expect(await mtBalance(circleId)).toBe(total); // the circle holds the sum at Intents
    expect(BigInt(await view<string>(circleId, "intents_balance"))).toBe(total); // and its book says the same
    expect(await ftBalance(circleId)).toBe(ftOfCircleBefore); // the NEP-141 account of the circle did not change yet
    expect((await positions()).filter((p) => p.role === "debtor").every((p) => p.status === "paid")).toBe(true);

    // --- step 4: finalize, bring the USDT to the NEP-141 account of the circle, the creditor claims
    await at(closing.payment_deadline ?? (await view<ContractAbi.EpochView>(circleId, "get_epoch", { epoch })).payment_deadline);
    expect((await gpu.account.call({ receiverId: circleId, methodName: "finalize_epoch", args: { epoch }, deposit: 0n, gas: 200_000_000_000_000n }, "EXECUTED_OPTIMISTIC")).failures).toEqual([]);
    const withdrawn = await relayer.call({ receiverId: circleId, methodName: "withdraw_intents_balance", args: {}, deposit: 0n, gas: 150_000_000_000_000n });
    expect(withdrawn.failures).toEqual([]);
    await new Promise((r) => setTimeout(r, 3_000));
    expect(BigInt(await view<string>(circleId, "intents_balance"))).toBe(0n);
    expect(await mtBalance(circleId)).toBe(0n);
    expect(await ftBalance(circleId)).toBe(ftOfCircleBefore + total);
    const gpuBefore = await ftBalance(gpu.account.accountId);
    const claimed = await gpu.account.call(buildClaimCall({ circleContract: circleId, epoch, destination: "near" }));
    expect(claimed.failures).toEqual([]);
    await new Promise((r) => setTimeout(r, 3_000));
    expect(await ftBalance(gpu.account.accountId)).toBe(gpuBefore + total);
    console.log(["BE-034", `epoch ${epoch}`, `3 debtors paid ${total} in one execute_intents`, `circle at Intents ${total} then withdrawn`, `creditor claimed ${total}`, `tampered payload: ${badMessage.slice(0, 120)}`].join(" | "));
  }, 900_000);
});

const await_now = (): number => Date.now();
/** The deadline inside the nonce of Intents (near/intents `nonce/versioned.rs`, `expirable.rs`): 8 bytes, a borsh i64 of nanoseconds. It must not be before the `deadline` of the signed message. */
function deadlineBytes(deadline: string): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(Date.parse(deadline)) * 1_000_000n); // i64 nanoseconds, little endian (borsh): VersionedNonce::V1 = magic || 0 || salt(4) || deadline(8) || 15 random
  return b;
}
