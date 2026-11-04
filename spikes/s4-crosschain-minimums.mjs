#!/usr/bin/env node
// Spike S4 (UM-137): what does it cost, and what is the smallest amount, to pay a micro-amount out of NEAR Intents to another chain?
//   node spikes/s4-crosschain-minimums.mjs
// Asks the public 1Click API for DRY quotes (`dry: true`: no deposit address, no funds, no key) of USDT held in Intents to a few destination chains,
// for amounts from 0.01 to 5 USDT. Prints the amount that would arrive and the share lost. The answer is of the day it runs: fees and minimums move.
const API = "https://1click.chaindefuser.com/v0/quote";
const DESTS = {
  "USDC@Base": { asset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", recipient: "0x1111111111111111111111111111111111111111" },
  "USDT@Tron": { asset: "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near", recipient: "TLsV52sRDL79HXGGm9yzwKibb6BeruhUzy" },
};
const AMOUNTS = [10_000n, 100_000n, 1_000_000n, 5_000_000n]; // 0.01, 0.1, 1, 5 USDT (6 decimals)
const deadline = new Date(Date.now() + 3_600_000).toISOString();
const rows = [];
for (const [name, d] of Object.entries(DESTS)) {
  for (const amount of AMOUNTS) {
    const body = {
      dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100,
      originAsset: "nep141:usdt.tether-token.near", destinationAsset: d.asset, amount: amount.toString(),
      depositType: "INTENTS", refundType: "INTENTS", refundTo: "x207-probe.near", recipient: d.recipient, recipientType: "DESTINATION_CHAIN", deadline,
    };
    const res = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    const out = j?.quote?.amountOut;
    rows.push({
      to: name, sentUSDT: Number(amount) / 1e6, http: res.status,
      arrivesUSDT: out === undefined ? null : Number(out) / 1e6,
      lostShare: out === undefined ? null : Math.round((1 - Number(out) / Number(amount)) * 1000) / 10 + "%",
      message: out === undefined ? String(j?.message ?? "").slice(0, 120) : undefined,
    });
  }
}
console.log(JSON.stringify({ date: new Date().toISOString(), api: API, rows }, null, 2));
