// UM-124: the parts of scripts/testnet-swarm.mjs that need no network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENT_ACCOUNTS, CIRCLE, netByAgent, parseArgs } from "./testnet-swarm.mjs";
import { trafficFor } from "../demo/swarm-traffic.ts";

test("the plan is the default and --execute is the only way to send", () => {
  assert.equal(parseArgs([]).execute, false);
  assert.equal(parseArgs(["--execute"]).execute, true);
  assert.throws(() => parseArgs(["--mainnet"]), /unknown option/);
});

test("every account of the run is a .testnet account", () => {
  for (const id of [CIRCLE, ...Object.values(AGENT_ACCOUNTS)]) assert.match(id, /\.testnet$/);
});

test("the traffic of epoch 0 is 15 trades that net to zero: the figures of docs/testnet-swarm.md", () => {
  const trades = trafficFor(0);
  assert.equal(trades.length, 15);
  assert.equal(trades.reduce((n, t) => n + t.credit, 0), 114);
  const net = netByAgent(trades);
  assert.deepEqual(net, { translator: 5, summarizer: -7, scraper: -1, image: -2, cleaner: 3, gpu: 2 });
  assert.equal(Object.values(net).reduce((a, b) => a + b, 0), 0);
});
