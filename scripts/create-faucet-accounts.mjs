#!/usr/bin/env node
// UM-009/UM-032: buat akun testnet lewat faucet (near-cli-rs `sponsor-by-faucet-service`), bukan dari akun deployer.
// Kunci disimpan di <keys-dir>/testnet/<akun>.json (mode 0600, format scripts/create-accounts.mjs); tidak pernah dicetak.
//   node scripts/create-faucet-accounts.mjs --keys-dir .keys acc1.testnet acc2.testnet ...
// Mengulang aman: akun yang sudah ada dilewati. Hanya testnet.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadOrCreateKey } from "./lib/accounts.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const { Account, JsonRpcProvider, KeyPairSigner, parseNearAmount } = createRequire(resolve(here, "../sdk/package.json"))("near-api-js");
const argv = process.argv.slice(2);
const dir = argv.indexOf("--keys-dir");
const keysDir = resolve(dir >= 0 ? argv.splice(dir, 2)[1] : ".keys");
const accounts = argv;
if (accounts.length === 0 || accounts.some((a) => !a.endsWith(".testnet"))) {
  console.error("sebutkan akun berakhiran .testnet");
  process.exit(1);
}
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.fastnear.com" });
for (const accountId of accounts) {
  const key = loadOrCreateKey(keysDir, "testnet", accountId);
  const exists = await provider.viewAccount({ accountId }).then(() => true, () => false);
  if (exists) {
    console.log(`exists ${accountId}`);
    continue;
  }
  // Faucet punya batas per klien; sub-akun `<nama>.<induk>.testnet` dibuat oleh induknya (2 NEAR) bila kuncinya ada di keys-dir.
  const labels = accountId.replace(/\.testnet$/, "").split(".");
  if (labels.length > 1) {
    const parentId = `${labels.slice(1).join(".")}.testnet`;
    const parentKey = loadOrCreateKey(keysDir, "testnet", parentId);
    const parent = new Account(parentId, provider, KeyPairSigner.fromSecretKey(parentKey.toString()));
    await parent.createAccount({ newAccountId: accountId, publicKey: key.getPublicKey(), nearToTransfer: BigInt(parseNearAmount(2)) });
    const sub = await provider.viewAccount({ accountId });
    console.log(`created ${accountId} balance ${Number(BigInt(sub.amount) / 10n ** 21n) / 1000} NEAR (dari ${parentId})`);
    continue;
  }
  const run = spawnSync(
    "near",
    ["account", "create-account", "sponsor-by-faucet-service", accountId, "use-manually-provided-public-key", key.getPublicKey().toString(), "network-config", "testnet", "create"],
    { encoding: "utf8" },
  );
  if (run.status !== 0) {
    console.error(`gagal membuat ${accountId} (exit ${run.status}): ${(run.stderr || run.stdout).split("\n").slice(-4).join(" ").slice(0, 300)}`);
    process.exit(1);
  }
  const state = await provider.viewAccount({ accountId });
  console.log(`created ${accountId} balance ${Number(BigInt(state.amount) / 10n ** 21n) / 1000} NEAR`);
}
