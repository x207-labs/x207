// UM-022: satu putaran keeper. Fase dibaca dari `get_epoch` (fase turunan `cutoff` dan `commit`, K-28), jadi menjalankan
// ulang tidak mengulang langkah yang sudah terkirim. Aturan:
//   cutoff                              -> close_epoch(n)
//   commit                              -> commit_epoch(n)
//   payment_window dan sudah lewat payment_deadline -> finalize_epoch(n)
//   finalized dan sudah `prune.lag` epoch di belakang (opsional) -> prune_epoch(n, 200) sampai hasilnya 0
const NS_PER_MS = 1_000_000n;

/** Entries one `prune_epoch` call may take (the contract caps a call at 200 as well). */
export const PRUNE_MAX_ITEMS = 200;
/**
 * Gas attached to `prune_epoch`. Measured by the review of the contract: 196 items used 70.2 Tgas, so 100 Tgas is the least that is safe for 200 items and
 * 200 Tgas leaves a margin of almost three times for a bundle of 64 legs that costs more than the average entry.
 */
export const PRUNE_GAS = 200_000_000_000_000n;
export const PRUNE_MIN_GAS = 100_000_000_000_000n;

/**
 * SV-020: prepaid gas per method. A transaction reserves its prepaid gas times the gas price from the balance of the signer and refunds what is not burnt, so 200 Tgas for
 * every call reserved 0.2 NEAR (testnet) for calls that burn 3 to 70 Tgas (CT-100: close_epoch 3.0, commit_epoch 69.4 for 210 edges, finalize_epoch 9.3; 64 defaults 64.4).
 */
export const KEEPER_GAS = {
  close_epoch: 20_000_000_000_000n,
  commit_epoch: 150_000_000_000_000n,
  finalize_epoch: 100_000_000_000_000n,
};

/**
 * The node reserves ten times the gas price (burn price 1e8, reserve 1e9 yoctoNEAR per gas on testnet) plus about 0.9 Tgas of fixed fees, that is 0.001 NEAR per Tgas
 * (measured, solver/src/submit/rpc.ts). `true` when `balance` (yoctoNEAR) covers the reserve of `gas` at the burn price `gasPrice`.
 */
export function canReserve(balance, gas, gasPrice) {
  return BigInt(balance) >= (BigInt(gas) + 900_000_000_000n) * BigInt(gasPrice) * 10n;
}

/**
 * @param {object} options
 * @param {(method: string, args: object) => Promise<any>} options.view view kontrak
 * @param {(call: { methodName: string, args: object }) => Promise<string>} options.send kirim transaksi, kembalikan hash
 * @param {() => Promise<number>} options.chainNowMs waktu blok terbaru (unix ms)
 * @param {(entry: object) => void} [options.log]
 * @param {number} [options.lookback] berapa epoch ke belakang yang diperiksa (default 3)
 * @param {{ lag: number, call: (c: { epoch: number, maxItems: number }) => Promise<{ hash: string, removed: number }>, maxRounds?: number }} [options.prune]
 *   interface 0.0.8: `prune_epoch` memberi kembali storage epoch `finalized` (pasangan, total peserta, bundle). Mati bila tidak diberikan, karena
 *   yang dibuang tidak terbaca lagi (`list_obligations`, `obligation`, `get_bundle` epoch itu): panggil hanya untuk epoch yang sudah `lag`
 *   epoch di belakang epoch berjalan, setelah indexer dan laporan membacanya. Satu epoch diulang sampai `removed` 0 (paling banyak `maxRounds`, default 20).
 * @returns {Promise<Array<{ method: string, epoch: number, hash: string, at: string }>>}
 */
export async function keeperPass({ view, send, chainNowMs, log = () => {}, lookback = 3, prune }) {
  const current = await view("get_epoch", {});
  if (!current) return [];
  const nowMs = await chainNowMs();
  const nowNs = BigInt(nowMs) * NS_PER_MS;
  const actions = [];
  for (let n = Math.max(1, current.epoch - lookback); n <= current.epoch; n++) {
    const epoch = n === current.epoch ? current : await view("get_epoch", { epoch: n });
    if (!epoch) continue;
    let method = null;
    if (epoch.phase === "cutoff") method = "close_epoch";
    else if (epoch.phase === "commit") method = "commit_epoch";
    else if (epoch.phase === "payment_window" && epoch.payment_deadline && nowNs >= BigInt(epoch.payment_deadline)) method = "finalize_epoch";
    if (!method) continue;
    const hash = await send({ methodName: method, args: { epoch: n }, gas: KEEPER_GAS[method] });
    const action = { method, epoch: n, hash, at: new Date().toISOString() };
    log(action);
    actions.push(action);
  }
  if (prune) {
    for (let n = Math.max(1, current.epoch - prune.lag - lookback); n <= current.epoch - prune.lag; n++) {
      const epoch = await view("get_epoch", { epoch: n });
      if (!epoch || epoch.phase !== "finalized") continue;
      // sudah dibersihkan bila tidak ada lagi pasangan yang terdaftar di epoch itu
      const edges = await view("list_obligations", { epoch: n, from_index: 0, limit: 1 });
      if (!Array.isArray(edges) || edges.length === 0) continue;
      for (let round = 0; round < (prune.maxRounds ?? 20); round++) {
        const { hash, removed } = await prune.call({ epoch: n, maxItems: PRUNE_MAX_ITEMS });
        const action = { method: "prune_epoch", epoch: n, hash, removed, at: new Date().toISOString() };
        log(action);
        actions.push(action);
        if (removed === 0) break;
      }
    }
  }
  return actions;
}
