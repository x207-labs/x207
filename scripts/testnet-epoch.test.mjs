// Tests for scripts/testnet-epoch.mjs and scripts/lib/realistic-epoch.mjs (UM-104). Run: node --test scripts/testnet-epoch.test.mjs
// Nothing here sends a transaction or reads a key: the plan is checked against the recorded run of UM-106 (docs/testnet-0.0.13-realistic.json).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AUX, CIRCLE, GRAPH, formatCredit, memberId, netPositions, totalObligation, transactionPlan } from "./lib/realistic-epoch.mjs";
import { UsageError, buildPlan, keyStatus, parseArgs, renderPlan } from "./testnet-epoch.mjs";

const run = JSON.parse(readFileSync(new URL("../docs/testnet-0.0.13-realistic.json", import.meta.url), "utf8")).result;

test("the default is the plan; --execute is the only way to send; unknown or contradictory flags are refused", () => {
  assert.deepEqual(parseArgs([]), { execute: false, offline: false, json: false });
  assert.deepEqual(parseArgs(["--dry-run"]), { execute: false, offline: false, json: false });
  assert.equal(parseArgs(["--execute"]).execute, true);
  assert.throws(() => parseArgs(["--dry-run", "--execute"]), UsageError);
  assert.throws(() => parseArgs(["--exec"]), UsageError);
  assert.throws(() => parseArgs(["--mainnet"]), UsageError);
});

test("the circle, the aux account and the token are testnet accounts", () => {
  for (const id of [CIRCLE, AUX, memberId(0)]) assert.match(id, /\.testnet$/);
});

test("the graph is the one of the recorded run: 24 edges, 41.35 credit, residuals and claims equal to the chain's positions", () => {
  assert.equal(GRAPH.length, run.edgesRegistered.count);
  assert.equal(totalObligation().toString(), run.edgesRegistered.totalObligation);
  const { debtors, creditors } = netPositions();
  assert.deepEqual(debtors.map((d) => [d.member, d.due.toString()]).sort(), run.positions.debtors.map((d) => [d.account, d.due]).sort());
  assert.deepEqual(creditors.map((c) => [c.member, c.claimable.toString()]).sort(), run.positions.creditors.map((c) => [c.account, c.claimable]).sort());
  assert.equal(debtors[0].member, run.positions.defaulter, "the smallest residual defaults, as in the run");
});

test("the transaction plan counts one voucher per edge, two transactions per paying debtor and three claims", () => {
  const { steps } = transactionPlan();
  const count = (text) => steps.find((s) => s.step.startsWith(text)).transactions;
  assert.equal(count("register_cumulative"), 24);
  assert.equal(count("mint mock USDT"), 10);
  assert.equal(count("claim"), 3);
  assert.equal(formatCredit(41_350_000n), "41.35");
  assert.equal(formatCredit(5_000_000n), "5");
});

test("a dry run reads no key and sends nothing: the plan names the key files, never their content", async () => {
  const dir = mkdtempSync(join(tmpdir(), "x207-secrets-"));
  mkdirSync(join(dir, "testnet"));
  const secret = "ed25519:TOPSECRETDONOTPRINT1234567890";
  writeFileSync(join(dir, "um100-v013.json"), JSON.stringify({ k: secret }));
  writeFileSync(join(dir, "testnet", `${AUX}.json`), JSON.stringify({ private_key: secret }));
  assert.deepEqual(keyStatus(dir).map((f) => f.present), [false, true, true]);
  const plan = await buildPlan({ offline: true, env: { X207_SECRETS_DIR: dir } });
  const text = renderPlan(plan) + JSON.stringify(plan);
  assert.ok(!text.includes("TOPSECRET"), "no key content in the plan");
  assert.match(renderPlan(plan), /testnet\/x207-v013\.testnet\.json MISSING/);
  assert.equal(plan.chain.skipped, "--offline");
  assert.equal(plan.keys.dirSetBy, "X207_SECRETS_DIR");
});

test("the plan says what the run did: 21.8 of 41.35 cancelled when the solver is built, 7.75 due, five pay, one defaults", async () => {
  const plan = await buildPlan({ offline: true, env: {} });
  assert.equal(plan.graph.totalObligation, "41.35");
  assert.equal(plan.residuals.totalDue, "7.75");
  assert.equal(plan.residuals.paying, 5);
  assert.equal(plan.residuals.defaulter, run.positions.defaulter);
  if (plan.clearing.clearedTotal) {
    assert.equal(plan.clearing.clearedTotal, "21.8");
    assert.equal(plan.clearing.left, "19.55");
    assert.equal(plan.clearing.edges, run.clearing.edges);
  } else {
    assert.match(plan.clearing.note, /not built/);
  }
});
