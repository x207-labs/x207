#!/usr/bin/env node
// UM-151: four checks of the boxd machine `x207`, used by .github/workflows/monitor.yml (and by hand).
//   1. read API: GET <api>/healthz answers 200 and `db.ok` is true (status "degraded" because the indexer lags is not a failure) and the indexer is alive: `indexer.stale` is false and the cursor was written within
//      MAX_INDEXER_AGE seconds (an indexer that halts, as on 2026-11-05 at 04:05 on a nested `set_params` field, leaves the API up and the dashboard frozen)
//   2. hosted MCP: `initialize` on <mcp> answers a serverInfo.name
//   3. keeper heartbeat: the newest finalized epoch on the circle contract (read straight from NEAR RPC, so it does not depend on the machine) has a
//      payment_deadline younger than 2 * epoch_length + payment_window seconds (2 * 600 + 900 = 2100)
//   4. read model follows the chain: the epoch the API reports (`/params` currentEpoch) is at most MAX_EPOCH_LAG behind the epoch of the contract
// Prints one line per check. Exit code 0 when all pass, 1 when any fails. No dependencies; needs Node 18 or newer.
const API = process.env.MONITOR_API_URL || "https://x207.boxd.sh";
const MCP = process.env.MONITOR_MCP_URL ?? "https://mcp.x207.boxd.sh/mcp";
const RPC = process.env.MONITOR_RPC_URL ?? "https://rpc.testnet.fastnear.com";
const CONTRACT = process.env.MONITOR_CONTRACT ?? "x207-v013.testnet";
const MAX_AGE_SECONDS = Number(process.env.MONITOR_MAX_HEARTBEAT_AGE ?? 2 * 600 + 900);

const MAX_INDEXER_AGE = Number(process.env.MONITOR_MAX_INDEXER_AGE ?? 900);
const MAX_EPOCH_LAG = Number(process.env.MONITOR_MAX_EPOCH_LAG ?? 3);
const CIRCLE = process.env.MONITOR_CIRCLE ?? "agents-main";

const failures = [];
const report = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${detail}`);
  if (!ok) failures.push(`${name}: ${detail}`);
};

async function withRetry(fn) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  throw last;
}

async function view(method, args) {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "query",
    params: { request_type: "call_function", finality: "final", account_id: CONTRACT, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") },
  };
  const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const json = await response.json();
  if (!json.result?.result) throw new Error(`rpc ${method}: ${JSON.stringify(json.error ?? json).slice(0, 200)}`);
  return JSON.parse(Buffer.from(json.result.result).toString());
}

try {
  const health = await withRetry(async () => {
    const response = await fetch(`${API}/healthz`, { signal: AbortSignal.timeout(20_000) });
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
    return response.json();
  });
  report("api healthz", health.db?.ok === true, `HTTP 200, status ${health.status}, db.ok ${health.db?.ok}, indexer lag ${health.indexer?.lagBlocks} blocks`);
  const age = health.indexer?.secondsSinceUpdate;
  report("indexer alive", health.indexer?.stale !== true && typeof age === "number" && age <= MAX_INDEXER_AGE, `stale ${health.indexer?.stale}, cursor written ${age} s ago (limit ${MAX_INDEXER_AGE} s), problems ${JSON.stringify(health.problems ?? [])}`);
} catch (error) {
  report("api healthz", false, String(error.message ?? error));
}

try {
  const initialize = await withRetry(async () => {
    const response = await fetch(MCP, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "x207-monitor", version: "1" } } }),
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const data = text.split("\n").find((line) => line.startsWith("data:"))?.slice(5) ?? text;
    return JSON.parse(data);
  });
  const info = initialize.result?.serverInfo;
  report("mcp initialize", Boolean(info?.name), info ? `${info.name} ${info.version}` : "no serverInfo in the answer");
} catch (error) {
  report("mcp initialize", false, String(error.message ?? error));
}

try {
  const current = await withRetry(() => view("get_epoch", {}));
  let found = null;
  for (let epoch = current.epoch; epoch >= Math.max(1, current.epoch - 5) && !found; epoch -= 1) {
    const info = epoch === current.epoch ? current : await withRetry(() => view("get_epoch", { epoch }));
    if (info.phase === "finalized") found = info;
  }
  if (!found) {
    report("keeper heartbeat", false, `no finalized epoch among the newest 6 (current epoch ${current.epoch}, phase ${current.phase})`);
  } else {
    const age = Math.round(Date.now() / 1000 - Number(found.payment_deadline) / 1e9);
    report("keeper heartbeat", age <= MAX_AGE_SECONDS, `epoch ${found.epoch} finalized, payment_deadline ${age} s ago (limit ${MAX_AGE_SECONDS} s); current epoch ${current.epoch} ${current.phase}`);
  }
  try {
    const params = await withRetry(async () => {
      const response = await fetch(`${API}/x207/circles/${CIRCLE}/params`, { signal: AbortSignal.timeout(20_000) });
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
    const lag = current.epoch - Number(params.currentEpoch);
    report("read model epoch", lag <= MAX_EPOCH_LAG, `API epoch ${params.currentEpoch}, chain epoch ${current.epoch}, behind ${lag} (limit ${MAX_EPOCH_LAG})`);
  } catch (error) {
    report("read model epoch", false, String(error.message ?? error));
  }
} catch (error) {
  report("keeper heartbeat", false, String(error.message ?? error));
}

if (failures.length > 0) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
