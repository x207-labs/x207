#!/usr/bin/env node
// UM-008: create the contract account and the six agent sub-accounts of the demo circle.
//
// Usage (from the umbrella repo root):
//   node scripts/create-accounts.mjs --network sandbox --rpc-url <url> --funder-id test.near --funder-key-env X207_FUNDER_KEY
//   node scripts/create-accounts.mjs --network testnet            (needs the near CLI; sends public-network transactions)
//
// Optional: --contract-id <id>, --keys-dir <dir> (default .keys). Keys are written to
// <keys-dir>/<network>/<account>.json with mode 0600. Secret keys are never printed.
// A second run reports the accounts that exist and skips them.
import { resolve } from "node:path";
import { ensureAccounts, NETWORKS } from "./lib/accounts.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, arg, i, all) => (arg.startsWith("--") ? [...acc, [arg.slice(2), all[i + 1]]] : acc), []),
);
const network = args.network;
if (!NETWORKS[network]) {
  console.error(`--network must be one of: ${Object.keys(NETWORKS).join(", ")}`);
  process.exit(1);
}
const rpcUrl = args["rpc-url"] ?? NETWORKS[network].rpcUrl;
if (!rpcUrl) {
  console.error("--rpc-url is required for sandbox");
  process.exit(1);
}
let funder;
if (network === "sandbox") {
  const secretKey = process.env[args["funder-key-env"] ?? "X207_FUNDER_KEY"];
  if (!args["funder-id"] || !secretKey) {
    console.error("sandbox needs --funder-id and the funder secret key in the env var named by --funder-key-env (default X207_FUNDER_KEY)");
    process.exit(1);
  }
  funder = { accountId: args["funder-id"], secretKey };
}

const results = await ensureAccounts({
  network,
  rpcUrl,
  contractId: args["contract-id"] ?? NETWORKS[network].contractId,
  keysDir: resolve(args["keys-dir"] ?? ".keys"),
  funder,
  log: console.log,
});
const missing = results.filter((r) => BigInt(r.balance) <= 0n);
if (missing.length) {
  console.error(`accounts without balance: ${missing.map((r) => r.accountId).join(", ")}`);
  process.exit(1);
}
console.log(`${results.length} accounts ready on ${network}`);
