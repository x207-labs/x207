# NEAR AI Agent Market (market.near.ai)

Source of the fields: [List your agent](https://docs.market.near.ai/list-your-agent.md), read on 2026-11-05. The page names these fields and no others. It gives **no character limits**, no long-description field, no categories and no tags. The fee percentage is not stated.

**Status: blocked. Do not list yet.** The market lists agents that do a job for a price, paid per hire in USD or USDC. x207 is a protocol, not such an agent, and nobody has built the agent that would take jobs. A listing needs a worker that holds an agent API token (`aat_…`) and delivers the job, and none exists ([adoption.md](../adoption.md), row 8: "What to sell is not decided"). This file is the text for the day the owner decides to build one. It does not claim that the agent exists.

## What could honestly be sold

A **read-only epoch report** of the testnet circle: the buyer names an epoch, the agent returns phase, cleared ratio, total and cleared value, the residual payments and each member's settlement, taken from the contract views and the read API through the tools `x207_epoch_report` and `x207_circle_overview`. It is a report on testnet data, and the listing must say so. It is not a clearing service for the buyer's own debts, not a gas saver and not a mainnet product. `x207_simulate_clearing` only checks whether a proposed clearing is valid; it does not clear a graph supplied by the buyer, so it is not sold here.

Because the work is a read of a free API, the owner may decide that the honest price is very low, or that the listing is not worth making before real demand exists. That is the owner's choice; this file does not set it.

## Listing text

| Field (as the docs name it) | Text |
| --- | --- |
| Name | `x207 epoch reporter (testnet)` |
| Handle | `x207-epoch-reporter` (becomes `market.near.ai/a/x207-epoch-reporter`; check that it is free) |
| Tagline (one sentence) | Reads one clearing epoch of an x207 clearing circle on NEAR testnet and returns a plain report: cleared ratio, residual payments and each member's settlement. Testnet data, mock USDT. |
| Photos and videos (up to 6, optional) | Two pictures at most: the dashboard view of epoch 8 (https://x207.vercel.app/stats) and the epoch-8 chart in the root README. Caption each: "Testnet, mock USDT." No video. |
| Hosting | Self-hosted. Leave the webhook URL empty if the worker polls with its token. |
| Price per hire | Left to the owner. Required before the listing can go live. |
| Delivery SLA | Left to the owner. Say a number only if a worker really runs; the team's keeper moves the epochs of the circle only until 2026-11-18, and an epoch asked about may not be closed yet. |
| Listing status | Keep **Draft** until a worker exists. Set **Live** only after a confirmed email and a real test job. |
| Agent API token | Create it in the web UI, show once, keep it in `.env`, never in the repository. |

The page has no description field. If the form shows one, use this text and keep it under the form's limit:

```text
x207 is a multilateral clearing layer for x402 agent payments on NEAR. This agent reads one clearing epoch of the circle x207-v013.testnet (the contract x207-circle, release 0.0.13) and returns the cleared ratio, the value left to pay and each member's settlement, from the contract views and the public read API. It runs on NEAR testnet only: the stake token is a mock USDT with no value, and no mainnet transaction has been sent. It does not move your money and does not claim a gas saving. Epochs of the circle are advanced by hand, so a very recent epoch can still be open; the report says the phase.
```

## Do not

- Do not call the agent "live" or "available" in any other channel until a worker has delivered one job.
- Do not list a price in USDC that suggests the report is worth real money to a buyer unaware that the data is a testnet.
- Do not put the worker's token, the voucher key or any NEAR key in the listing, the pictures or the repository.
