// UM-022: satu putaran keeper. Fase dibaca dari `get_epoch` (fase turunan `cutoff` dan `commit`, K-28), jadi menjalankan
// ulang tidak mengulang langkah yang sudah terkirim. Aturan:
//   cutoff                              -> close_epoch(n)
//   commit                              -> commit_epoch(n)
//   payment_window dan sudah lewat payment_deadline -> finalize_epoch(n)
const NS_PER_MS = 1_000_000n;

/**
 * @param {object} options
 * @param {(method: string, args: object) => Promise<any>} options.view view kontrak
 * @param {(call: { methodName: string, args: object }) => Promise<string>} options.send kirim transaksi, kembalikan hash
 * @param {() => Promise<number>} options.chainNowMs waktu blok terbaru (unix ms)
 * @param {(entry: object) => void} [options.log]
 * @param {number} [options.lookback] berapa epoch ke belakang yang diperiksa (default 3)
 * @returns {Promise<Array<{ method: string, epoch: number, hash: string, at: string }>>}
 */
export async function keeperPass({ view, send, chainNowMs, log = () => {}, lookback = 3 }) {
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
  return actions;
}
