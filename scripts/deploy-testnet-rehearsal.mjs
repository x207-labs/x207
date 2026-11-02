#!/usr/bin/env node
// UM-032: deploy kontrak gladi testnet dengan params pendek (epoch 5 menit) ke akun faucet, bukan akun deployer bersama.
//   node scripts/deploy-testnet-rehearsal.mjs --keys-dir .keys --circle x207r-circle.testnet --usdt x207r-usdt.testnet --owner x207r-deploy.testnet
// Hanya testnet. Kunci dibaca dari <keys-dir>/testnet/<akun>.json dan tidak dicetak. Mengulang tidak men-deploy ulang akun yang sudah memuat kode.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const here = fileURLToPath(new URL(".", import.meta.url));
const { Account, JsonRpcProvider, KeyPairSigner } = createRequire(resolve(here, "../sdk/package.json"))("near-api-js");
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`--${name} wajib`);
  return process.argv[i + 1];
};
const keysDir = resolve(arg("keys-dir"));
const [circleId, usdtId, ownerId] = [arg("circle"), arg("usdt"), arg("owner")];
for (const id of [circleId, usdtId, ownerId]) if (!id.endsWith(".testnet")) throw new Error("hanya akun .testnet");
const provider = new JsonRpcProvider({ url: "https://rpc.testnet.fastnear.com" });
const accountOf = (id) => new Account(id, provider, KeyPairSigner.fromSecretKey(JSON.parse(readFileSync(resolve(keysDir, "testnet", `${id}.json`), "utf8")).secret_key));
const hasCode = async (id) => (await provider.viewAccount({ accountId: id })).code_hash !== "11111111111111111111111111111111";

const SHORT_PARAMS = {
  epoch_length: 300, payment_window: 900, proposal_window: 60, base_limit_ratio: 8000, limit_growth: 1000,
  limit_cap: "1000000000", limit_decay: 0, fees: { clearing_fee_bps: 0, solver_fee_bps: 0 }, admission: "open",
};
const contracts = resolve(here, "../contracts/target/near");

for (const [id, wasm, initArgs] of [
  [usdtId, "mock_ft/mock_ft.wasm", {}],
  [circleId, "x207_circle.wasm", { owner_id: ownerId, circle_id: "agents-main", usdt_token_id: usdtId, intents_id: "intents.testnet", params: SHORT_PARAMS }],
]) {
  if (await hasCode(id)) {
    console.log(`sudah ada kode di ${id}, dilewati`);
    continue;
  }
  const code = readFileSync(resolve(contracts, wasm));
  const account = accountOf(id);
  const deployed = await account.deployContract(code);
  console.log(`deploy ${id} sha256 ${createHash("sha256").update(code).digest("hex")} tx ${deployed.transaction.hash}`);
  const init = await account.callFunctionRaw({ contractId: id, methodName: "new", args: initArgs, deposit: 0n, gas: 100_000_000_000_000n, waitUntil: "FINAL" });
  console.log(`new ${id} tx ${init.transaction.hash}`);
}
