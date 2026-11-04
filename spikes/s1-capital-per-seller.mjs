#!/usr/bin/env node
// Spike S1 (UM-137): how much capital does each model lock for the graph of epoch 8, and how many onchain deposits?
//   node spikes/s1-capital-per-seller.mjs
// Pure computation on the graph that ran on x207-v013.testnet (scripts/lib/realistic-epoch.mjs). No network, no key.
//
// Model A, x402 `batch-settlement` EVM channel: capital-backed, one channel per (payer, receiver). The spec says the client
//   "deposits funds into onchain channels once" and the channel config carries the receiver, so a payer that buys from k sellers
//   needs k channels and k deposits. Best case (an oracle sized every deposit exactly): the deposit of a channel is what the
//   payer owes that receiver in the epoch.
// Model B, x207 MVP: one stake per member, `limit <= stake` and limit = 80% of stake (`base_limit_ratio` 8000), so the stake
//   must be at least 125% of what a member owes in total.
// Model C, `exact`: nothing is locked, but every payment is one transfer.
import { GRAPH } from "../scripts/lib/realistic-epoch.mjs";

const owedBy = new Map(); // payer -> total owed
const payees = new Map(); // payer -> Set of receivers
for (const [d, c, a] of GRAPH) {
  owedBy.set(d, (owedBy.get(d) ?? 0) + a);
  (payees.get(d) ?? payees.set(d, new Set()).get(d)).add(c);
}
const total = GRAPH.reduce((n, [, , a]) => n + a, 0);
const channels = GRAPH.length; // every edge of the epoch-8 graph is a different (payer, receiver) pair
const payers = owedBy.size;
const maxFanOut = Math.max(...[...payees.values()].map((s) => s.size));
const x207Stake = [...owedBy.values()].reduce((n, v) => n + v / 0.8, 0);
const round = (x) => Math.round(x * 100) / 100;

const out = {
  graph: { members: 15, edges: GRAPH.length, totalObligation: round(total), payers, maxSellersOfOnePayer: maxFanOut },
  A_channels_best_case: { onchainDeposits: channels, capitalLocked: round(total), note: "needs a deposit per seller and an exact forecast of what each seller will be paid" },
  B_x207_mvp: { stakes: payers, capitalLocked: round(x207Stake), ratioToObligation: round(x207Stake / total), note: "one stake covers all sellers; the capital is 125% of what each payer owes, and clearing then cancels 21.8 of the 41.35" },
  C_exact: { onchainTransfers: GRAPH.length, capitalLocked: 0, note: "24 vouchers would be 24 transfers, and no netting" },
};
console.log(JSON.stringify(out, null, 2));
