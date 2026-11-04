// Tests for scripts/check-numbers.mjs (UM-103). Run: node --test scripts/check-numbers.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { checkText, compareSources, truthFromApi, truthFromRun } from "./check-numbers.mjs";

const run = JSON.parse(readFileSync(new URL("../docs/testnet-0.0.13-realistic.json", import.meta.url), "utf8"));
const truth = truthFromRun(run);
const metrics = { voucherCount: 24, totalVoucherValue: "41350000", cleared: "21800000", clearedRatio: 0.5272, debtAfter: "19550000", netDebt: "7750000", residualTransfers: 14, graph: { participants: 15 } };

test("the run gives the figures of epoch 8: 21.8 cancelled, 19.55 left, 7.75 due, 7.2 paid, 0.55 from the stake", () => {
  assert.equal(truth.vouchers, 24);
  assert.ok(Math.abs(truth.obligation - 41.35) < 1e-9);
  assert.ok(Math.abs(truth.cleared - 21.8) < 1e-9);
  assert.ok(Math.abs(truth.left - 19.55) < 1e-9);
  assert.ok(Math.abs(truth.due - 7.75) < 1e-9);
  assert.ok(Math.abs(truth.paid - 7.2) < 1e-9);
  assert.ok(Math.abs(truth.fromStake - 0.55) < 1e-9);
  assert.equal([truth.debtors, truth.debtorsPaid, truth.creditors].join(), "6,5,8");
});

test("the run and the API agree; a changed API figure is reported", () => {
  assert.deepEqual(compareSources(truth, truthFromApi(metrics)), []);
  const other = compareSources(truth, truthFromApi({ ...metrics, netDebt: "7200000", clearedRatio: 0.6 }));
  assert.equal(other.length, 2);
  assert.match(other.join("\n"), /due/);
});

const good = [
  "In the realistic epoch (epoch 8) 24 asymmetric obligations of 41.35 credit among 15 participants, 21.8 credit cancelled by the clearing (ratio 0.527), 19.55 credit left as residual obligations that net to 7.75 USDT due from six debtors.",
  "Testnet epoch: 24 vouchers (41.35), one clearing cancels 21.8; the 19.55 left nets to 7.75 USDT (5 paid 7.2, 0.55 from a stake).",
  "A realistic epoch clears on a real network: 24 asymmetric obligations, 21.8 of 41.35 credit cleared (ratio 0.527)",
].join("\n");

test("the correct sentences pass", () => {
  const counter = { n: 0 };
  assert.deepEqual(checkText("t.md", good, truth, counter), []);
  assert.ok(counter.n >= 12, `figures recognised: ${counter.n}`);
});

test("each wrong figure is found by name, with its line", () => {
  const bad = (from, to) => checkText("t.md", good.replace(from, to), truth).map((f) => `${f.line}:${f.rule}:${f.found}`);
  assert.deepEqual(bad("21.8 credit cancelled", "22.8 credit cancelled"), ["1:cleared:cleared 22.8"]);
  assert.deepEqual(bad("the 19.55 left", "the 19.5 left"), ["2:left:left 19.5"]);
  assert.deepEqual(bad("7.75 USDT due", "7.5 USDT due"), ["1:due:due 7.5"]);
  assert.deepEqual(bad("(ratio 0.527)\n", "(ratio 0.53)\n").length, 0, "0.53 is not a three-decimal ratio and is not read");
  assert.deepEqual(bad("(ratio 0.527), 19", "(ratio 0.572), 19"), ["1:ratio:ratio 0.572"]);
  assert.deepEqual(bad("24 asymmetric obligations of 41.35", "25 asymmetric obligations of 41.35"), ["1:vouchers:vouchers 25"]);
  assert.deepEqual(bad("24 asymmetric obligations of 41.35", "24 asymmetric obligations of 41.53"), ["1:obligation:obligation 41.53"]);
  assert.deepEqual(bad("5 paid 7.2", "5 paid 7.75"), ["2:paid:paid 7.75"]);
  assert.deepEqual(bad("0.55 from a stake", "0.5 from a stake"), ["2:fromStake:fromStake 0.5"]);
});

test("a figure is compared at the decimals the text writes", () => {
  assert.deepEqual(checkText("t.md", "epoch 8: 21.80 credit cancelled", truth).map((f) => f.rule), []);
  assert.deepEqual(checkText("t.md", "epoch 8: 21.8 credit cancelled, 19.2 left", truth).map((f) => f.found), ["left 19.2"]);
});

test("lines that do not speak of epoch 8 are not read; the sandbox ratio 0.6333 is not epoch 8", () => {
  assert.deepEqual(checkText("t.md", "demo:quick: cleared ratio: 0.6333, 120 payments became 6, 9 credit cancelled", truth), []);
});

test("'half of the credit never moves' is flagged as a claim and allowed as a warning", () => {
  assert.equal(checkText("t.md", "In epoch 8 half of the credit never moves.", truth).length, 1);
  assert.deepEqual(checkText("t.md", 'Do not say "half of the credit never moves" (epoch 8).', truth), []);
});
