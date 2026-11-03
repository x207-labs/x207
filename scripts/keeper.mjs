#!/usr/bin/env node
// UM-022: keeper epoch. Memanggil close_epoch, commit_epoch, dan finalize_epoch tepat pada waktunya, tanpa input operator.
//
// Pakai (dari akar payung):
//   KEEPER_SECRET_KEY=ed25519:... node scripts/keeper.mjs --rpc-url <url> --contract x207-circle.test.near --account keeper.test.near [--interval 10] [--once] [--prune-lag 2]
// Kunci hanya dibaca dari env KEEPER_SECRET_KEY dan tidak pernah dicetak. Log: satu baris JSON per transaksi.
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { keeperPass, PRUNE_GAS } from "./lib/keeper.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { Account, JsonRpcProvider, KeyPairSigner } = createRequire(resolve(here, "../sdk/package.json"))("near-api-js");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, arg, i, all) => (arg.startsWith("--") ? [...acc, [arg.slice(2), all[i + 1]?.startsWith("--") ? true : (all[i + 1] ?? true)]] : acc), []),
);
const secretKey = process.env.KEEPER_SECRET_KEY;
for (const [name, value] of [["--rpc-url", args["rpc-url"]], ["--contract", args.contract], ["--account", args.account], ["KEEPER_SECRET_KEY", secretKey]]) {
  if (!value || value === true) {
    console.error(`${name} wajib diisi`);
    process.exit(1);
  }
}

const provider = new JsonRpcProvider({ url: args["rpc-url"] });
const account = new Account(args.account, provider, KeyPairSigner.fromSecretKey(secretKey));
const view = async (method, viewArgs) => (await provider.callFunction({ contractId: args.contract, method, args: viewArgs, blockQuery: { finality: "final" } })) ?? null;
const send = async ({ methodName, args: callArgs }) => {
  const result = await account.callFunctionRaw({ contractId: args.contract, methodName, args: callArgs, deposit: 0n, gas: 200_000_000_000_000n, waitUntil: "FINAL" });
  return result.transaction.hash;
};
// `--prune-lag N`: panggil prune_epoch untuk epoch finalized yang sudah N epoch di belakang (interface 0.0.8). Bukan bawaan: yang dibuang tidak terbaca lagi.
const prune = args["prune-lag"] && args["prune-lag"] !== true
  ? {
      lag: Number(args["prune-lag"]),
      call: async ({ epoch, maxItems }) => {
        const result = await account.callFunctionRaw({ contractId: args.contract, methodName: "prune_epoch", args: { epoch, max_items: maxItems }, deposit: 0n, gas: PRUNE_GAS, waitUntil: "FINAL" });
        const value = result.status?.SuccessValue;
        return { hash: result.transaction.hash, removed: value ? JSON.parse(Buffer.from(value, "base64").toString("utf8")) : 0 };
      },
    }
  : undefined;
const chainNowMs = async () => Number(BigInt((await provider.viewBlock({ finality: "optimistic" })).header.timestamp_nanosec) / 1_000_000n);
const log = (entry) => console.log(JSON.stringify(entry));

const intervalMs = Number(args.interval ?? 10) * 1000;
do {
  try {
    await keeperPass({ view, send, chainNowMs, log, ...(prune ? { prune } : {}) });
  } catch (error) {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error), at: new Date().toISOString() }));
  }
  if (args.once) break;
  await new Promise((r) => setTimeout(r, intervalMs));
} while (true);
