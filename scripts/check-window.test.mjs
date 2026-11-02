// Tests for scripts/check-window.mjs (UM-050). Run: node --test scripts/check-window.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { WINDOW, outsideWindow } from "./check-window.mjs";

const git = (lines) => () => lines.join("\n");
const row = (hash, author, committer) => [hash.padEnd(40, "0"), author, committer, "UM-050: subject"].join("\t");

test("commits inside the window pass, including both edges", () => {
  const result = outsideWindow(".", git([row("a", "2026-11-01T00:00:00+00:00", "2026-11-01T00:00:00Z"), row("b", "2026-11-14T23:59:00Z", "2026-11-14T23:59:00Z"), row("c", "2026-11-05T08:00:00+07:00", "2026-11-05T08:00:00+07:00")]));
  assert.deepEqual(result, { total: 3, bad: [] });
});

test("a commit before the start, after the end, or with only one date outside is reported", () => {
  const result = outsideWindow(".", git([
    row("1", "2026-10-31T23:59:59Z", "2026-11-02T00:00:00Z"),
    row("2", "2026-11-14T23:59:01Z", "2026-11-14T23:59:01Z"),
    row("3", "2026-11-03T00:00:00Z", "2026-11-15T00:00:00Z"),
    row("4", "2026-11-03T00:00:00Z", "2026-11-03T00:00:00Z"),
  ]));
  assert.equal(result.total, 4);
  assert.deepEqual(result.bad.map((c) => c.hash), ["1000000", "2000000", "3000000"]);
});

test("the time zone is taken into account: 2026-11-01T05:00+07:00 is still 31 Oct in UTC", () => {
  assert.equal(outsideWindow(".", git([row("d", "2026-11-01T05:00:00+07:00", "2026-11-01T05:00:00+07:00")])).bad.length, 1);
});

test("an empty history has no problem, and the window is the one of the rules", () => {
  assert.deepEqual(outsideWindow(".", git([""])), { total: 0, bad: [] });
  assert.deepEqual(WINDOW, { start: "2026-11-01T00:00:00Z", end: "2026-11-14T23:59:00Z" });
});
