#!/usr/bin/env node
// UM-103: check CLAIMS.md. Every path in backticks must exist, every test id (TC-..., K-...) and every `fn name` must appear in a source
// file of this repository, and every transaction hash must appear in a record of the repository (docs/*.json, docs/*.md, contracts/docs).
// With --online every transaction hash in CLAIMS.md, README.md and docs/ is also asked of the chain (NEAR testnet `tx`, Base Sepolia
// `eth_getTransactionReceipt`, see online-hashes.mjs) and the run reports how many were checked, passed, failed and skipped (UM-190).
// Reads files only (and the RPCs with --online); changes nothing.
//
// Usage: node scripts/check-claims.mjs [--root <umbrella dir>] [--file CLAIMS.md] [--online]
// Exit code 0 when every reference resolves, 1 otherwise.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readFiles, verifyHashes } from "./online-hashes.mjs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PATH_RE = /^[\w@./-]+\.(?:ts|tsx|rs|mjs|json|md|sh|yml)$/;
const ID_RE = /\b(?:TC|K)-[A-Z0-9]+(?:-[A-Za-z0-9]+)*\b/g;
const HASH_RE = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const FN_RE = /^[a-z][a-z0-9_]{11,}$/;

/** What a row of CLAIMS.md refers to: paths, test ids, function names, transaction hashes. */
export function referencesOf(markdown) {
  const refs = { paths: new Set(), ids: new Set(), fns: new Set(), hashes: new Set() };
  for (const line of markdown.split("\n")) {
    if (!line.startsWith("|") || /^\|\s*-/.test(line)) continue;
    for (const [, code] of line.matchAll(/`([^`]+)`/g)) {
      if (HASH_RE.test(code)) refs.hashes.add(code);
      else if (PATH_RE.test(code) && code.includes("/") || /^[\w-]+\.(?:md|json|mjs)$/.test(code)) refs.paths.add(code);
      else if (FN_RE.test(code)) refs.fns.add(code);
    }
    for (const id of line.match(ID_RE) ?? []) refs.ids.add(id);
  }
  return refs;
}

/** Checks the references against the repository. `exists`, `grep` and `records` are injectable for tests. */
export function checkClaims(markdown, { exists, grep, records }) {
  const refs = referencesOf(markdown);
  const missing = [];
  for (const p of refs.paths) if (!exists(p)) missing.push(`path ${p}`);
  for (const id of refs.ids) if (!grep(id)) missing.push(`test id ${id}`);
  for (const fn of refs.fns) if (!grep(fn)) missing.push(`function ${fn}`);
  for (const h of refs.hashes) if (!records(h)) missing.push(`transaction ${h} is in no record of the repository`);
  return { counts: Object.fromEntries(Object.entries(refs).map(([k, v]) => [k, v.size])), missing, hashes: [...refs.hashes] };
}

const SKIP = ["--glob", "!node_modules", "--glob", "!target", "--glob", "!dist", "--glob", "!CLAIMS.md", "--glob", "!README.md", "--glob", "!package-lock.json"];
function searchIn(root, needle, globs = []) {
  const run = (cmd, args) => { try { return execFileSync(cmd, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().length > 0; } catch { return false; } };
  const dirs = ["tests", "demo", "scripts", "sdk", "frontend", "agents", "backend", "contracts", "solver", "docs"];
  const present = dirs.filter((d) => existsSync(join(root, d)));
  const exclude = ["--exclude-dir=node_modules", "--exclude-dir=target", "--exclude-dir=dist", "--exclude-dir=.git", "--exclude=package-lock.json", "--exclude=CLAIMS.md", ...globs];
  return run("grep", ["-rIlF", ...exclude, "--", needle, ...present]);
}

/** Files whose hashes --online asks the chains about: the claims file, README.md and every .md/.json under docs/. */
function docFiles(root, claims) {
  const out = [claims];
  if (existsSync(join(root, "README.md"))) out.push("README.md");
  const walk = (dir) => {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(md|json)$/.test(e.name)) out.push(rel);
    }
  };
  if (existsSync(join(root, "docs"))) walk("docs");
  return [...new Set(out)];
}

async function main(argv) {
  const at = (flag, fallback) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : fallback);
  const root = resolve(at("--root", join(dirname(fileURLToPath(import.meta.url)), "..")));
  const file = at("--file", "CLAIMS.md");
  const markdown = readFileSync(join(root, file), "utf8");
  const result = checkClaims(markdown, {
    exists: (p) => existsSync(join(root, p)),
    grep: (needle) => searchIn(root, needle),
    records: (hash) => searchIn(root, hash),
  });
  process.stdout.write(`${file}: ${Object.entries(result.counts).map(([k, v]) => `${v} ${k}`).join(", ")}\n`);
  if (argv.includes("--online")) {
    const v = await verifyHashes(readFiles(docFiles(root, file), root));
    process.stdout.write(`online: ${v.found} hash(es) found in the docs, ${v.checked} checked, ${v.passed} passed, ${v.failed} failed, ${v.skipped} skipped\n`);
    for (const r of v.rows.filter((x) => x.status !== "passed")) process.stdout.write(`  ${r.status}: ${r.hash} (${r.chain}; ${r.paths.join(", ")}): ${r.reason}\n`);
    for (const r of v.rows.filter((x) => x.status === "failed")) result.missing.push(`transaction ${r.hash} failed the online check: ${r.reason}`);
    if (v.found > 0 && v.checked === 0) result.missing.push("online check could not verify any hash (every hash was skipped)");
  }
  for (const m of result.missing) process.stdout.write(`  missing: ${m}\n`);
  process.stdout.write(result.missing.length === 0 ? "Every reference resolves.\n" : `${result.missing.length} reference(s) do not resolve.\n`);
  return result.missing.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));
