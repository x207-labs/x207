#!/usr/bin/env node
// UM-022: keeper epoch. Memanggil close_epoch, commit_epoch, dan finalize_epoch tepat pada waktunya, tanpa input operator.
//
// Pakai (dari akar payung):
//   KEEPER_SECRET_KEY=ed25519:... node scripts/keeper.mjs --rpc-url <url[,url2,...]> --contract x207-circle.test.near --account keeper.test.near [--interval 10] [--once] [--prune-lag 2] [--lookback 3]
// Kunci hanya dibaca dari env KEEPER_SECRET_KEY dan tidak pernah dicetak. Log: satu baris JSON per transaksi.
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canReserve, keeperPass, PRUNE_GAS } from "./lib/keeper.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { Account, FailoverRpcProvider, JsonRpcProvider, KeyPairSigner } = createRequire(resolve(here, "../sdk/package.json"))("near-api-js");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, arg, i, all) => (arg.startsWith("--") ? [...acc, [arg.slice(2), all[i + 1]?.startsWith("--") ? true : (all[i + 1] ?? true)]] : acc), []),
);
const secretKey = process.env.KEEPER_SECRET_KEY;
for (const [name, value] of [["--rpc-url", args["rpc-url"]], ["--contract", args.contract], ["--account", args.account], ["KEEPER_SECRET_KEY", secretKey]]) {
  if (!value || value === true) {
    console.error(`${name} is required`);
    process.exit(1);
  }
}

// `--rpc-url a,b,c`: several endpoints, comma separated. On an error (429, 5xx, timeout) the next endpoint is tried, so one rate-limited public RPC does not stop the keeper.
const rpcUrls = String(args["rpc-url"]).split(",").map((u) => u.trim()).filter(Boolean);
const provider = rpcUrls.length > 1 ? new FailoverRpcProvider(rpcUrls.map((url) => new JsonRpcProvider({ url }))) : new JsonRpcProvider({ url: rpcUrls[0] });
const account = new Account(args.account, provider, KeyPairSigner.fromSecretKey(secretKey));
const view = async (method, viewArgs) => (await provider.callFunction({ contractId: args.contract, method, args: viewArgs, blockQuery: { finality: "final" } })) ?? null;
// SV-020: the balance is checked against the reserve (gas times gas price) before a transaction is signed; if it is short the keeper logs a warning with the amounts and does not send
const reserveOk = async (gas) => {
  const balance = BigInt((await provider.viewAccount({ accountId: args.account })).amount);
  const gasPrice = BigInt((await provider.viewGasPrice(null)).gas_price);
  if (canReserve(balance, gas, gasPrice)) return true;
  console.error(JSON.stringify({ warn: "balance_short", account: args.account, balance: balance.toString(), needed: ((gas + 900_000_000_000n) * gasPrice * 10n).toString(), gasTgas: Number(gas / 1_000_000_000_000n), at: new Date().toISOString() }));
  return false;
};
const send = async ({ methodName, args: callArgs, gas = 200_000_000_000_000n }) => {
  if (!(await reserveOk(gas))) throw new Error(`balance of ${args.account} is below the reserve of ${methodName}`);
  const result = await account.callFunctionRaw({ contractId: args.contract, methodName, args: callArgs, deposit: 0n, gas, waitUntil: "FINAL" });
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
// `--lookback N`: how many epochs behind the current one are checked (default 3). A circle that was left alone for longer needs a larger number to catch up (UM-118).
const lookback = args.lookback && args.lookback !== true ? Number(args.lookback) : undefined;
const chainNowMs = async () => Number(BigInt((await provider.viewBlock({ finality: "optimistic" })).header.timestamp_nanosec) / 1_000_000n);
const log = (entry) => console.log(JSON.stringify(entry));

const intervalMs = Number(args.interval ?? 10) * 1000;
do {
  try {
    await keeperPass({ view, send, chainNowMs, log, ...(lookback ? { lookback } : {}), ...(prune ? { prune } : {}) });
  } catch (error) {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error), at: new Date().toISOString() }));
  }
  if (args.once) break;
  await new Promise((r) => setTimeout(r, intervalMs));
} while (true);
