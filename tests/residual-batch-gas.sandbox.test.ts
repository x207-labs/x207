// BE-034: gas of ONE `execute_intents` of the real Intents contract (the wasm of `intents.near`, CT-103) for N debtors of a circle, N = 2, 3, 5, 8 and 12, in near-sandbox. Each N has its own circle:
// N net debtors owe one creditor, deposit to Intents, sign their transfers (NEP-413), and the relayer sends one `execute_intents` with 300 Tgas attached (the most one call can carry).
// The test reads the whole transaction (`EXPERIMENTAL_tx_status`) and prints the gas burnt: in the receipt of `execute_intents` (the verification of the N signatures and the N transfers), in the N
// receipts of `mt_on_transfer` on the circle, and in all receipts; and whether all N debtors are `paid`. The table is in `backend/docs/residual-batch.md`.
// Needs the wasm: `cd contracts && scripts/fetch-intents-wasm.sh`. Run: X207_SANDBOX=1 npx vitest run tests/residual-batch-gas.sandbox.test.ts
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KeyPair } from "near-api-js";
import { createCircleViewFn, nep413SigningHash, onboardMember, signHash, signVoucher, type ContractAbi, type ContractCall } from "@x207/core";
import { planResidualBatches, type DuePosition, type SignedPayload } from "../backend/src/settlement/residual/batch.ts";
import { TERMS_HASH, deployCircle } from "../sdk/test-support/circle.ts";
import { sandboxAvailable, type SandboxAccount } from "../sdk/test-support/sandbox.ts";

const INTENTS_WASM = process.env.X207_INTENTS_WASM ?? "contracts/target/intents-near/intents.wasm";
const INTENTS_SHA256 = "a1afab98916d9f213746544dcf8e4e6bdb22c0be6bc5dfbd8ea8814c9922b547";
const haveWasm = existsSync(INTENTS_WASM) && createHash("sha256").update(readFileSync(INTENTS_WASM)).digest("hex") === INTENTS_SHA256;
const NS = (process.env.GAS_N ?? "2,3,5,8,12").split(",").map(Number);
const TGAS = 1_000_000_000_000n;
/** `GAS_MIN_GAS`: the `min_gas` of every transfer intent (gas kept for the `mt_on_transfer` of the circle); empty = the default of Intents. */
const MIN_GAS = process.env.GAS_MIN_GAS ?? "";

type Member = { account: SandboxAccount; secretKey: `ed25519:${string}` };
type Row = { n: number; minGas: string; ok: boolean; paid: number; executeIntentsTgas: number | null; mtOnTransferTgas: number[]; totalTgas: number | null; failure: string | null };

/** One circle with N net debtors, one execute_intents with 300 Tgas, the gas read from the transaction. */
async function measure(n: number): Promise<Row> {
  const fx = await deployCircle();
  try {
    const { sandbox } = fx;
    const circleId = fx.circle.accountId;
    const view = <T,>(contract: string, method: string, args: object = {}) => sandbox.view<T>(contract, method, args);
    const intentsAccount = await sandbox.createAccount("intents", "50");
    await sandbox.deploy(intentsAccount, INTENTS_WASM);
    const admin = await sandbox.createAccount("iadmin", "10");
    expect((await intentsAccount.call({ receiverId: intentsAccount.accountId, methodName: "new", deposit: 0n, gas: 100_000_000_000_000n, args: { config: { wnear_id: `wrap.${sandbox.rootAccountId}`, fees: { fee: 0, fee_collector: admin.accountId }, roles: { super_admins: [admin.accountId], admins: {}, grantees: {} } } } })).failures).toEqual([]);
    const intents = intentsAccount.accountId;
    const cview = createCircleViewFn({ circleContract: circleId, rpcUrls: [sandbox.rpcUrl] });
    const join = async (name: string): Promise<Member> => {
      const account = await fx.member(name);
      const joined = await onboardMember(
        { sendCall: async (c: ContractCall) => { const r = await account.call(c); if (r.failures.length > 0) throw new Error(r.failures.join("; ")); return r.value; }, view: cview, pollIntervalMs: 200, timeoutMs: 30_000 },
        { circleContract: circleId, circleId: fx.circleId, accountId: account.accountId, termsHash: TERMS_HASH, stakeAmount: "100000000", usdtTokenId: fx.usdt.accountId },
      );
      return { account, secretKey: joined.secretKey };
    };
    const debtors: Member[] = [];
    for (let i = 0; i < n; i++) debtors.push(await join(`debtor${i}`));
    const gpu = await join("gpu");
    const epoch = (await view<ContractAbi.EpochView>(circleId, "get_epoch")).epoch;
    for (const [i, member] of debtors.entries()) {
      const { signature, ...voucher } = signVoucher({ circle: circleId, payer: member.account.accountId, payee: gpu.account.accountId, epoch, seq: 1, cumulativeAmount: String(5_000_000 + i * 100_000), unit: "credit", resource: "https://seller.example/api" }, member.secretKey);
      expect((await member.account.call({ receiverId: circleId, methodName: "register_cumulative", args: { voucher, signature }, deposit: 0n, gas: 100_000_000_000_000n }, "EXECUTED_OPTIMISTIC")).failures).toEqual([]);
    }
    const at = async (ns: string | null | undefined) => { await sandbox.advanceTo(Number(BigInt(ns!) / 1_000_000n) + 1_000); await new Promise((r) => setTimeout(r, 3_000)); };
    await at((await view<ContractAbi.EpochView>(circleId, "get_epoch", { epoch })).cutoff_at);
    expect((await gpu.account.call({ receiverId: circleId, methodName: "close_epoch", args: { epoch }, deposit: 0n }, "EXECUTED_OPTIMISTIC")).failures).toEqual([]);
    await at((await view<ContractAbi.EpochView>(circleId, "get_epoch", { epoch })).proposal_deadline);
    expect((await gpu.account.call({ receiverId: circleId, methodName: "commit_epoch", args: { epoch }, deposit: 0n, gas: 200_000_000_000_000n }, "EXECUTED_OPTIMISTIC")).failures).toEqual([]);
    type Position = { account_id: string; role: string; status: string | null; amount: string };
    const positions = () => view<Position[]>(circleId, "list_positions", { epoch, from_index: 0, limit: 100 });
    const due: DuePosition[] = (await positions()).filter((p) => p.role === "debtor").map((p) => ({ account: p.account_id, amount: BigInt(p.amount) }));
    expect(due).toHaveLength(n);

    const publicKeyOf = (m: Member) => KeyPair.fromString(m.secretKey).getPublicKey().toString();
    for (const m of debtors) {
      const amount = due.find((d) => d.account === m.account.accountId)!.amount;
      expect((await m.account.call({ receiverId: fx.usdt.accountId, methodName: "ft_transfer_call", args: { receiver_id: intents, amount: amount.toString(), msg: m.account.accountId }, deposit: 1n, gas: 100_000_000_000_000n })).failures).toEqual([]);
      expect((await m.account.call({ receiverId: intents, methodName: "add_public_key", args: { public_key: publicKeyOf(m) }, deposit: 1n, gas: 50_000_000_000_000n })).failures).toEqual([]);
    }
    const [batch] = planResidualBatches(due, { circleContract: circleId, epoch, tokenId: fx.usdt.accountId, maxPerCall: n, minGas: MIN_GAS === "" ? null : MIN_GAS });
    expect(batch).toHaveLength(n);
    const salt = await view<string>(intents, "current_salt");
    const signed: SignedPayload[] = batch!.map((transfer) => {
      const member = debtors.find((m) => m.account.accountId === transfer.debtor)!;
      const deadline = new Date(Date.now() + 600_000).toISOString();
      const dl = Buffer.alloc(8);
      dl.writeBigInt64LE(BigInt(Date.parse(deadline)) * 1_000_000n);
      const nonce = Buffer.concat([Buffer.from("5628f6c6", "hex"), Buffer.from([0]), Buffer.from(salt, "hex"), dl, randomBytes(15)]);
      const intent = transfer.intent; // `min_gas` is already in it when the plan was made with one
      const message = JSON.stringify({ signer_id: transfer.debtor, verifying_contract: intents, deadline, nonce: nonce.toString("base64"), intents: [intent] });
      return { standard: "nep413", payload: { message, nonce: nonce.toString("base64"), recipient: intents }, public_key: publicKeyOf(member), signature: signHash(nep413SigningHash(message, nonce, intents), member.secretKey) };
    });
    const relayer = await sandbox.createAccount("relayer", "20");
    const sent = await relayer.call({ receiverId: intents, methodName: "execute_intents", args: { signed }, deposit: 0n, gas: 300_000_000_000_000n });
    await new Promise((r) => setTimeout(r, 4_000));
    const paid = (await positions()).filter((p) => p.role === "debtor" && p.status === "paid").length;

    // the gas of the whole transaction
    let executeIntentsTgas: number | null = null;
    let totalTgas: number | null = null;
    const mtOnTransferTgas: number[] = [];
    if (sent.hash) {
      const rpc = async (method: string, params: unknown) => ((await (await fetch(sandbox.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()) as any).result;
      const tx = await rpc("EXPERIMENTAL_tx_status", { tx_hash: sent.hash, sender_account_id: relayer.accountId, wait_until: "FINAL" });
      const burnt = (o: any): bigint => BigInt(o.outcome.gas_burnt);
      const receipts: any[] = tx.receipts_outcome ?? [];
      let total = burnt(tx.transaction_outcome);
      for (const r of receipts) {
        total += burnt(r);
        if (r.outcome.executor_id === intents && executeIntentsTgas === null) executeIntentsTgas = Number(burnt(r) / (TGAS / 10n)) / 10;
        if (r.outcome.executor_id === circleId) mtOnTransferTgas.push(Number(burnt(r) / (TGAS / 10n)) / 10);
      }
      totalTgas = Number(total / (TGAS / 10n)) / 10;
    }
    return { n, minGas: MIN_GAS || "default", ok: sent.failures.length === 0 && paid === n, paid, executeIntentsTgas, mtOnTransferTgas, totalTgas, failure: sent.failures[0] ?? null };
  } finally {
    await fx.stop();
  }
}

describe.skipIf(!sandboxAvailable || !haveWasm)("BE-034 gas of one execute_intents for N debtors on the real Intents contract", () => {
  it("TC-BE-034-22 N = 2, 3, 5, 8, 12: the gas burnt, and whether all N debtors are paid with 300 Tgas attached", async () => {
    const rows: Row[] = [];
    for (const n of NS) {
      const row = await measure(n);
      rows.push(row);
      console.log("BE-034 gas", JSON.stringify(row));
      if (process.env.GAS_OUT) appendFileSync(process.env.GAS_OUT, `${JSON.stringify(row)}\n`); // the reporter of this repository hides console lines
    }
    console.log("BE-034 gas table", JSON.stringify(rows));
    expect(rows.length).toBe(NS.length);
    expect(rows[0]!.ok, JSON.stringify(rows[0])).toBe(true); // the smallest batch must work; the others are data
  }, 3_600_000);
});
