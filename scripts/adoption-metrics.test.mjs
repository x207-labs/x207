// Tests for scripts/adoption-metrics.mjs (SD-049). Run: node --test scripts/adoption-metrics.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

test("--offline prints the shape without touching the network", () => {
  const out = execFileSync("node", ["scripts/adoption-metrics.mjs", "--offline"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const j = JSON.parse(out);
  assert.equal(j.offline, true);
  assert.ok(!Number.isNaN(Date.parse(j.generatedAt)));
  for (const k of ["github", "npm", "issue", "circle"]) assert.equal(j[k], null);
});
