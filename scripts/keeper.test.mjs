// keeperPass with prune_epoch (interface 0.0.8, UM-022): off by default, only for finalized epochs that are `lag` epochs behind, repeated until
// the contract says 0, and not again once the epoch has no pair left.
import { test } from "node:test";
import assert from "node:assert/strict";
import { keeperPass } from "./lib/keeper.mjs";

function chain(epochs, edgesLeft) {
  const sent = [];
  const view = async (method, args) => {
    if (method === "get_epoch") return args.epoch === undefined ? epochs.at(-1) : epochs.find((e) => e.epoch === args.epoch) ?? null;
    if (method === "list_obligations") return edgesLeft[args.epoch] > 0 ? [{}] : [];
    throw new Error(method);
  };
  return { view, sent, send: async ({ methodName, args }) => (sent.push([methodName, args.epoch]), `H${sent.length}`), chainNowMs: async () => 0 };
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
