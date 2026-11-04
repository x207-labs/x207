#!/usr/bin/env node
// UM-104: run one realistic epoch on the circle x207-v013.testnet from this machine: an asymmetric graph of 24 edges among 15 members, the vouchers registered, close_epoch,
// the clearing of the solver of this repository submitted and committed, the payment window with residuals paid by all debtors but one, a default, finalize_epoch and claims.
// The hash of every step is written to docs/testnet-epochs/<epoch>.json (hashes and names only, no key).
//
//   npm run testnet:epoch                  the plan only (default): graph, residuals, who defaults, the transactions, the time; reads the chain, sends nothing
//   npm run testnet:epoch -- --offline     the same without any network call
//   npm run testnet:epoch -- --execute     sends the transactions (about 35 minutes of real time; testnet only)
//
// Keys: the members' and the aux account's keys are read by the run itself from the folder in X207_SECRETS_DIR (default: .secrets/testnet-deployer at the root of the project,
// outside every repository). This script only checks that the files exist; it never prints, copies or logs a key. Nothing here can reach mainnet: the circle, the aux account and
// the token are constants of scripts/lib/realistic-epoch.mjs, all `.testnet`.
//
// Needs `npm ci` and `npm run build --workspaces --if-present` once (the clearing preview uses solver/dist; the run itself uses vitest).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AUX, CIRCLE, GRAPH, MEMBER_COUNT, USDT, WINDOWS, formatCredit, memberId, netPositions, credits, totalObligation, transactionPlan } from "./lib/realistic-epoch.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const RPC = process.env.X207_TESTNET_RPC ?? "https://rpc.testnet.fastnear.com";
const TEST_FILE = "tests/testnet-realistic-epoch.live.test.ts";
const KEY_FILES = [`testnet/${CIRCLE}.json`, `testnet/${AUX}.json`, "um100-v013.json"];

export class UsageError extends Error {}

/** `--dry-run` is the default; `--execute` is the only way to send. */
export function parseArgs(argv) {
  const options = { execute: false, offline: false, json: false };
  let dry = false;
  for (const arg of argv) {
    if (arg === "--execute") options.execute = true;
    else if (arg === "--dry-run") dry = true;
    else if (arg === "--offline") options.offline = true;
    else if (arg === "--json") options.json = true;
    else throw new UsageError(`unknown option ${arg} (use --dry-run, --execute, --offline, --json)`);
  }
  if (dry && options.execute) throw new UsageError("--dry-run and --execute together: choose one");
  return options;
}

export const secretsDirOf = (env = process.env) => resolve(env.X207_SECRETS_DIR ?? join(root, "..", "..", ".secrets", "testnet-deployer"));

/** Which key files exist; the content is never read here. */
export function keyStatus(dir) {
  return KEY_FILES.map((file) => ({ file, present: existsSync(join(dir, file)) }));
}

async function rpc(method, params) {
  const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15_000) });
  const body = await response.json();
  if (body.error) throw new Error(JSON.stringify(body.error).slice(0, 200));
  return body.result;
}

/** Read-only look at the chain: the epoch now and the balance of the aux account. A failure is reported, not fatal: the plan does not need it. */
export async function chainStatus() {
  try {
    const call = await rpc("query", { request_type: "call_function", finality: "final", account_id: CIRCLE, method_name: "get_epoch", args_base64: Buffer.from("{}").toString("base64") });
    const epoch = JSON.parse(Buffer.from(call.result).toString("utf8"));
    const account = await rpc("query", { request_type: "view_account", finality: "final", account_id: AUX });
    const block = await rpc("block", { finality: "final" });
    const nowMs = Number(BigInt(block.header.timestamp_nanosec) / 1_000_000n);
    const leftMs = Number(BigInt(epoch.cutoff_at) / 1_000_000n) - nowMs;
    return { ok: true, epoch: epoch.epoch, phase: epoch.phase, secondsToCutoff: Math.round(leftMs / 1000), auxNear: (BigInt(account.amount) / 10n ** 21n).toString() };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/** The clearing the solver of this repository will propose for the graph, from its built output; null when it is not built. */
export async function clearingPreview() {
  const path = join(root, "solver", "dist", "mincostflow", "index.js");
  if (!existsSync(path)) return null;
  const { solveClearing } = await import(pathToFileURL(path).href);
  const ids = Array.from({ length: MEMBER_COUNT }, (_, i) => memberId(i));
  const edges = GRAPH.map(([d, c, amount]) => ({ debtor: ids[d], creditor: ids[c], amount: credits(amount) })).sort((a, b) => (a.debtor + a.creditor < b.debtor + b.creditor ? -1 : 1));
  const clearing = solveClearing({ circle: CIRCLE, epoch: 1, members: ids, edges, totalObligation: totalObligation() });
  if (clearing.status !== "ok") return { status: clearing.status };
  return { status: "ok", edges: clearing.proposal.edges.length, clearedTotal: clearing.clearedTotal, ratio: Number(clearing.clearedTotal) / Number(totalObligation()) };
}

/** The plan as data. */
export async function buildPlan({ offline = false, env = process.env } = {}) {
  const { debtors, creditors } = netPositions();
  const preview = await clearingPreview();
  const dir = secretsDirOf(env);
  return {
    circle: CIRCLE, aux: AUX, token: USDT, members: MEMBER_COUNT,
    graph: { edges: GRAPH.length, totalObligation: formatCredit(totalObligation()) },
    clearing: preview === null ? { note: "solver/dist is not built: run npm run build --workspaces --if-present to preview the cleared amount" }
      : preview.status !== "ok" ? { status: preview.status }
      : { edges: preview.edges, clearedTotal: formatCredit(preview.clearedTotal), clearedRatio: Math.round(preview.ratio * 1000) / 1000, left: formatCredit(totalObligation() - preview.clearedTotal) },
    residuals: { debtors: debtors.map((d) => ({ member: d.member, due: formatCredit(d.due) })), totalDue: formatCredit(debtors.reduce((n, d) => n + d.due, 0n)), defaulter: debtors[0].member, paying: debtors.length - 1 },
    claims: creditors.map((c) => ({ member: c.member, claimable: formatCredit(c.claimable) })),
    ...transactionPlan(),
    windows: WINDOWS,
    keys: { dirSetBy: env.X207_SECRETS_DIR ? "X207_SECRETS_DIR" : "default", files: keyStatus(dir) },
    chain: offline ? { skipped: "--offline" } : await chainStatus(),
    output: "docs/testnet-epochs/<epoch>.json",
  };
}

export function renderPlan(plan) {
  const out = [];
  out.push(`Plan for one realistic epoch on ${plan.circle} (nothing is sent)`);
  out.push(`  graph: ${plan.graph.edges} edges among ${plan.members} members, total obligation ${plan.graph.totalObligation} credit`);
  if (plan.clearing.clearedTotal) out.push(`  clearing (solver of this repository): ${plan.clearing.edges} edges cancel ${plan.clearing.clearedTotal} credit, ratio ${plan.clearing.clearedRatio}, ${plan.clearing.left} left`);
  else out.push(`  clearing preview: ${plan.clearing.note ?? plan.clearing.status}`);
  out.push(`  residuals: ${plan.residuals.debtors.length} debtors owe ${plan.residuals.totalDue} in all; ${plan.residuals.paying} pay, ${plan.residuals.defaulter} defaults (the smallest, ${plan.residuals.debtors[0].due}) and its stake pays`);
  out.push(`  creditors: ${plan.claims.length}; the three largest claim (${plan.claims.slice(0, 3).map((c) => c.claimable).join(", ")})`);
  out.push("  transactions:");
  for (const s of plan.steps) out.push(`    ${String(s.transactions).padStart(7)}  ${s.step} [${s.by}]`);
  out.push(`  real time: about ${plan.minutes} minutes (waits for an epoch with 7 minutes to its cutoff, then the proposal window of ${plan.windows.proposalSeconds} s and the payment window of ${plan.windows.paymentSeconds} s)`);
  out.push(`  keys (${plan.keys.dirSetBy}): ${plan.keys.files.map((f) => `${f.file} ${f.present ? "present" : "MISSING"}`).join(", ")}`);
  out.push(plan.chain.ok ? `  chain now: epoch ${plan.chain.epoch} ${plan.chain.phase}, ${plan.chain.secondsToCutoff} s to its cutoff, aux account holds about ${plan.chain.auxNear} NEAR`
    : plan.chain.skipped ? "  chain now: not read (--offline)" : `  chain now: could not be read (${plan.chain.error})`);
  out.push(`  result file: ${plan.output}`);
  out.push("Run it with: npm run testnet:epoch -- --execute");
  return out.join("\n");
}

/** Sends the transactions through the live test of UM-106 (the one that produced epoch 8), then names the result file after the epoch it ran. */
function execute(plan) {
  const missing = plan.keys.files.filter((f) => !f.present);
  if (missing.length > 0) throw new UsageError(`key files missing in the secrets folder: ${missing.map((f) => f.file).join(", ")}; nothing was sent`);
  if (!existsSync(join(root, TEST_FILE))) throw new UsageError(`${TEST_FILE} is missing; nothing was sent`);
  const dir = join(root, "docs", "testnet-epochs");
  mkdirSync(dir, { recursive: true });
  const pending = join(dir, `pending-${Date.now()}.json`);
  console.log(`Sending: about ${plan.minutes} minutes. Hashes go to ${pending} and then to docs/testnet-epochs/<epoch>.json`);
  const run = spawnSync("npx", ["vitest", "run", TEST_FILE], { cwd: root, stdio: "inherit", env: { ...process.env, X207_TESTNET: "1", X207_UM106_OUT: pending, X207_SECRETS_DIR: secretsDirOf() } });
  if (!existsSync(pending)) return run.status ?? 1;
  let epoch;
  try {
    epoch = JSON.parse(readFileSync(pending, "utf8")).result?.epoch;
  } catch {
    epoch = undefined;
  }
  const target = Number.isInteger(epoch) ? join(dir, `${epoch}.json`) : join(dir, `failed-${Date.now()}.json`);
  renameSync(pending, target);
  console.log(`${run.status === 0 ? "Done" : "The run stopped"}: the hashes are in ${target}`);
  return run.status ?? 1;
}

async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  const plan = await buildPlan({ offline: options.offline });
  if (options.json) console.log(JSON.stringify(plan, null, 2));
  else console.log(renderPlan(plan));
  if (!options.execute) return 0;
  try {
    return execute(plan);
  } catch (error) {
    console.error(error.message);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => { console.error(error.message); process.exit(1); });
}
