#!/usr/bin/env node
// UM-038: relief of cycle-only clearing against graph density, on synthetic graphs.
//
// Usage (from the umbrella repo root):
//   npm run build -w @x207/solver
//   node scripts/relief-curve.mjs [--seed 207] [--members 30] [--out-dir scripts/out]
//
// Uses the solver of this repo (M4, min-cost flow). Same seed gives identical files.
// The graphs are synthetic. The results are not results of a demo epoch.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const solverDist = resolve(here, "../solver/dist");
const { buildGraph } = await import(pathToFileURL(join(solverDist, "graph/index.js")).href).catch(missingBuild);
const { solveClearing } = await import(pathToFileURL(join(solverDist, "mincostflow/index.js")).href).catch(missingBuild);

function missingBuild(err) {
  console.error(`Cannot load the solver build (${err.message}). Run: npm run build -w @x207/solver`);
  process.exit(1);
}

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, arg, i, all) => (arg.startsWith("--") ? [...acc, [arg.slice(2), all[i + 1]]] : acc), []),
);
const seed = Number(args.seed ?? 207);
const members = Number(args.members ?? 30);
const outDir = resolve(args["out-dir"] ?? join(here, "out"));
const DENSITIES = [0.03, 0.06, 0.12, 0.25, 0.5, 0.8];
const SARDEX_BENCHMARK_PCT = 23; // Fleischman, Dini, Littera (JRFM 2020): 23.1% of value per monthly batch

// mulberry32: small seeded PRNG so that the output is reproducible.
function prng(state) {
  let a = state >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const name = (i) => `agent${String(i).padStart(3, "0")}.x207`;

function randomGraph(n, density, rand) {
  const edges = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j && rand() < density) {
        edges.push({ debtor: name(i), creditor: name(j), amount: BigInt(1 + Math.floor(rand() * 100)) });
      }
    }
  }
  return edges;
}

// Every spoke owes the hub. The hub owes nobody, so the graph has no cycle.
function starGraph(n, rand) {
  const edges = [];
  for (let i = 1; i < n; i++) edges.push({ debtor: name(i), creditor: name(0), amount: BigInt(1 + Math.floor(rand() * 100)) });
  return edges;
}

function measure(label, density, edges) {
  const graph = buildGraph("relief", 1, edges);
  const result = solveClearing(graph, { maxEdges: Number.MAX_SAFE_INTEGER });
  const total = graph.totalObligation;
  const reliefBp = total === 0n ? 0n : (result.clearedTotal * 10000n) / total;
  const net = new Map();
  for (const e of graph.edges) {
    net.set(e.debtor, (net.get(e.debtor) ?? 0n) - e.amount);
    net.set(e.creditor, (net.get(e.creditor) ?? 0n) + e.amount);
  }
  const residualPayments = [...net.values()].filter((v) => v < 0n).length;
  return {
    graph: label,
    members: graph.members.length,
    density,
    edges: graph.edges.length,
    total_obligation: total.toString(),
    nid: result.nid.toString(),
    cleared_total: result.clearedTotal.toString(),
    relief_pct: (Number(reliefBp) / 100).toFixed(2),
    residual_payments: residualPayments,
    // Not computed here. The definition of payable mass and the gas cost per payment are open (see docs).
    payable_mass_omega: "n/a",
    cost_per_payment: "n/a",
  };
}

const rows = DENSITIES.map((d, i) => measure(`random-${d}`, d, randomGraph(members, d, prng(seed + i))));
rows.push(measure("star", "n/a", starGraph(members, prng(seed + 100))));

const columns = Object.keys(rows[0]);
const csv = [columns.join(","), ...rows.map((r) => columns.map((c) => r[c]).join(","))].join("\n") + "\n";

function svg(rows) {
  const w = 640, h = 360, left = 60, bottom = 70, top = 40, right = 20;
  const barW = (w - left - right) / rows.length;
  const y = (pct) => top + (h - top - bottom) * (1 - pct / 100);
  const bars = rows.map((r, i) => {
    const x = left + i * barW + 8;
    const pct = Number(r.relief_pct);
    return `<rect x="${x}" y="${y(pct)}" width="${barW - 16}" height="${h - bottom - y(pct)}" fill="#3b6ea5"/>` +
      `<text x="${x + (barW - 16) / 2}" y="${y(pct) - 4}" font-size="11" text-anchor="middle">${r.relief_pct}%</text>` +
      `<text x="${x + (barW - 16) / 2}" y="${h - bottom + 16}" font-size="11" text-anchor="middle">${r.graph.replace("random-", "p=")}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" font-family="sans-serif">` +
    `<rect width="${w}" height="${h}" fill="#fff"/>` +
    `<text x="${left}" y="22" font-size="14">Value removed by cycle clearing vs graph density (${members} members, seed ${seed}, synthetic graphs)</text>` +
    `<line x1="${left}" y1="${h - bottom}" x2="${w - right}" y2="${h - bottom}" stroke="#000"/>` +
    `<line x1="${left}" y1="${y(SARDEX_BENCHMARK_PCT)}" x2="${w - right}" y2="${y(SARDEX_BENCHMARK_PCT)}" stroke="#b33" stroke-dasharray="5 4"/>` +
    `<text x="${w - right}" y="${y(SARDEX_BENCHMARK_PCT) - 4}" font-size="11" fill="#b33" text-anchor="end">Sardex 2019: 23% of value per month (Fleischman, Dini, Littera, JRFM 2020)</text>` +
    bars +
    `<text x="${left}" y="${h - 10}" font-size="11">p = probability of a debt edge between two members. star = every member owes one hub.</text>` +
    `</svg>\n`;
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "relief-curve.csv"), csv);
writeFileSync(join(outDir, "relief-curve.svg"), svg(rows));
process.stdout.write(csv);
console.error(`Wrote ${join(outDir, "relief-curve.csv")} and relief-curve.svg. Sardex benchmark: ${SARDEX_BENCHMARK_PCT}% of value per month.`);
