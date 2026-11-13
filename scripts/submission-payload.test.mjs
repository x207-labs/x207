// Tests for scripts/submission-payload.mjs (UM-053). Run: node --test scripts/submission-payload.test.mjs
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { FIELDS, TRACKS, buildPayload } from "./submission-payload.mjs";

const SCRIPT = fileURLToPath(new URL("./submission-payload.mjs", import.meta.url));
const IDEA = readFileSync(fileURLToPath(new URL("../docs/submission/idea.txt", import.meta.url)), "utf8");
const REQUEST_ID = "3f2b8c1e-5d4a-4e7b-9a60-1c2d3e4f5a6b";
const HUMAN = {
  projectName: "Test Project", leadName: "Test Lead", email: "lead@team.test", size: "1", nearAddress: "team-lead.near",
  demoUrl: "https://x.com/team/status/1", consent: true,
};

test("the idea text of the repository is within 20-2000 characters", () => {
  assert.ok(IDEA.trim().length >= 20 && IDEA.trim().length <= 2000, `length ${IDEA.trim().length}`);
});

test("a complete input gives exactly the API fields, the four tracks and no problem", () => {
  const { payload, problems } = buildPayload({ human: HUMAN, idea: IDEA, requestId: REQUEST_ID });
  assert.deepEqual(problems, []);
  assert.deepEqual(Object.keys(payload), FIELDS);
  assert.deepEqual(payload.tracks, TRACKS);
  assert.equal(TRACKS.length, 4);
  assert.equal(payload.projectUrl, "https://github.com/x207-labs/x207");
  assert.ok(!("website" in payload));
});

test("missing human fields are null and listed; nothing is invented", () => {
  const { payload, problems } = buildPayload({ human: {}, idea: IDEA, requestId: REQUEST_ID });
  for (const field of ["projectName", "leadName", "email", "size", "nearAddress", "demoUrl", "consent"]) {
    assert.equal(payload[field], null, field);
    assert.ok(problems.some((p) => p.startsWith(`${field}:`)), field);
  }
});

test("rules of the API: lengths, size, address pattern, urls, consent, placeholders, tracks", () => {
  const bad = (human, extra = {}) => buildPayload({ human: { ...HUMAN, ...human }, idea: IDEA, requestId: REQUEST_ID, ...extra }).problems.join("\n");
  assert.match(bad({ projectName: "x" }), /projectName: 2-80/);
  assert.match(bad({ email: "nope" }), /email:/);
  assert.match(bad({ size: "3" }), /size:/);
  assert.match(bad({ nearAddress: "Team.near" }), /nearAddress:/);
  assert.match(bad({ demoUrl: "ftp://x" }), /demoUrl:/);
  assert.match(bad({ consent: false }), /consent: must be true/);
  assert.match(bad({ leadName: "FILL" }), /leadName: looks like a placeholder/);
  assert.match(bad({ leadName: "<name>" }), /placeholder/);
  assert.match(bad({}, { idea: "short" }), /idea: 20-2000/);
  assert.match(bad({}, { idea: "x".repeat(2001) }), /idea: 20-2000/);
  assert.match(bad({}, { requestId: "not-a-uuid" }), /requestId:/);
  assert.match(bad({}, { tracks: TRACKS.slice(1) }), /missing agents/);
  assert.match(bad({}, { tracks: [...TRACKS, "agents"] }), /each listed once/);
  assert.match(bad({ website: "spam" }), /fields the API does not take: website/);
});

test("the command: --draft prints the payload and exits 0, --check exits 1 while fields are missing and 0 when complete, and nothing is sent", () => {
  const dir = mkdtempSync(join(tmpdir(), "submission-"));
  try {
    const file = join(dir, "submission.json");
    const draft = spawnSync("node", [SCRIPT, "--draft", "--file", file], { encoding: "utf8" });
    assert.equal(draft.status, 0);
    assert.equal(JSON.parse(draft.stdout).projectName, null);
    assert.match(draft.stderr, /Open items/);
    const check = spawnSync("node", [SCRIPT, "--check", "--file", file], { encoding: "utf8" });
    assert.equal(check.status, 1);
    writeFileSync(file, JSON.stringify(HUMAN));
    const first = JSON.parse(execFileSync("node", [SCRIPT, "--file", file], { encoding: "utf8" }));
    const second = JSON.parse(execFileSync("node", [SCRIPT, "--file", file], { encoding: "utf8" }));
    assert.equal(first.requestId, second.requestId, "a retry reuses the request id");
    assert.equal(spawnSync("node", [SCRIPT, "--check", "--file", file], { encoding: "utf8" }).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the script has no network code", () => {
  const source = readFileSync(SCRIPT, "utf8");
  assert.ok(!/\bfetch\(|node:https?|node:net|XMLHttpRequest/.test(source));
});
