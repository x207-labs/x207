import assert from "node:assert/strict";
import { test } from "node:test";
import { summarize } from "./e2e-summary.mjs";

test("summary lists the files longest first with seconds, tests and status", () => {
  const report = {
    numTotalTests: 3,
    testResults: [
      { name: "/repo/tests/a.sandbox.test.ts", startTime: 1000, endTime: 61000, status: "passed", assertionResults: [{}, {}] },
      { name: "/repo/tests/b.sandbox.test.ts", startTime: 0, endTime: 120000, status: "failed", assertionResults: [{}] },
    ],
  };
  const md = summarize(report, "shard 1/4", "/repo");
  assert.match(md, /### shard 1\/4/);
  assert.match(md, /2 test files, 3 tests, 1 failed files, 3\.0 min/);
  assert.ok(md.indexOf("tests/b.sandbox.test.ts") < md.indexOf("tests/a.sandbox.test.ts"));
  assert.match(md, /\| `tests\/a\.sandbox\.test\.ts` \| 60\.0 \| 2 \| passed \|/);
});

test("an empty report does not throw", () => {
  assert.match(summarize({}, "x", "/repo"), /0 test files/);
});
