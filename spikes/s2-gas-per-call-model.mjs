#!/usr/bin/env node
// Spike S2 (UM-137): gas of paying N calls one by one vs registering one cumulative voucher per pair, with the numbers measured on testnet.
//   node spikes/s2-gas-per-call-model.mjs [calls] [pairs]
// Inputs are the measured records in docs/: gas-ft-transfer-testnet.json (UM-125, `ft_transfer`) and gas-epoch8.json (the 36 transactions of epoch 8).
// Output: Tgas of N plain transfers, of x207 (registrations + the four clearing steps), and the number of calls per pair where x207 starts to burn less.
import { readFileSync } from "node:fs";

const read = (f) => JSON.parse(readFileSync(new URL(`../docs/${f}`, import.meta.url), "utf8"));
const ft = read("gas-ft-transfer-testnet.json");
const rows = ft.transfers ?? ft.rows ?? ft;
const first = Array.isArray(rows) ? rows[0] : null;
const transferTgas = Number(first.gasBurnt) / 1e12;
const epoch = read("gas-epoch8.json");
const list = Array.isArray(epoch) ? epoch : epoch.transactions ?? epoch.rows;
const tg = (m) => list.filter((t) => t.method === m).map((t) => Number(t.gas) / 1e12);
const mean = (a) => a.reduce((n, x) => n + x, 0) / a.length;
const registerTgas = mean(tg("register_cumulative"));
const clearingTgas = ["close_epoch", "submit_clearing", "commit_epoch", "finalize_epoch"].reduce((n, m) => n + mean(tg(m)), 0);

const calls = Number(process.argv[2] ?? 120);
const pairs = Number(process.argv[3] ?? 12);
const plain = calls * transferTgas;
const x207 = pairs * registerTgas + clearingTgas;
// calls per pair at which x207 (registrations + clearing) burns the same gas as plain transfers, for this number of pairs
const breakEvenCallsPerPair = (pairs * registerTgas + clearingTgas) / (pairs * transferTgas);
const r = (x) => Math.round(x * 100) / 100;
console.log(JSON.stringify({
  measuredTgas: { ft_transfer: r(transferTgas), register_cumulative_mean: r(registerTgas), clearing_four_steps: r(clearingTgas) },
  scenario: { calls, pairs, callsPerPair: r(calls / pairs) },
  plainTransfersTgas: r(plain),
  x207Tgas_registrationsAndClearing: r(x207),
  x207BurnsLessGas: x207 < plain,
  breakEvenCallsPerPair: r(breakEvenCallsPerPair),
  note: "residual payments and claims are left out (they scale with the number of net debtors and creditors, not with calls); an x402 `exact` payment also pays the facilitator's relay, which is not counted here",
}, null, 2));
