// keeperPass with prune_epoch (interface 0.0.8, UM-022): off by default, only for finalized epochs that are `lag` epochs behind, repeated until
// the contract says 0, and not again once the epoch has no pair left.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canReserve, KEEPER_GAS, keeperPass, PRUNE_GAS, PRUNE_MAX_ITEMS, PRUNE_MIN_GAS } from "./lib/keeper.mjs";

function chain(epochs, edgesLeft) {
  const sent = [];
  const gases = [];
  const view = async (method, args) => {
    if (method === "get_epoch") return args.epoch === undefined ? epochs.at(-1) : epochs.find((e) => e.epoch === args.epoch) ?? null;
    if (method === "list_obligations") return edgesLeft[args.epoch] > 0 ? [{}] : [];
    throw new Error(method);
  };
  return { view, sent, gases, send: async ({ methodName, args, gas }) => (sent.push([methodName, args.epoch]), gases.push([methodName, gas]), `H${sent.length}`), chainNowMs: async () => 0 };
}
const finalized = (epoch) => ({ epoch, phase: "finalized" });
const open = (epoch) => ({ epoch, phase: "open" });

test("TC-UM-022-20 without the option nothing is pruned", async () => {
  const c = chain([finalized(1), finalized(2), open(3)], { 1: 5, 2: 5 });
  assert.deepEqual(await keeperPass(c), []);
});

test("TC-UM-022-21 an epoch that is lag behind is pruned until the contract answers 0; a newer one and a pruned one are left", async () => {
  const c = chain([finalized(1), finalized(2), finalized(3), open(4)], { 1: 0, 2: 7, 3: 7 });
  const answers = [200, 12, 0];
  const calls = [];
  const actions = await keeperPass({ ...c, prune: { lag: 2, call: async ({ epoch, maxItems }) => (calls.push([epoch, maxItems]), { hash: `P${calls.length}`, removed: answers.shift() }) } });
  assert.deepEqual(calls, [[2, 200], [2, 200], [2, 200]]);
  assert.deepEqual(actions.map((a) => [a.method, a.epoch, a.removed]), [["prune_epoch", 2, 200], ["prune_epoch", 2, 12], ["prune_epoch", 2, 0]]);
});

test("TC-UM-022-22 an epoch that is not finalized is never pruned, and the rounds are bounded", async () => {
  const stuck = chain([{ epoch: 1, phase: "payment_window", payment_deadline: String(10n ** 30n) }, open(2), open(3)], { 1: 5 });
  assert.deepEqual(await keeperPass({ ...stuck, prune: { lag: 1, call: async () => assert.fail("must not be called") } }), []);
  const endless = chain([finalized(1), open(2), open(3)], { 1: 5 });
  let rounds = 0;
  await keeperPass({ ...endless, prune: { lag: 1, maxRounds: 4, call: async () => ({ hash: `E${++rounds}`, removed: 9 }) } });
  assert.equal(rounds, 4);
});

test("TC-UM-022-23 prune_epoch carries at least 100 Tgas for 200 items (the review measured 70.2 Tgas for 196), and the keeper script uses that constant", async () => {
  assert.equal(PRUNE_MAX_ITEMS, 200);
  assert.ok(PRUNE_MIN_GAS >= 100_000_000_000_000n);
  assert.ok(PRUNE_GAS >= PRUNE_MIN_GAS);
  assert.ok(PRUNE_GAS >= 70_200_000_000_000n * 2n, "less than twice the measured gas");
  const { readFile } = await import("node:fs/promises");
  const script = await readFile(new URL("./keeper.mjs", import.meta.url), "utf8");
  const prune = script.slice(script.indexOf('methodName: "prune_epoch"'));
  assert.match(prune.slice(0, 200), /gas: PRUNE_GAS/);
  const c = chain([finalized(1), finalized(2), open(3)], { 1: 1 });
  const seen = [];
  await keeperPass({ ...c, prune: { lag: 1, call: async ({ epoch, maxItems }) => (seen.push([epoch, maxItems]), { hash: "H", removed: 0 }) } });
  assert.deepEqual(seen[0]?.[1], PRUNE_MAX_ITEMS);
});

// SV-020: each method carries its own prepaid gas (close 20, commit 150, finalize 100 Tgas), and the balance is checked against the reserve before sending
test("TC-SV-020-01 the keeper attaches 20, 150 and 100 Tgas to close, commit and finalize", async () => {
  assert.deepEqual(KEEPER_GAS, { close_epoch: 20_000_000_000_000n, commit_epoch: 150_000_000_000_000n, finalize_epoch: 100_000_000_000_000n });
  const c = chain([{ epoch: 1, phase: "cutoff" }, { epoch: 2, phase: "commit" }, { epoch: 3, phase: "payment_window", payment_deadline: "1" }], {});
  await keeperPass({ view: c.view, send: c.send, chainNowMs: async () => 10, log: () => {} });
  assert.deepEqual(c.gases.map(([m, g]) => [m, Number(g / 1_000_000_000_000n)]), [["close_epoch", 20], ["commit_epoch", 150], ["finalize_epoch", 100]]);
});

test("TC-SV-020-02 the reserve is ten times gas times burn price plus 0.9 Tgas: 0.24 NEAR cannot reserve 250 Tgas (0.2509) but can reserve 150 Tgas (0.1509)", () => {
  const price = 100_000_000n; // burn price on testnet
  const balance = 240_000_000_000_000_000_000_000n;
  assert.equal(canReserve(balance, 250_000_000_000_000n, price), false);
  assert.equal(canReserve(balance, 150_000_000_000_000n, price), true);
  assert.equal(canReserve(balance, KEEPER_GAS.commit_epoch, price), true);
  assert.equal(canReserve(150_000_000_000_000_000_000_000n, KEEPER_GAS.commit_epoch, price), false, "0.15 NEAR is just below 0.1509");
});
