#!/usr/bin/env node
// UM-125: the gas of one plain NEP-141 `ft_transfer` on the mock USDT of testnet (`usdt.x207-deployer.testnet`), sent three times between aux member accounts (testnet only; keys stay in .secrets/).
//   node scripts/gas-ft-transfer-testnet.mjs [--out docs/gas-ft-transfer-testnet.json]
// Gas burnt and NEAR burnt are summed over the transaction and all its receipts, the same way as in contracts/docs/gas-and-cost.md. Only hashes, names and numbers are written.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Account, JsonRpcProvider, KeyPairSigner } from "../backend/node_modules/near-api-js/lib/index.js";

const AUX = "x207-v013-aux.testnet";
const USDT = "usdt.x207-deployer.testnet";
const RPC = process.env.X207_TESTNET_RPC ?? "https://rpc.testnet.fastnear.com";
const secretsDir = process.env.X207_SECRETS_DIR ?? resolve("../../.secrets/testnet-deployer");
const args = process.argv.slice(2);
const outPath = resolve(args.includes("--out") ? args[args.indexOf("--out") + 1] : "docs/gas-ft-transfer-testnet.json");
const saved = JSON.parse(readFileSync(join(secretsDir, "um100-v013.json"), "utf8"));
const id = (i) => `m${String(i).padStart(2, "0")}.${AUX}`;
const provider = new JsonRpcProvider({ url: RPC });
const as = (i) => new Account(id(i), provider, KeyPairSigner.fromSecretKey(saved[id(i)].tx));

const burnt = (o) => {
  const outcomes = [o.transaction_outcome.outcome, ...o.receipts_outcome.map((r) => r.outcome)];
  return { gas: outcomes.reduce((n, x) => n + BigInt(x.gas_burnt), 0n), tokens: outcomes.reduce((n, x) => n + BigInt(x.tokens_burnt), 0n), receipts: outcomes.length };
};

const sender = as(10);
// the members hold only their stake: mint the sender a little mock USDT (the token is a testnet mock whose mint is open)
const minted = await sender.callFunctionRaw({ contractId: USDT, methodName: "mint", args: { account_id: id(10), amount: "3000000" }, gas: 10_000_000_000_000n, waitUntil: "FINAL" });
const rows = [];
for (const [n, to] of [11, 12, 13].entries()) {
  const o = await sender.callFunctionRaw({ contractId: USDT, methodName: "ft_transfer", args: { receiver_id: id(to), amount: "1000000", memo: `UM-125 ${n + 1}` }, deposit: 1n, gas: 30_000_000_000_000n, waitUntil: "FINAL" });
  const b = burnt(o);
  rows.push({ hash: o.transaction_outcome.id, from: id(10), to: id(to), amount: "1000000", gasBurnt: b.gas.toString(), tokensBurnt: b.tokens.toString(), receipts: b.receipts });
  console.log(rows.at(-1).hash, `${Number(b.gas) / 1e12} Tgas`, `${Number(b.tokens) / 1e24} NEAR`, `${b.receipts} outcomes`);
}
writeFileSync(outPath, JSON.stringify({ token: USDT, note: "UM-125: one NEP-141 ft_transfer of 1 unit (1,000,000 = 1.0 with 6 decimals) between member accounts; mint hash is the setup", mint: minted.transaction_outcome.id, transfers: rows }, null, 2));
