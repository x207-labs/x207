// UM-022: satu putaran keeper. Fase dibaca dari `get_epoch` (fase turunan `cutoff` dan `commit`, K-28), jadi menjalankan
// ulang tidak mengulang langkah yang sudah terkirim. Aturan:
//   cutoff                              -> close_epoch(n)
//   commit                              -> commit_epoch(n)
//   payment_window dan sudah lewat payment_deadline -> finalize_epoch(n)
//   finalized dan sudah `prune.lag` epoch di belakang (opsional) -> prune_epoch(n, 200) sampai hasilnya 0
const NS_PER_MS = 1_000_000n;

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
    const hash = await send({ methodName: method, args: { epoch: n } });
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
        const { hash, removed } = await prune.call({ epoch: n, maxItems: 200 });
        const action = { method: "prune_epoch", epoch: n, hash, removed, at: new Date().toISOString() };
        log(action);
        actions.push(action);
        if (removed === 0) break;
      }
    }
  }
  return actions;
}
