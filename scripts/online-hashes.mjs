// UM-190: ask the chains whether the transaction hashes quoted in the docs exist.
// NEAR testnet: JSON-RPC `tx` (needs the signer, so every account named in the same file is tried), with failover across endpoints.
// Base Sepolia: `eth_getTransactionReceipt`, also with failover.
// Pure of file access: the caller passes the texts and an optional `fetchImpl`, so tests run without a network.
import { readFileSync } from "node:fs";

// Archival endpoints first: the plain RPCs forget transactions after a few epochs (verified: 2026-11-02 transactions are UNKNOWN there and found on archival).
export const NEAR_RPC = ["https://archival-rpc.testnet.fastnear.com", "https://archival-rpc.testnet.near.org", "https://rpc.testnet.fastnear.com", "https://near-testnet.drpc.org"];
export const BASE_RPC = ["https://sepolia.base.org", "https://base-sepolia-rpc.publicnode.com", "https://base-sepolia.drpc.org"];

const NEAR_HASH = /(?<![A-Za-z0-9:])[1-9A-HJ-NP-Za-km-z]{43,44}(?![A-Za-z0-9])/g;
const EVM_HASH = /(?<![A-Za-z0-9])0x[0-9a-fA-F]{64}(?![A-Za-z0-9])/g;
const ACCOUNT = /[a-z0-9][a-z0-9_.-]*\.testnet|\b[0-9a-f]{64}\b/g;
// Words just before a token that say it is not a transaction hash.
const NOT_A_TX = /(code ?hash|code_hash|codehash|block|receipt|sha-?256|wasm|terms_hash|edgesHash|key|signature|nonce|address)[^A-Za-z0-9]{0,6}$/i;
const JSON_TX_KEYS = new Set(["hash", "txHash", "tx_hash", "tx", "transactionHash", "hashes", "txs"]);
const JSON_SKIP_KEYS = /code.?hash|terms_hash|edgesHash|block|receipt|sha/i;
const looksMixed = (s) => /[0-9]/.test(s) && /[a-z]/.test(s) && /[A-Z]/.test(s);

/** Collects the hashes in one file. Returns [{ hash, chain, senders }] and [{ hash, reason }] for tokens that are deliberately not checked. */
export function hashesIn(path, text) {
  const found = new Map();
  const skipped = [];
  const senders = [...new Set(text.match(ACCOUNT) ?? [])];
  const add = (hash, chain) => { if (!found.has(hash)) found.set(hash, { hash, chain, senders, path }); };
  if (path.endsWith(".json")) {
    let data;
    try { data = JSON.parse(text); } catch { data = null; }
    const walk = (value, key) => {
      if (Array.isArray(value)) return value.forEach((v) => walk(v, key));
      if (value && typeof value === "object") return Object.entries(value).forEach(([k, v]) => walk(v, k));
      if (typeof value !== "string") return;
      const evm = value.match(/0x[0-9a-fA-F]{64}/);
      if (evm) return add(evm[0], "base-sepolia");
      if (key && JSON_SKIP_KEYS.test(key) && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(value)) return skipped.push({ hash: value, reason: `${key}: not a transaction` });
      if (key && JSON_TX_KEYS.has(key) && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(value)) add(value, "near-testnet");
    };
    if (data) walk(data, null);
    return { hashes: [...found.values()], skipped };
  }
  for (const line of text.split("\n")) {
    for (const m of line.matchAll(EVM_HASH)) add(m[0], "base-sepolia");
    for (const m of line.matchAll(NEAR_HASH)) {
      if (!looksMixed(m[0])) continue;
      const before = line.slice(Math.max(0, m.index - 24), m.index);
      if (/code ?hash|code_hash/i.test(line.slice(Math.max(0, m.index - 70), m.index))) skipped.push({ hash: m[0], reason: "named as a code hash, not a transaction" });
      else if (NOT_A_TX.test(before)) skipped.push({ hash: m[0], reason: `named as "${before.match(NOT_A_TX)[1]}", not a transaction` });
      else if (/mainnet/i.test(line)) skipped.push({ hash: m[0], reason: "line mentions mainnet; the testnet RPC cannot answer" });
      else add(m[0], "near-testnet");
    }
  }
  return { hashes: [...found.values()], skipped };
}

async function rpc(endpoints, method, params, fetchImpl, retryMs) {
  let last = "no endpoint";
  let unknown = null;
  for (const url of endpoints) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        if (res.status === 429 && attempt < 3) { await new Promise((r) => setTimeout(r, (retryMs ?? 2000) * 3 ** attempt)); continue; }
        if (!res.ok) { last = `${url} answered HTTP ${res.status}`; break; }
        const body = await res.json();
        // A plain (non-archival) NEAR RPC forgets old transactions, so its UNKNOWN_TRANSACTION proves nothing: ask the next endpoint.
        if (/UNKNOWN_TRANSACTION/.test(JSON.stringify(body.error ?? "")) && !/archival/.test(url)) { unknown = { body, url }; break; }
        return { body, url };
      } catch (e) { last = `${url}: ${e.message}`; break; }
    }
  }
  if (unknown) return { inconclusive: true, ...unknown, last };
  return { unreachable: last };
}

/** NEAR: found when some endpoint returns this very transaction. Failed when an endpoint answers UNKNOWN_TRANSACTION for every candidate signer. */
export async function checkNear({ hash, senders }, fetchImpl = fetch, endpoints = NEAR_RPC, hint = { sender: null }) {
  // Archival nodes answered for any signer in a spot check (UM-190), so a few guesses are enough to call a hash unknown.
  const order = [...new Set([hint.sender, ...senders].filter(Boolean))].slice(0, 4);
  if (order.length === 0) return { status: "skipped", reason: "sender unknown (no account named in the file to use as signer)" };
  let unknown = 0;
  for (const sender of order) {
    const r = await rpc(endpoints, "tx", { tx_hash: hash, sender_account_id: sender, wait_until: "NONE" }, fetchImpl);
    if (r.unreachable) return { status: "skipped", reason: `RPC unreachable (${r.unreachable})` };
    if (r.inconclusive) return { status: "skipped", reason: `only non-archival RPCs answered (unknown there; archival: ${r.last})` };
    const result = r.body.result;
    if (result?.transaction?.hash === hash) { hint.sender = sender; return { status: "passed", sender, outcome: result.final_execution_status }; }
    if (r.body.error && !/UNKNOWN_TRANSACTION|not found/i.test(JSON.stringify(r.body.error))) return { status: "skipped", reason: `RPC error ${JSON.stringify(r.body.error.cause ?? r.body.error.name ?? r.body.error).slice(0, 80)}` };
    unknown++;
  }
  return { status: "failed", reason: `unknown to the testnet RPC (${unknown} signer guesses tried)` };
}

/** Base Sepolia: found when the receipt carries this transaction hash. */
export async function checkEvm({ hash }, fetchImpl = fetch, endpoints = BASE_RPC) {
  const r = await rpc(endpoints, "eth_getTransactionReceipt", [hash], fetchImpl);
  if (r.unreachable) return { status: "skipped", reason: `RPC unreachable (${r.unreachable})` };
  const receipt = r.body.result;
  if (receipt?.transactionHash?.toLowerCase() === hash.toLowerCase()) return { status: "passed", outcome: receipt.status === "0x1" ? "success" : "reverted on chain" };
  if (r.body.error) return { status: "skipped", reason: `RPC error ${JSON.stringify(r.body.error).slice(0, 80)}` };
  return { status: "failed", reason: "no receipt on Base Sepolia" };
}

/** Checks every hash in `files` ([{path, text}]). Returns counts and the rows that failed or were skipped. */
export async function verifyHashes(files, { fetchImpl = fetch, concurrency = 1, minGapMs = 300, only = null, nearEndpoints = NEAR_RPC, baseEndpoints = BASE_RPC } = {}) {
  // The public testnet RPCs share one IP with the other sessions and answer 429 under load: one request at a time, at least `minGapMs` apart.
  const rawFetch = fetchImpl;
  let next = 0;
  fetchImpl = async (url, init) => {
    const at = Math.max(Date.now(), next);
    next = at + minGapMs;
    if (at > Date.now()) await new Promise((r) => setTimeout(r, at - Date.now()));
    return rawFetch(url, init);
  };
  const todo = new Map();
  const skipped = new Map();
  for (const { path, text } of files) {
    const { hashes, skipped: s } = hashesIn(path, text);
    for (const h of hashes) {
      const have = todo.get(h.hash);
      if (have) { have.senders = [...new Set([...have.senders, ...h.senders])]; have.paths.add(path); } else todo.set(h.hash, { ...h, paths: new Set([path]) });
    }
    for (const x of s) if (!todo.has(x.hash)) skipped.set(x.hash, { hash: x.hash, status: "skipped", reason: x.reason, paths: new Set([path]) });
  }
  // `only`: re-check just these hashes (a Set), e.g. the ones an earlier run had to skip.
  if (only) { for (const k of [...todo.keys()]) if (!only.has(k)) todo.delete(k); skipped.clear(); }
  const hints = new Map();
  const queue = [...todo.values()];
  const rows = [];
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const hint = hints.get(item.path) ?? { sender: null };
      hints.set(item.path, hint);
      const r = item.chain === "base-sepolia" ? await checkEvm(item, fetchImpl, baseEndpoints) : await checkNear(item, fetchImpl, nearEndpoints, hint);
      rows.push({ hash: item.hash, chain: item.chain, paths: [...item.paths], ...r });
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  for (const s of skipped.values()) if (!todo.has(s.hash)) rows.push({ hash: s.hash, chain: "none", paths: [...s.paths], status: "skipped", reason: s.reason });
  const count = (st) => rows.filter((r) => r.status === st).length;
  return {
    found: rows.length,
    checked: count("passed") + count("failed"),
    passed: count("passed"),
    failed: count("failed"),
    skipped: count("skipped"),
    rows,
  };
}

export function readFiles(paths, root) {
  return paths.map((p) => ({ path: p, text: readFileSync(`${root}/${p}`, "utf8") }));
}
