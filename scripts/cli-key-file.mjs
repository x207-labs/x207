#!/usr/bin/env node
// UM-009 rehearsal: the key files of this repository hold {account_id, secret_key}; `near ... sign-with-access-key-file` (near-cli-rs) wants
// {account_id, public_key, private_key}. This writes that file for ONE account, mode 0600, and prints only its path (never the key).
//   node scripts/cli-key-file.mjs --keys-dir <dir> --network testnet --account <id> --out <file>
// Put --out outside every repository (the scratchpad or a temp folder) and delete it after the command. A mainnet key is never converted here:
// the owner signs mainnet commands with his own keychain (`sign-with-keychain`, the default of the printed commands).
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const { KeyPair } = createRequire(resolve(here, "../backend/package.json"))("near-api-js");

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0 || !argv[i + 1]) {
    console.error(`--${name} is required`);
    process.exit(1);
  }
  return argv[i + 1];
};
const network = arg("network");
if (network !== "testnet") {
  console.error("only testnet keys are converted; sign mainnet commands with the keychain of the owner");
  process.exit(1);
}
const account = arg("account");
const source = JSON.parse(readFileSync(resolve(arg("keys-dir"), network, `${account}.json`), "utf8"));
const secret = source.secret_key ?? source.private_key;
if (!secret) {
  console.error(`no secret_key in the key file of ${account}`);
  process.exit(1);
}
const pair = KeyPair.fromString(secret);
const out = resolve(arg("out"));
writeFileSync(out, JSON.stringify({ account_id: account, public_key: pair.getPublicKey().toString(), private_key: secret }), { mode: 0o600 });
chmodSync(out, 0o600);
console.log(out);
