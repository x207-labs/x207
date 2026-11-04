#!/usr/bin/env node
// UM-085: how much of the barter catalog is real. Reads the catalog (scripts/lib/asset-catalog.mjs), sorts every entry by the first word of its `status` and counts them per class and per pipeline.
//
//   built    the pipeline runs against the real components of x207 (the contract, the backend, the broker, near-sandbox or testnet); the status starts with `built`
//   mock     the pipeline runs, but the provider or issuer behind it is a mock of ours (`built with a mock ...`)
//   planned  a named backlog item (`item CT-090`) that is not built
//   roadmap  not built, no item yet (`roadmap ...`)
//   refused  class X: registered so that offering it fails with ERR_ASSET_CLASS_FORBIDDEN
//
// The catalog has no pipeline field; the pipeline is taken from the delivery method (PIPELINES below), so it is a reading of the data, not a second source of truth.
//   node scripts/catalog-coverage.mjs               prints the tables
//   node scripts/catalog-coverage.mjs --write       puts them between the markers of docs/asset-catalog.md
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG } from "./lib/asset-catalog.mjs";

export const STATES = ["built", "mock", "planned", "roadmap", "refused"];

/** Delivery method -> pipeline of the product. Anything not listed is `other`. */
export const PIPELINES = {
  P1: { name: "on-chain escrow", delivery: ["escrow_nft", "escrow_ft", "escrow_mt", "escrow_locker", "escrow_claim"] },
  P2: { name: "access rent through the broker", delivery: ["near_access_key", "dao_delegation", "seat_invite", "repo_collaborator", "oauth_token", "cloud_role", "signed_url", "ssh_key", "db_user", "community_role", "org_member", "project_member", "subaccount", "derived_account", "member_invite", "folder_invite", "invite_or_role", "reader_account"] },
  P3: { name: "one-time secrets and codes", delivery: ["secret_release", "proxy", "admin_credentials"] },
  P4: { name: "platform transfer", delivery: ["platform_transfer", "game_trade", "carrier_transfer", "program_transfer"] },
  P5: { name: "metered resources and services", delivery: ["x402_endpoint", "file_handover", "calendar_slot"] },
  P7: { name: "licenses and files", delivery: ["licensed_download", "download", "consented_download"] },
};

export function stateOf(entry) {
  if (entry.cls === "X") return "refused";
  const s = entry.status.trim();
  if (s.startsWith("built with a mock")) return "mock";
  if (s.startsWith("built")) return "built";
  if (s.startsWith("item")) return "planned";
  if (s.startsWith("roadmap")) return "roadmap";
  throw new Error(`entry ${entry.no} (${entry.assetType}): status ${JSON.stringify(s)} starts with none of built, item, roadmap`);
}

export function pipelineOf(entry) {
  if (entry.cls === "X") return "refused";
  for (const [id, p] of Object.entries(PIPELINES)) if (entry.delivery.some((d) => p.delivery.includes(d))) return id;
  return "other";
}

const zero = () => Object.fromEntries(STATES.map((s) => [s, 0]));

/** Counts per class, per pipeline and in total. */
export function coverage(catalog = CATALOG) {
  const byClass = {};
  const byPipeline = {};
  const total = zero();
  for (const e of catalog) {
    const st = stateOf(e);
    (byClass[e.cls] ??= zero())[st] += 1;
    (byPipeline[pipelineOf(e)] ??= zero())[st] += 1;
    total[st] += 1;
  }
  return { byClass, byPipeline, total, entries: catalog.length };
}

const sum = (row) => STATES.reduce((n, s) => n + row[s], 0);
const row = (label, r) => `| ${label} | ${STATES.map((s) => r[s]).join(" | ")} | ${sum(r)} |`;
const header = (first) => `| ${first} | built | mock | planned | roadmap | refused | all |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |`;

export function markdown(catalog = CATALOG) {
  const c = coverage(catalog);
  const realish = c.total.built + c.total.mock;
  const registrable = c.entries - c.total.refused;
  const lines = [];
  lines.push(`${c.entries} entries: ${registrable} kinds that can be offered and ${c.total.refused} refused kinds (class X). Of the ${registrable} kinds that can be offered, **${c.total.built} are built** against the real components, **${c.total.mock} run end to end with a mock of ours** as the provider or issuer, ${c.total.planned} are planned as a named backlog item and ${c.total.roadmap} are on the roadmap only. That is ${realish} of ${registrable} (${Math.round((100 * realish) / registrable)} percent) with a pipeline that runs, and ${c.total.built} of ${registrable} (${Math.round((100 * c.total.built) / registrable)} percent) without any mock.`);
  lines.push("");
  lines.push("By class:");
  lines.push("");
  lines.push(header("Class"));
  for (const k of ["A", "B", "C", "D", "X"]) if (c.byClass[k]) lines.push(row(k, c.byClass[k]));
  lines.push(row("**All**", c.total));
  lines.push("");
  lines.push("By pipeline (taken from the delivery method of the entry):");
  lines.push("");
  lines.push(header("Pipeline"));
  for (const [id, p] of Object.entries(PIPELINES)) if (c.byPipeline[id]) lines.push(row(`${id} ${p.name}`, c.byPipeline[id]));
  if (c.byPipeline.other) lines.push(row("other", c.byPipeline.other));
  if (c.byPipeline.refused) lines.push(row("refused (no pipeline)", c.byPipeline.refused));
  lines.push(row("**All**", c.total));
  lines.push("");
  lines.push("`built` means the pipeline runs against the real contract, backend, broker or a real testnet; it does not mean that a real third-party provider was used. `mock` means the provider or issuer behind the pipeline is a mock written by us (a mock OAuth server, a mock issuer of codes, a mock reseller), so the x207 side is tested and the provider side is not. Regenerate with `node scripts/catalog-coverage.mjs --write`; the test `scripts/catalog-coverage.test.mjs` fails when the numbers in this file are out of date.");
  return lines.join("\n");
}

export const START = "<!-- coverage:start -->";
export const END = "<!-- coverage:end -->";

/** Puts `markdown()` between the markers of `text`. */
export function inject(text, md) {
  const i = text.indexOf(START);
  const j = text.indexOf(END);
  if (i < 0 || j < i) throw new Error(`the file has no ${START} ... ${END} markers`);
  return `${text.slice(0, i + START.length)}\n${md}\n${text.slice(j)}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv.includes("--write")) {
    const file = resolve(dirname(fileURLToPath(import.meta.url)), "../docs/asset-catalog.md");
    writeFileSync(file, inject(readFileSync(file, "utf8"), markdown()));
    console.log(`written to ${file}`);
  } else console.log(markdown());
}
