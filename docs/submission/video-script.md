# Demo video script, about 90 seconds (draft for the owner to record)

Status: a draft. **Nothing here was recorded or posted.** The owner records the video and posts it (see [x-post.md](x-post.md)). Updated on 2026-11-04 for the testnet circle `x207-v013.testnet`; the long script of 2-3 November (sandbox-only, contract 0.0.9 to 0.0.12) is in the git history of this file.

Rules: keep a label `TESTNET` or `NEAR-SANDBOX` in a corner of the screen for every scene so that a sandbox run is never taken for a network run. Read numbers from the screen, do not type them. Jump-cut the waiting, with the UTC clock visible. No mainnet transaction exists; do not say or show one.

Before recording: run `node spikes/s3-testnet-latency-and-no-cash.mjs` and `node spikes/s4-crosschain-minimums.mjs` once and read the numbers of scene 3 from the output, because fees and minimums change. Then `git clone --recurse-submodules https://github.com/x207-labs/x207.git`, `npm ci && npm run build --workspaces --if-present`, then run `npm run demo:quick` and `npm run demo:mcp` once so that the wasm and the sandbox are cached (the first run downloads them). Check the three hosted URLs answer. Open the dashboard once so the first load is not on camera.

## Scenes

The story is background, then the problem, then x207, then the honest limits. Narration is about 2.4 words a second; the total is about 215 words for 90 seconds, read it aloud once with a clock. Show the source on screen in scenes 2 and 3 (a small caption with the name and date).

| No | Time | Label | On screen | Narration (EN) |
| --- | --- | --- | --- | --- |
| 1 | 0:00 to 0:06 | none | Title card "x207" with the line "x402 lets agents pay. x207 lets many agents settle at once." | "x402 lets agents pay. x207 clears what they owe each other." |
| 2 | 0:06 to 0:24 | none | Two captions, one at a time: the abstract of arXiv:2607.12575 (Ling et al., 14 Jul 2026) with "21.20% fictitious" and "63.78% internal" highlighted; then the headline of American Banker, 2026-09-18, "Agentic payment rail shows volume decline" | "Agents are starting to pay each other, but the market is small. A study of 280 days of x402 on Base found that 21 percent of settlements were fictitious and 64 percent stayed inside one linked cluster. Daily volume fell from about 800 thousand dollars in January to about 40 thousand in September." |
| 3 | 0:24 to 0:42 | TESTNET | Terminal: `node spikes/s3-testnet-latency-and-no-cash.mjs` (median 4.25 s) and `node spikes/s4-crosschain-minimums.mjs` (0.01 USDT to Base: 24.2% lost; Tron: refused below about 1.89) | "Paying every call on chain takes about four seconds to final on testnet. A one cent payment to another chain loses a quarter of its value, and some routes refuse anything under about two dollars. The usual fix, a channel per seller, needs a deposit per seller, sized in advance." |
| 4 | 0:42 to 1:02 | TESTNET | Browser: <https://x207-dashboard.vercel.app>, it opens on epoch 8. Point at: 24 vouchers, cleared ratio 0.53, default rate 7.1%, clearing time 66 s | "x207 asks each member for one stake, then nets the debts. This is epoch 8 on NEAR testnet. Twenty-four vouchers worth 41.35. Netting left seven point seven five USDT to move: five debtors paid 7.2, and the 0.55 of the sixth came from its stake. Separately, the solver cancelled 21.8 of the gross obligations, which does not change who pays." |
| 5 | 1:02 to 1:14 | TESTNET | Config of an MCP client with `npx -y mcp-remote https://mcp.x207.boxd.sh/mcp`; ask "Give me the report of epoch 8 of the x207 circle"; show the tool call `x207_epoch_report` and the answer | "An AI agent can read it too. Add the MCP server with npx, no key, and ask for the epoch report." |
| 6 | 1:14 to 1:30 | none | Card with three lines: "More gas than plain transfers unless a pair trades several times per epoch", "Stake of at least 125% of the debt", "Helps only where debts form cycles"; then "Prototype. Testnet only, mock USDT. No mainnet transaction." and `github.com/x207-labs/x207` | "The limits. It burns more gas than plain transfers unless a pair trades several times an epoch. It locks at least 125 percent of the debt, and it helps only where debts go in cycles. Testnet only, no mainnet. Code and proofs: github dot com slash x207 dash labs slash x207." |

## Where each number comes from

| On screen | Source |
| --- | --- |
| 24 vouchers, 41.35, 21.8, 0.527, 19.55, 7.75, 15 participants, 14 `residualTransfers` | `GET /x207/circles/agents-main/epochs/8/metrics` and `docs/testnet-0.0.13-realistic.json` (finalize transaction `BLsJyPoQykcQr2X5VaqxMH2dY2bon1B1U4d71FNc4bRi`) |
| Cleared ratio 0.53, default rate 7.1%, clearing time 66 s | the same endpoint (`clearedRatio` 0.5272, `defaultRate` 0.071, `clearingTimeSeconds` 65.776) |
| 21.20% fictitious, 63.78% internal, 280 days, Base | abstract of [arXiv:2607.12575](https://arxiv.org/abs/2607.12575), read on 2026-11-04 |
| About 800 thousand to 40 thousand dollars a day | [American Banker, 2026-09-18](https://www.americanbanker.com/payments/news/agentic-payment-rail-shows-volume-decline); its headline says 93%, the body implies about 95%, and the measurer is not named, so say "about" |
| About four seconds (median 4.25 s), 24.2% lost, Tron minimum about 1.89 | `spikes/s3-testnet-latency-and-no-cash.mjs` and `spikes/s4-crosschain-minimums.mjs`, run on 2026-11-04; fees and minimums move, so re-run before recording |
| More gas, 125% of the debt, cycles only | [gas-epoch8-vs-transfers.md](../gas-epoch8-vs-transfers.md), [problem-and-gap.md](../problem-and-gap.md) |
| Tool names | `sdk/packages/mcp/README.md`; the hosted server offers the six read tools |

If the dashboard no longer opens on epoch 8 (anybody can add epochs to the shared circle), open `/stats?epoch=8` or pick epoch 8 in the list. If a number on the screen differs from the narration, change the narration, not the screen.

## What must not be said

That x207 saves gas or is cheaper to run (it burns more gas than plain transfers in epoch 8), credit without cash (a member's limit is at most its stake), that x402 traffic is full of cycles (the study says it is star-shaped), mainnet, NEAR Intents on testnet (`intents.testnet` has no code), a real wallet through NEAR Connect, a TEE broker, "half of the credit never moves" (7.75 of 41.35 credit is due as USDT, 7.2 of it paid by debtors; 21.8 is cancelled), or that a third party has used it.
