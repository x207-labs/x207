#!/usr/bin/env node
// UM-025: splits tests/*.test.ts into shards of about the same duration for the matrix of .github/workflows/e2e-sandbox.yml.
//   node scripts/e2e-shards.mjs --shard 2 --of 4      prints the test files of shard 2, one per line
//   node scripts/e2e-shards.mjs --plan --of 4         prints every shard with its estimated seconds
// The split is deterministic (largest file first into the lightest shard), so the shards together always hold every file exactly once. The seconds come from
// scripts/lib/e2e-durations.json; a sandbox test that is not listed counts as defaultSeconds, any other file (unit tests, live tests that skip) as 1 second.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Estimated seconds of one test file. */
export function weightOf(file, table) {
  if (table.seconds[file] !== undefined) return table.seconds[file];
  return file.endsWith(".sandbox.test.ts") ? table.defaultSeconds : 1;
}

/** Splits `files` into `count` shards; each is { files, seconds }. Largest first into the lightest shard; ties by name, so the result never depends on the order of `files`. */
export function splitShards(files, count, table) {
  if (!Number.isInteger(count) || count < 1) throw new Error("--of must be a positive integer");
  const shards = Array.from({ length: count }, () => ({ files: [], seconds: 0 }));
  const sorted = [...files].sort((a, b) => weightOf(b, table) - weightOf(a, table) || a.localeCompare(b));
  for (const file of sorted) {
    const lightest = shards.reduce((min, s) => (s.seconds < min.seconds ? s : min));
    lightest.files.push(file);
    lightest.seconds += weightOf(file, table);
  }
  for (const s of shards) s.files.sort();
  return shards;
}

export const testFiles = (dir = join(root, "tests")) => readdirSync(dir).filter((f) => f.endsWith(".test.ts")).map((f) => `tests/${f}`).sort();
export const loadTable = () => JSON.parse(readFileSync(join(root, "scripts/lib/e2e-durations.json"), "utf8"));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (name) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : undefined);
  const count = value("--of");
  if (count === undefined) {
    console.error("usage: e2e-shards.mjs --shard <1..of> --of <n> | --plan --of <n>");
    process.exit(2);
  }
  const shards = splitShards(testFiles(), count, loadTable());
  if (args.includes("--plan")) {
    shards.forEach((s, i) => console.log(`shard ${i + 1}: ${s.files.length} files, about ${Math.round(s.seconds / 60)} min of tests`));
  } else {
    const n = value("--shard");
    if (!Number.isInteger(n) || n < 1 || n > count) {
      console.error(`--shard must be 1..${count}`);
      process.exit(2);
    }
    console.log(shards[n - 1].files.join("\n"));
  }
}
