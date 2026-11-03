#!/usr/bin/env node
// UM-075: fills the registry D10 of the circle contract with the whole barter catalog (`set_asset_class`, owner only), then checks `list_asset_classes`.
// The catalog is in scripts/lib/asset-catalog.mjs (90 kinds of the vault note, class E left out, the refused kinds as class X).
//
//   OWNER_SECRET_KEY=ed25519:... node scripts/register-asset-classes.mjs --rpc-url <url> --contract x207-circle.test.near --owner dao.test.near [--dry-run]
//
// The owner of a circle is the Sputnik DAO on testnet and mainnet: a DAO has no key, so there each `set_asset_class` goes through a proposal, and this script
// is for a circle whose owner holds a key (the sandbox, a rehearsal). `--dry-run` reads the registry and prints what it would write; it needs no key.
// The key is read from OWNER_SECRET_KEY only and never printed. Output: one JSON line per transaction, then one summary line.
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG, registerCatalog } from "./lib/asset-catalog.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { Account, JsonRpcProvider, KeyPairSigner } = createRequire(resolve(here, "../sdk/package.json"))("near-api-js");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, arg, i, all) => (arg.startsWith("--") ? [...acc, [arg.slice(2), all[i + 1]?.startsWith("--") ? true : (all[i + 1] ?? true)]] : acc), []),
);
const dryRun = args["dry-run"] === true;
const secretKey = process.env.OWNER_SECRET_KEY;
for (const [name, value] of [["--rpc-url", args["rpc-url"]], ["--contract", args.contract], ...(dryRun ? [] : [["--owner", args.owner], ["OWNER_SECRET_KEY", secretKey]])]) {
  if (!value || value === true) {
    console.error(`${name} wajib diisi`);
    process.exit(1);
  }
}

const provider = new JsonRpcProvider({ url: args["rpc-url"] });
const view = async (method, viewArgs) => (await provider.callFunction({ contractId: args.contract, method, args: viewArgs, blockQuery: { finality: "optimistic" } })) ?? null; // the transactions wait for EXECUTED_OPTIMISTIC, so the check reads the same head
const account = dryRun ? null : new Account(args.owner, provider, KeyPairSigner.fromSecretKey(secretKey));
const send = async ({ methodName, args: callArgs }) => {
  const result = await account.callFunctionRaw({ contractId: args.contract, methodName, args: callArgs, deposit: 0n, gas: 100_000_000_000_000n, waitUntil: "EXECUTED_OPTIMISTIC" });
  return result.transaction.hash;
};
const log = (entry) => console.log(JSON.stringify(entry));

const outcome = await registerCatalog({ view, send, log, dryRun });
console.log(JSON.stringify({ summary: { catalog: CATALOG.length, written: outcome.written.length, skipped: outcome.skipped.length, missing: outcome.missing, wrong: outcome.wrong, registry: outcome.total ?? null, dryRun } }));
process.exit(outcome.missing.length === 0 && outcome.wrong.length === 0 ? 0 : 1);
