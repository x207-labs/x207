#!/usr/bin/env node
// UM-116: helpers for docs/join-the-circle.md, on NEAR testnet only. Three small commands; the keys stay in a folder that you name (mode 0600 files made by create-faucet-accounts.mjs).
//   node scripts/guide-testnet.mjs voucher-key                                   prints a new voucher key pair (the secret is for X207_AGENT_VOUCHER_KEY; keep it out of git)
//   node scripts/guide-testnet.mjs mint <account> --keys-dir <dir> [--amount 200000000]   mints mock USDT (6 decimals) to <account> on the testnet token of the circle
//   node scripts/guide-testnet.mjs close-epoch <account> --keys-dir <dir> [--circle x207-v013.testnet]   closes the open epoch once its cutoff has passed (any member may; needed when no keeper runs)
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "sdk/package.json"));
const { Account, JsonRpcProvider, KeyPairSigner } = require("near-api-js");
const RPC = "https://rpc.testnet.fastnear.com";
const USDT = "usdt.x207-deployer.testnet";
const [command, account, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : fallback);

const signer = (id) => {
  const dir = flag("--keys-dir", ".keys");
  const file = join(resolve(dir), "testnet", `${id}.json`);
  const { secret_key } = JSON.parse(readFileSync(file, "utf8"));
  return new Account(id, new JsonRpcProvider({ url: RPC }), KeyPairSigner.fromSecretKey(secret_key));
};
const view = async (contract, method, args = {}) => {
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }) }).then((r) => r.json());
  return JSON.parse(Buffer.from(res.result.result).toString());
};

if (command === "voucher-key") {
  const { generateVoucherKeypair } = await import(join(root, "sdk/packages/core/dist/index.js"));
  const k = generateVoucherKeypair();
  console.log(`secret ${k.secretKey}\npublic ${k.publicKey}`);
} else if (command === "mint" && account) {
  const amount = flag("--amount", "200000000");
  const started = Date.now();
  await signer(account).callFunction({ contractId: USDT, methodName: "mint", args: { account_id: account, amount }, gas: 30_000_000_000_000n, deposit: 0n });
  console.log(`minted ${Number(amount) / 1e6} mock USDT to ${account} in ${Date.now() - started} ms`);
} else if (command === "close-epoch" && account) {
  const circle = flag("--circle", "x207-v013.testnet");
  const epoch = await view(circle, "get_epoch");
  if (epoch.phase !== "cutoff") {
    console.log(`epoch ${epoch.epoch} is ${epoch.phase}: nothing to close`);
  } else {
    const started = Date.now();
    const outcome = await signer(account).callFunctionRaw({ contractId: circle, methodName: "close_epoch", args: { epoch: epoch.epoch }, gas: 20_000_000_000_000n, deposit: 0n, waitUntil: "FINAL" });
    const hash = outcome?.transaction?.hash ?? outcome?.transaction_outcome?.id ?? "unknown";
    const next = await view(circle, "get_epoch");
    console.log(`closed epoch ${epoch.epoch}; epoch ${next.epoch} is ${next.phase} (${Date.now() - started} ms)\ntransaction ${hash}\nhttps://testnet.nearblocks.io/txns/${hash}`);
  }
} else {
  console.error("usage: guide-testnet.mjs voucher-key | mint <account> --keys-dir <dir> | close-epoch <account> --keys-dir <dir>");
  process.exit(2);
}
