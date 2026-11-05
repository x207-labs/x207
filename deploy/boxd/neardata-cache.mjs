#!/usr/bin/env node
// BE-098: one local cache in front of neardata for every backend on the machine. neardata allows 30 blocks a minute per IP, and three indexers
// (v013, v014, v015) each polled `last_block/final` and fetched blocks on their own, so the allowance was spent three times.
//   - GET /v0/block/{height}: a final block never changes, so a 200 answer is kept (up to MAX_BLOCKS) and the same height is fetched once;
//   - GET /v0/last_block/final: one answer is shared for HEAD_TTL_MS (default 5 s) between all callers;
//   - every call that goes upstream is queued and spaced by MIN_GAP_MS (default 2100 ms), so the machine itself stays under 30 a minute;
//   - an upstream error (429, 5xx) is passed on as it is and is not kept; the indexers already retry with a backoff.
// Run: NEARDATA_UPSTREAM=https://testnet.neardata.xyz PORT=8099 node neardata-cache.mjs      The backends use X207_NEARDATA_URL=http://127.0.0.1:8099
import { createServer } from "node:http";

const upstream = (process.env.NEARDATA_UPSTREAM ?? "https://testnet.neardata.xyz").replace(/\/+$/, "");
const port = Number(process.env.PORT ?? 8099);
const minGapMs = Number(process.env.MIN_GAP_MS ?? 2100);
const headTtlMs = Number(process.env.HEAD_TTL_MS ?? 5000);
const maxBlocks = Number(process.env.MAX_BLOCKS ?? 2000);

const blocks = new Map(); // path -> { status, type, body }
const inflight = new Map(); // path -> Promise<{ status, type, body }>
let head = null; // { at, answer }
let lastCall = 0;
let queue = Promise.resolve();
const stats = { hits: 0, upstream: 0, errors: 0 };

const fetchUpstream = (path) => {
  const run = queue.then(async () => {
    const wait = lastCall + minGapMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    stats.upstream += 1;
    try {
      const response = await fetch(`${upstream}${path}`, { signal: AbortSignal.timeout(25_000) });
      return { status: response.status, type: response.headers.get("content-type") ?? "application/json", body: await response.text() };
    } catch (error) {
      stats.errors += 1;
      return { status: 502, type: "application/json", body: JSON.stringify({ error: String(error?.message ?? error) }) };
    }
  });
  queue = run.then(() => undefined, () => undefined);
  return run;
};

const answer = async (path) => {
  if (path === "/v0/last_block/final") {
    if (head && Date.now() - head.at < headTtlMs) {
      stats.hits += 1;
      return head.answer;
    }
  } else if (blocks.has(path)) {
    stats.hits += 1;
    return blocks.get(path);
  }
  if (inflight.has(path)) return inflight.get(path);
  const pending = fetchUpstream(path).then((result) => {
    inflight.delete(path);
    const futureBlock = result.body.includes('"type":"future_block"') || result.body.includes('"type": "future_block"');
    if (result.status === 200 && !futureBlock) {
      if (path === "/v0/last_block/final") head = { at: Date.now(), answer: result };
      else {
        if (blocks.size >= maxBlocks) blocks.delete(blocks.keys().next().value);
        blocks.set(path, result);
      }
    }
    return result;
  });
  inflight.set(path, pending);
  return pending;
};

createServer(async (req, res) => {
  const path = req.url ?? "/";
  if (path === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, cached: blocks.size, ...stats }));
    return;
  }
  if (req.method !== "GET" || !(path === "/v0/last_block/final" || /^\/v0\/block\/\d+$/.test(path))) {
    res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "only GET /v0/last_block/final and /v0/block/{height}" }));
    return;
  }
  const result = await answer(path);
  res.writeHead(result.status, { "content-type": result.type }).end(result.body);
}).listen(port, "127.0.0.1", () => console.log(JSON.stringify({ listening: `127.0.0.1:${port}`, upstream, minGapMs, headTtlMs })));
