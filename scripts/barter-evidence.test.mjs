// UM-200: docs/barter-evidence.md is the upper limit of every claim about the barter catalog. Run: node --test scripts/barter-evidence.test.mjs
// It checks that the table has one row per catalog entry, that the counts at the top are the counts of the rows, that a refused kind is `X` (and only it),
// that every path named as proof exists, and that every transaction hash in it is one of the hashes of the testnet records in docs/.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { CATALOG } from "./lib/asset-catalog.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const text = readFileSync(join(root, "docs", "barter-evidence.md"), "utf8");
export const STATUSES = ["testnet", "sandbox", "mock", "unit", "generic", "P1 in progress", "roadmap", "X"];

/** Rows of the table: `| 12 | `asset:type` | `status` | proof | limits |`. */
export function rowsOf(markdown) {
  const rows = [];
  for (const line of markdown.split("\n")) {
    const m = line.match(/^\| (X?\d+) \| `([^`]+)` \| `([^`]+)` \| (.*)$/);
    if (m) rows.push({ no: m[1], assetType: m[2], status: m[3], rest: m[4] });
  }
  return rows;
}

const rows = rowsOf(text);

test("one row per catalog entry, same number and asset type, no duplicates", () => {
  assert.equal(rows.length, CATALOG.length);
  assert.equal(new Set(rows.map((r) => r.assetType)).size, rows.length);
  for (const e of CATALOG) {
    const row = rows.find((r) => r.assetType === e.assetType);
    assert.ok(row, `${e.assetType} has no row`);
    assert.equal(row.no, String(e.no), `${e.assetType} has the number ${row.no}, the catalog says ${e.no}`);
  }
});

test("every status is one of the known ones, X is exactly the refused class, #11 to #14 are P1 in progress", () => {
  for (const r of rows) assert.ok(STATUSES.includes(r.status), `${r.assetType}: unknown status ${r.status}`);
  for (const e of CATALOG) {
    const row = rows.find((r) => r.assetType === e.assetType);
    assert.equal(row.status === "X", e.cls === "X", `${e.assetType}: X must be the refused class and only it`);
  }
  for (const no of ["12", "13"]) assert.equal(rows.find((r) => r.no === no).status, "P1 in progress");
  for (const no of ["11", "14"]) assert.equal(rows.find((r) => r.no === no).status, "testnet");
});

test("the counts at the top are the counts of the rows", () => {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length]));
  for (const s of STATUSES) {
    const m = text.match(new RegExp(`^\\| \`${s}\` \\| (\\d+) \\|`, "m"));
    assert.ok(m, `no count line for ${s}`);
    assert.equal(Number(m[1]), counts[s], `${s}: the top says ${m[1]}, the rows are ${counts[s]}`);
  }
  assert.match(text, new RegExp(`\\| \\*\\*All\\*\\* \\| \\*\\*${rows.length}\\*\\* \\|`));
  const offered = rows.length - counts.X;
  assert.equal(offered, 85);
  assert.match(text, /13 of 85 kinds have run on testnet/);
  assert.match(text, /26 \(testnet plus sandbox\)/);
  assert.match(text, /57 \(add the 31 with a mock\)/);
  assert.equal(counts.testnet + counts.sandbox, 26);
  assert.equal(counts.testnet + counts.sandbox + counts.mock, 57);
});

test("a row that is not generic, P1, roadmap or X names at least one proof path that exists", () => {
  const paths = (s) => [...s.matchAll(/`((?:tests|scripts|docs|contracts|sdk|backend|agents)\/[A-Za-z0-9_./-]+\.(?:ts|rs|mjs|json|md))`/g)].map((m) => m[1]);
  for (const r of rows.filter((x) => ["testnet", "sandbox", "mock", "unit"].includes(x.status))) {
    let found = paths(r.rest);
    // "Same tests as #31" borrows the proof of the row it names
    const borrowed = r.rest.match(/Same tests as #(\d+)/);
    if (found.length === 0 && borrowed) found = paths(rows.find((x) => x.no === borrowed[1]).rest);
    assert.ok(found.length > 0, `${r.assetType}: no proof path`);
    for (const p of found) assert.ok(existsSync(join(root, p)), `${r.assetType}: ${p} does not exist`);
  }
  // paths named anywhere in the document, rows or prose, must exist
  for (const p of paths(text)) assert.ok(existsSync(join(root, p)), `${p} does not exist`);
});

test("every transaction hash in the document is in a testnet record of docs/", () => {
  const records = readdirSync(join(root, "docs")).filter((f) => /^testnet.*\.json$/.test(f)).map((f) => readFileSync(join(root, "docs", f), "utf8")).join("\n");
  const hashes = [...text.matchAll(/`([1-9A-HJ-NP-Za-km-z]{43,44})`/g)].map((m) => m[1]);
  assert.ok(hashes.length >= 12);
  for (const h of hashes) assert.ok(records.includes(h), `${h} is in no testnet record of docs/`);
});
