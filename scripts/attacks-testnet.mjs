#!/usr/bin/env node
// UM-122: attacks that the contract x207-v013.testnet REFUSES, sent as real transactions from the aux member accounts (testnet only; keys stay in .secrets/, only hashes and names are written).
//   node scripts/attacks-testnet.mjs [--out docs/attacks-on-testnet.json] [--wait-open-minutes 12]
// Every transaction here must fail: the script records the hash and the exact error of the contract, and stops with exit code 1 if a transaction SUCCEEDED (that would be a hole, not a row of the table).
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from "../backend/node_modules/near-api-js/lib/index.js";
import { signVoucher } from "../sdk/packages/core/dist/index.js";
import { GRAPH } from "./lib/realistic-epoch.mjs";

const CIRCLE = "x207-v013.testnet";
const AUX = "x207-v013-aux.testnet";
const RPCS = [process.env.X207_TESTNET_RPC ?? "https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org"];
const secretsDir = process.env.X207_SECRETS_DIR ?? resolve("../../.secrets/testnet-deployer");
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const outPath = resolve(opt("--out", "docs/attacks-on-testnet.json"));
const waitOpenMs = Number(opt("--wait-open-minutes", "12")) * 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REALISTIC_EPOCH = 8; // UM-106: the realistic epoch, finalized, with claims made
const credits = (x) => BigInt(Math.round(x * 1_000_000));

const saved = JSON.parse(readFileSync(join(secretsDir, "um100-v013.json"), "utf8"));
const ids = Array.from({ length: 15 }, (_, i) => `m${String(i).padStart(2, "0")}.${AUX}`);
const provider = new JsonRpcProvider({ url: RPCS[0] });
const as = (i) => new Account(ids[i], provider, KeyPairSigner.fromSecretKey(saved[ids[i]].tx));

async function rpc(method, params) {
  let last;
  for (const url of RPCS) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        const body = await response.json();
        if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
        return body.result;
      } catch (error) {
        last = error;
        await sleep(3000 + attempt * 2000);
      }
    }
  }
  throw last;
}
const view = async (method, a = {}) => JSON.parse(Buffer.from((await rpc("query", { request_type: "call_function", finality: "optimistic", account_id: CIRCLE, method_name: method, args_base64: Buffer.from(JSON.stringify(a)).toString("base64") })).result).toString("utf8"));
const chainMs = async () => Number(BigInt((await rpc("block", { finality: "optimistic" })).header.timestamp_nanosec) / 1_000_000n);

/** The text of the contract panic in a failed outcome, e.g. `Smart contract panicked: ERR_NOT_OWNER: ...`. */
function failureOf(outcome) {
  const found = [outcome.status, ...(outcome.receipts_outcome ?? []).map((o) => o.outcome.status)].find((s) => s && typeof s === "object" && "Failure" in s);
  if (!found) return null;
  const text = JSON.stringify(found);
  const m = text.match(/"ExecutionError":"((?:[^"\\]|\\.)*)"/) ?? text.match(/"FunctionCallError":\{"[A-Za-z]+":"((?:[^"\\]|\\.)*)"/);
  return m ? m[1].replace(/\\"/g, '"') : text.slice(0, 300);
}

const rows = [];
async function attack(row, account, call) {
  // near-api-js throws when the transaction fails; the outcome (with the hash) is in `transactionResult` of the error
  let outcome;
  let thrown = null;
  try {
    outcome = await account.callFunctionRaw({ contractId: CIRCLE, methodName: call.methodName, args: call.args, deposit: call.deposit ?? 0n, gas: call.gas ?? 100_000_000_000_000n, waitUntil: "FINAL" });
  } catch (error) {
    if (!error?.transactionResult?.transaction_outcome) throw error;
    outcome = error.transactionResult;
    thrown = String(error.message);
  }
  const error = failureOf(outcome) ?? thrown;
  const entry = { ...row, sender: account.accountId, method: call.methodName, hash: outcome.transaction_outcome.id, refused: error !== null, error };
  rows.push(entry);
  writeFileSync(outPath, JSON.stringify({ contract: CIRCLE, note: "UM-122: attacks refused by the contract; hashes, names and the contract error only", attacks: rows }, null, 2));
  console.log(`${entry.refused ? "REFUSED" : "!! ACCEPTED"} ${row.id} ${entry.hash} ${error ?? ""}`);
  if (!entry.refused) throw new Error(`${row.id}: the contract ACCEPTED the attack (${entry.hash})`);
}

// ---- 1. a validly signed voucher of epoch 8 sent again (replay across epochs)
{
  const [d, c, amount] = GRAPH[0];
  const { signature, ...voucher } = signVoucher({ circle: CIRCLE, payer: ids[d], payee: ids[c], epoch: REALISTIC_EPOCH, seq: 1, cumulativeAmount: credits(amount).toString(), unit: "credit", resource: "https://x207.example/um106" }, saved[ids[d]].voucher);
  await attack({ id: "replay-old-epoch-voucher", attack: "Replay a voucher that the payer really signed and the contract really booked in epoch 8, now that the circle is in a later epoch" }, as(5), { methodName: "register_cumulative", args: { voucher, signature }, gas: 30_000_000_000_000n });
}

// ---- 2. a non-owner replaces the parameters of the circle
{
  const params = await view("get_params");
  await attack({ id: "set-params-not-owner", attack: "A member account that is not the DAO owner calls set_params to change the fees and the limit cap" }, as(3), { methodName: "set_params", args: { params: { ...params, fees: { clearing_fee_bps: 0, solver_fee_bps: 0 }, limit_cap: "999999999999" } }, gas: 30_000_000_000_000n });
}

// ---- 3. a fake deposit: ft_on_transfer called by a person, not by the USDT contract
await attack({ id: "fake-deposit", attack: "Call ft_on_transfer directly, as if the USDT contract had delivered a stake of 1,000,000 units to the attacker's member account" }, as(4), { methodName: "ft_on_transfer", args: { sender_id: ids[4], amount: "1000000", msg: JSON.stringify({ action: "stake" }) }, gas: 30_000_000_000_000n });

// ---- 4. a claim made twice, and a claim by a debtor
{
  const positions = await view("list_positions", { epoch: REALISTIC_EPOCH, from_index: 0, limit: 100 });
  const claimed = positions.find((p) => p.role === "creditor" && p.status === "claimed");
  const debtor = positions.find((p) => p.role === "debtor");
  const idxOf = (account) => ids.indexOf(account);
  if (claimed && idxOf(claimed.account_id) >= 0) {
    await attack({ id: "claim-twice", attack: `The creditor ${claimed.account_id} claims its residual of epoch ${REALISTIC_EPOCH} a second time, after the first claim was paid` }, as(idxOf(claimed.account_id)), { methodName: "claim", args: { epoch: REALISTIC_EPOCH, destination: "near" }, deposit: 1n, gas: 120_000_000_000_000n });
  } else console.log("no claimed creditor found among the aux members: claim-twice not run");
  if (debtor && idxOf(debtor.account_id) >= 0) {
    await attack({ id: "claim-as-debtor", attack: `The debtor ${debtor.account_id} claims from the pool of epoch ${REALISTIC_EPOCH}` }, as(idxOf(debtor.account_id)), { methodName: "claim", args: { epoch: REALISTIC_EPOCH, destination: "near" }, deposit: 1n, gas: 120_000_000_000_000n });
  }
}

// ---- 5. a clearing proposal with invented edges for an epoch that is already closed
await attack({ id: "submit-clearing-closed-epoch", attack: `Submit a clearing proposal that cancels 1,000,000 units on an edge that never existed, for the finalized epoch ${REALISTIC_EPOCH}` }, as(6), { methodName: "submit_clearing", args: { epoch: REALISTIC_EPOCH, edges: [{ debtor: ids[6], creditor: ids[7], cleared: "1000000" }] }, gas: 60_000_000_000_000n });

// ---- 6. the stake taken out without the exit
await attack({ id: "withdraw-stake-without-exit", attack: "An active member withdraws its stake without asking to exit and without the epoch of the exit being finalized" }, as(7), { methodName: "withdraw_stake", args: {}, deposit: 1n, gas: 100_000_000_000_000n });

// ---- 7. voucher with a forged signature, in an OPEN epoch (the signature is checked after the epoch, the limit and the sequence)
{
  const forger = KeyPair.fromRandom("ed25519").toString();
  const deadline = Date.now() + waitOpenMs;
  let done = false;
  while (Date.now() < deadline && !done) {
    const e = await view("get_epoch");
    const now = await chainMs();
    if (e.phase === "open" && now + 25_000 < Number(BigInt(e.cutoff_at) / 1_000_000n)) {
      const { signature, ...voucher } = signVoucher({ circle: CIRCLE, payer: ids[0], payee: ids[1], epoch: e.epoch, seq: 1, cumulativeAmount: "1", unit: "credit", resource: "https://x207.example/um122" }, forger);
      await attack({ id: "forged-voucher-signature", attack: `A voucher from ${ids[0]} to ${ids[1]} in the open epoch ${e.epoch}, signed with a key that is not the voucher key of the payer` }, as(5), { methodName: "register_cumulative", args: { voucher, signature }, gas: 30_000_000_000_000n });
      done = true;
    } else {
      console.log(`waiting for an open epoch (epoch ${e.epoch} is ${e.phase})`);
      await sleep(20_000);
    }
  }
  if (!done) console.log("no open epoch within the wait: forged-voucher-signature not run");
}
console.log(`${rows.length} attacks refused; written to ${outPath}`);
