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
if (!process.argv.includes("--sellers")) console.log(JSON.stringify(out, null, 2));

// UM-141: a payer whose k sellers are not known in advance. It will spend `budget` credit in the epoch, in calls of `price` each, and the split
// between the k sellers is not known when the funds are locked.
//   node spikes/s1-capital-per-seller.mjs --sellers 10 --budget 100 --price 0.02
// - channels with a forecast: the best case above, the deposits add up to the budget (needs the exact split);
// - channels, no forecast: every channel must be able to carry the whole budget, so k x budget is locked;
// - channels with small top-ups at the default of docs.x402.org (a deposit hint of 10 x the price of a call): little is locked at any time (k x 10 x price), but a deposit transaction is needed each time a channel runs dry, about budget / (10 x price) of them in all;
// - x207: one stake of budget / 0.8 for any k.
const flag = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? dflt : Number(process.argv[i + 1]); };
if (process.argv.includes("--sellers")) {
  const k = flag("sellers", 10), budget = flag("budget", 100), price = flag("price", 0.02);
  console.log(JSON.stringify({
    scenario: { sellers: k, budget, price },
    channels_with_forecast: { deposits: k, capitalLocked: round(budget) },
    channels_no_forecast: { deposits: k, capitalLocked: round(k * budget) },
    channels_small_topups: { deposits: Math.max(k, Math.ceil(budget / (10 * price))), capitalLockedAtATime: round(k * 10 * price), note: "each deposit is an onchain transaction (about 140 thousand gas on Base according to the PayAI documentation)" },
    x207: { stakes: 1, capitalLocked: round(budget / 0.8) },
  }, null, 2));
}
