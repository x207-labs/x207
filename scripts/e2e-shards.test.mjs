import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTable, splitShards, testFiles, weightOf } from "./e2e-shards.mjs";

const table = { defaultSeconds: 70, seconds: { "tests/a.sandbox.test.ts": 900, "tests/b.sandbox.test.ts": 800, "tests/c.sandbox.test.ts": 100 } };

test("weights: listed, unlisted sandbox, other files", () => {
  assert.equal(weightOf("tests/a.sandbox.test.ts", table), 900);
  assert.equal(weightOf("tests/new.sandbox.test.ts", table), 70);
  assert.equal(weightOf("tests/unit.test.ts", table), 1);
});

test("every file lands in exactly one shard and the split does not depend on input order", () => {
  const files = ["tests/c.sandbox.test.ts", "tests/a.sandbox.test.ts", "tests/b.sandbox.test.ts", "tests/x.test.ts", "tests/y.sandbox.test.ts"];
  const one = splitShards(files, 2, table);
  const two = splitShards([...files].reverse(), 2, table);
  assert.deepEqual(one, two);
  assert.deepEqual(one.flatMap((s) => s.files).sort(), [...files].sort());
  assert.deepEqual(one.map((s) => s.files.includes("tests/a.sandbox.test.ts")), [true, false]);
});

test("the real repository: all files covered once, shards within 25% of each other, e2e barter marketplace broker-class-b present", () => {
  const files = testFiles();
  const shards = splitShards(files, 5, loadTable());
  const all = shards.flatMap((s) => s.files);
  assert.equal(new Set(all).size, files.length);
  assert.equal(all.length, files.length);
  for (const name of ["e2e", "barter", "marketplace", "broker-class-b"]) assert.ok(all.includes(`tests/${name}.sandbox.test.ts`), name);
  const seconds = shards.map((s) => s.seconds);
  assert.ok(Math.max(...seconds) <= Math.min(...seconds) * 1.25, `unbalanced: ${seconds.join(", ")}`);
});

test("bad shard counts are refused", () => {
  assert.throws(() => splitShards([], 0, table), /positive integer/);
});
