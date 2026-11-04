#!/usr/bin/env node
// Spike S3 (UM-137), on NEAR testnet, with the team's own test accounts and the mock USDT (no real money):
//   (1) latency: the time from sending an `ft_transfer` to its FINAL outcome, five times in a row (the cost of paying each call onchain, `exact`-style);
//   (2) no cash: a member tries to pay more USDT than it holds and is refused, so a plain payment needs cash in the wallet.
//   node spikes/s3-testnet-latency-and-no-cash.mjs
// Needs the key file of the aux members (X207_SECRETS_DIR, default ../../.secrets/testnet-deployer) and `backend/node_modules` (npm ci in backend). Prints no key.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Account, JsonRpcProvider, KeyPairSigner } from "../backend/node_modules/near-api-js/lib/index.js";

const AUX = "x207-v013-aux.testnet";
const USDT = "usdt.x207-deployer.testnet";
const RPC = process.env.X207_TESTNET_RPC ?? "https://rpc.testnet.fastnear.com";
const secretsDir = process.env.X207_SECRETS_DIR ?? resolve("../../.secrets/testnet-deployer");
const saved = JSON.parse(readFileSync(join(secretsDir, "um100-v013.json"), "utf8"));
const id = (i) => `m${String(i).padStart(2, "0")}.${AUX}`;
const provider = new JsonRpcProvider({ url: RPC });
const as = (i) => new Account(id(i), provider, KeyPairSigner.fromSecretKey(saved[id(i)].tx));
const balance = async (acc) => BigInt(await provider.callFunction({ contractId: USDT, method: "ft_balance_of", args: { account_id: acc } }));
const gas = 10_000_000_000_000n;

const sender = as(10);
await sender.callFunctionRaw({ contractId: USDT, methodName: "mint", args: { account_id: id(10), amount: "5000000" }, gas, waitUntil: "FINAL" });
const ms = [];
for (let n = 0; n < 5; n++) {
  const t0 = performance.now();
  await sender.callFunctionRaw({ contractId: USDT, methodName: "ft_transfer", args: { receiver_id: id(11 + (n % 3)), amount: "1000000", memo: `UM-137 s3 ${n + 1}` }, gas, deposit: 1n, waitUntil: "FINAL" });
  ms.push(Math.round(performance.now() - t0));
}
const sorted = [...ms].sort((a, b) => a - b);

// no cash: a member tries to pay 1.0 USDT more than it holds (all aux members were minted some mock USDT by earlier runs, so "zero" is "less than the price")
const poor = 14;
const held = await balance(id(poor));
let refusal = null;
try {
  await as(poor).callFunctionRaw({ contractId: USDT, methodName: "ft_transfer", args: { receiver_id: id(0), amount: String(held + 1_000_000n), memo: "UM-137 no cash" }, gas, deposit: 1n, waitUntil: "FINAL" });
  refusal = "NOT REFUSED";
} catch (e) {
  refusal = String(e?.message ?? e).split("\n")[0].slice(0, 200);
}
console.log(JSON.stringify({
  rpc: RPC, token: USDT,
  latencyMsToFinal: { runs: ms, min: sorted[0], median: sorted[2], max: sorted[4] },
  noCash: { member: id(poor), heldUnits: held.toString(), triedToPayUnits: (held + 1_000_000n).toString(), result: refusal },
}, null, 2));
