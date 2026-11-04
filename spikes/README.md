# Spikes: evidence for the problem x207 addresses (UM-137)

Four small scripts that anyone can run again. Each prints JSON. None needs a mainnet key or real money.

| Script | Question | Needs |
| --- | --- | --- |
| [s1-capital-per-seller.mjs](s1-capital-per-seller.mjs) | How much capital, and how many onchain deposits, do per-seller channels, x207 stakes and plain transfers need for the graph of epoch 8? | nothing (pure) |
| [s2-gas-per-call-model.mjs](s2-gas-per-call-model.mjs) | At how many calls per pair does x207 burn less gas than one transfer per call, using the gas measured on testnet? | the records in `docs/` |
| [s3-testnet-latency-and-no-cash.mjs](s3-testnet-latency-and-no-cash.mjs) | How long does one onchain payment take to reach `FINAL` on testnet, and what happens when the payer holds too little? | the testnet key file of the aux members (`X207_SECRETS_DIR`), `npm ci` in `backend` |
| [s4-crosschain-minimums.mjs](s4-crosschain-minimums.mjs) | What does it cost to pay a micro-amount from NEAR Intents to another chain, and what is the smallest amount? | internet; dry quotes of the 1Click API, no key |

```bash
node spikes/s1-capital-per-seller.mjs
node spikes/s2-gas-per-call-model.mjs 120 12   # calls, pairs
node spikes/s3-testnet-latency-and-no-cash.mjs
node spikes/s4-crosschain-minimums.mjs
```

The graph in S1 is the one we designed for epoch 8 (`scripts/lib/realistic-epoch.mjs`), not traffic of outside agents; S3 and S4 depend on the day they run.
