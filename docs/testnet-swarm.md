# Six named agents, one epoch, on NEAR testnet (UM-124)

Six agents, each a NEAR testnet account named after its service, trade with each other in one epoch of a circle of its own and the circle clears it. Everything here ran on NEAR testnet on 2026-11-04. The hashes are in [testnet-swarm.json](testnet-swarm.json) (hashes and names only; no key). Re-run: `node scripts/testnet-swarm.mjs` prints the plan, `--execute` sends (about 25 minutes of real time).

## What ran

| Item | Value |
| --- | --- |
| Circle | `x207-swarm.x207r-deploy.testnet`, circle id `swarm-demo`, made from the `v0.0.13` release wasm (sha256 `b9327f2b...7054`, checked against the pin of `scripts/deploy-mainnet.mjs` before the deploy) |
| Parameters | `epoch_length` 300 s, `payment_window` 900 s, `proposal_window` 60 s, open admission |
| Token | the open mock USDT `usdt.x207-deployer.testnet`; each agent staked 150 credit |
| Agents | `x207r-translator`, `x207r-summarizer`, `x207r-scraper`, `x207r-image`, `x207r-cleaner`, `x207r-gpu` (all `.testnet`) |
| Keeper | `x207r-circle.testnet` closes, proposes, commits and finalizes; the owner of the circle is `x207r-deploy.testnet` |
| Traffic | the 15 trades of `npm run demo:swarm` for epoch 0 (`demo/swarm-traffic.ts`): every agent buys from the next one and the one after next, the odd ones also from the one three places on |
| Solver | the clearing code of this repository (`solver/dist/mincostflow`), run in the script; its proposal went to `submit_clearing` and the contract checked it |

## Result

| Epoch 1 | |
| --- | --- |
| Vouchers | 15 (every agent signed and registered its own; 13 s for all 15) |
| Obligation | 114 credit |
| Cleared | 99 credit, ratio 0.8684, 13 clearing edges |
| Residual (net debt) | 10 credit from three debtors, all three paid in the payment window |
| Phase at the end | `finalized`, no default; the three creditors claimed |

| Agent | Bought (vouchers, credit) | Sold (vouchers, credit) | Net trade | After clearing | Residual paid | Claim |
| --- | --- | --- | --- | --- | --- | --- |
| translator | 2, 13 | 3, 18 | +5 | creditor 5 | - | claimed |
| summarizer | 3, 21 | 2, 14 | -7 | debtor 7 | 7 | - |
| scraper | 2, 21 | 3, 20 | -1 | debtor 1 | 1 | - |
| image | 3, 22 | 2, 20 | -2 | debtor 2 | 2 | - |
| cleaner | 2, 18 | 3, 21 | +3 | creditor 3 | - | claimed |
| gpu | 3, 19 | 2, 21 | +2 | creditor 2 | - | claimed |

The per-agent rows are written by the script from the trades and from `list_positions` (the exact numbers, with who bought from whom, are under `perAgent` in the JSON).

## Transactions

Full hashes of the steps that matter (the JSON has all 49, one per call, including each join, stake and voucher):

- deploy of the wasm: [`CdmyfmyqKMMeRjs19eKJLMk2ethb1AgX2K4RtKB5w2kQ`](https://testnet.nearblocks.io/txns/CdmyfmyqKMMeRjs19eKJLMk2ethb1AgX2K4RtKB5w2kQ), `new`: [`4dLAx4AiqJEL7JdYHwRULqo5ZxsLGHsJ8i7UTWQcH865`](https://testnet.nearblocks.io/txns/4dLAx4AiqJEL7JdYHwRULqo5ZxsLGHsJ8i7UTWQcH865)
- first voucher, translator to summarizer, 10 credit: [`9je84euzHGDbUbXBzFMHkd3TVVAQLQFsYG7PzGxAkE5`](https://testnet.nearblocks.io/txns/9je84euzHGDbUbXBzFMHkd3TVVAQLQFsYG7PzGxAkE5)
- `close_epoch`: [`BEGw3HVUiyJAAcMEtxCEbdA9qBd7MQi1eESceQUE7ASz`](https://testnet.nearblocks.io/txns/BEGw3HVUiyJAAcMEtxCEbdA9qBd7MQi1eESceQUE7ASz)
- `submit_clearing`: [`3eZn2k2HhwmxH2ysrMs3yfRw3HxdG2fEooDMQZrXPSe5`](https://testnet.nearblocks.io/txns/3eZn2k2HhwmxH2ysrMs3yfRw3HxdG2fEooDMQZrXPSe5)
- `commit_epoch`: [`6DC3L8Xqv9a4XN46Uh6z4yxMZewc2GiBx5PUK3Y5p3Wn`](https://testnet.nearblocks.io/txns/6DC3L8Xqv9a4XN46Uh6z4yxMZewc2GiBx5PUK3Y5p3Wn)
- residuals (`ft_transfer_call` with `settle`): summarizer [`MJJDFBNEMNH4YtpmuRZJvtNuDWf1ZSYTqxmndb3zzsq`](https://testnet.nearblocks.io/txns/MJJDFBNEMNH4YtpmuRZJvtNuDWf1ZSYTqxmndb3zzsq), scraper [`93Sydz6v8d4XzsvL6vGR3CXoG38bgsJDvkeZKNGQd1po`](https://testnet.nearblocks.io/txns/93Sydz6v8d4XzsvL6vGR3CXoG38bgsJDvkeZKNGQd1po), image [`CDg3oqnYNkkrYSetFe4XW8RecxTfoGuNZUqtNBTif79y`](https://testnet.nearblocks.io/txns/CDg3oqnYNkkrYSetFe4XW8RecxTfoGuNZUqtNBTif79y)
- `finalize_epoch`: [`F2JvPwwNjyiMM8wttCatmTX53vw7MWwmyCnMDfT5pqtq`](https://testnet.nearblocks.io/txns/F2JvPwwNjyiMM8wttCatmTX53vw7MWwmyCnMDfT5pqtq)
- claims: translator [`6qKjFe8u9mzYYz9jk3jzq5z2EMuUjFTBZBj9Lg7YGk3Q`](https://testnet.nearblocks.io/txns/6qKjFe8u9mzYYz9jk3jzq5z2EMuUjFTBZBj9Lg7YGk3Q), cleaner [`JC6j5xWT5K1ERzwu1csmuzNiiM6o1aMywjqeTgoRJN47`](https://testnet.nearblocks.io/txns/JC6j5xWT5K1ERzwu1csmuzNiiM6o1aMywjqeTgoRJN47), gpu [`3UQxwVP3P5aKNQrFUtJtVmzxvLfWnqqchp3hJJRj3mt8`](https://testnet.nearblocks.io/txns/3UQxwVP3P5aKNQrFUtJtVmzxvLfWnqqchp3hJJRj3mt8)

## What this does and does not show

- The agents here are accounts that sign and register vouchers on a fixed traffic pattern, as in `npm run demo:swarm`. No model answers anything and no HTTP service is called; the x402 side is covered by the sandbox end-to-end tests, not by this run.
- One epoch of one run, with a keeper that is a script of this repository, not a deployed keeper service. The circle has no keeper after the run, so any further epoch would stall past its cutoff.
- Nobody defaulted. The default path is in epoch 8 of `x207-v013.testnet` ([testnet-0.0.13-realistic.json](testnet-0.0.13-realistic.json)).
- The accounts of the agents and of the keeper are testnet accounts that already existed (`x207r-*`); the circle account is new. The token is a mock with open minting, so "credit" here carries no value.
