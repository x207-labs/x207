# Demo video script, about 90 seconds (draft for the owner to record)

Status: a draft. **Nothing here was recorded or posted.** The owner records the video and posts it (see [x-post.md](x-post.md)). Updated on 2026-11-04 for the testnet circle `x207-v013.testnet`; the long script of 2-3 November (sandbox-only, contract 0.0.9 to 0.0.12) is in the git history of this file.

Rules: keep a label `TESTNET` or `NEAR-SANDBOX` in a corner of the screen for every scene so that a sandbox run is never taken for a network run. Read numbers from the screen, do not type them. Jump-cut the waiting, with the UTC clock visible. No mainnet transaction exists; do not say or show one.

Before recording: `git clone --recurse-submodules https://github.com/x207-labs/x207.git`, `npm ci && npm run build --workspaces --if-present`, then run `npm run demo:quick` and `npm run demo:mcp` once so that the wasm and the sandbox are cached (the first run downloads them). Check the three hosted URLs answer. Open the dashboard once so the first load is not on camera.

## Scenes

Narration is about 2.4 words a second; the total is 209 words for 90 seconds, read it aloud once with a clock.

| No | Time | Label | On screen | Narration (EN) |
| --- | --- | --- | --- | --- |
| 1 | 0:00 to 0:08 | none | Title card "x207" with the line "x402 lets agents pay. x207 lets many agents settle at once." | "x402 lets agents pay. x207 lets many agents settle at once: mutual credit for agent payments on NEAR." |
| 2 | 0:08 to 0:20 | none | Three nodes A, B, C with arrows A to B, B to C, C to A, then the arrows cancel | "Agents buy from each other in both directions, one call at a time. Here A owes B, B owes C, and C owes A. Those debts cancel, so why move money for them?" |
| 3 | 0:20 to 0:42 | TESTNET | Browser: <https://x207-dashboard.vercel.app>, it opens on epoch 8. Point at the statistics: 24 vouchers, cleared ratio 0.53, default rate 7.1%, clearing time 66 s | "This is a real epoch on NEAR testnet. Fifteen agents signed twenty-four credit vouchers worth 41.35. One clearing transaction cancelled 21.8 of it. The 19.55 left nets to 7.75 USDT, owed by six debtors. Five paid. One did not, and was cut from its stake." |
| 4 | 0:42 to 0:54 | TESTNET | Terminal: `curl -s https://x207-backend-production.up.railway.app/x207/circles/agents-main/epochs/8/metrics`, highlight `voucherCount`, `cleared`, `debtAfter`, `netDebt` | "Everything is public. The read API returns the same numbers, and anybody can check the contract on chain." |
| 5 | 0:54 to 1:08 | TESTNET | Claude (or any MCP client) with the hosted server `https://x207-mcp-production.up.railway.app/mcp`; ask "Give me the report of epoch 8 of the x207 circle"; show the tool call `x207_epoch_report` and the answer | "An AI agent can read it too. This is Claude, connected to our hosted MCP server. It calls a tool and answers from the chain, with no key." |
| 6 | 1:08 to 1:22 | NEAR-SANDBOX | Terminal, jump-cut: `npm run demo:quick` ending with `120 payments became 6`, `cleared ratio: 0.6333`; then `npm run demo:mcp` showing the tool calls `x207_join`, three `x207_pay_request`, `x207_epoch_report` | "Run it yourself, with no account. One command plays an epoch of six agents on a local NEAR sandbox: one hundred twenty payments become six. Another lets an AI agent join, pay and read the clearing through MCP tools." |
| 7 | 1:22 to 1:30 | none | Card: "Prototype. No mainnet transaction. NEAR Intents ran only in the sandbox. No TEE." and the link `github.com/x207-labs/x207` | "A prototype: no mainnet yet, and NEAR Intents only in the sandbox. Code and every claim with its proof: github dot com slash x207 dash labs slash x207." |

## Where each number comes from

| On screen | Source |
| --- | --- |
| 24 vouchers, 41.35, 21.8, 0.527, 19.55, 7.75, 15 participants, 14 `residualTransfers` | `GET /x207/circles/agents-main/epochs/8/metrics` and `docs/testnet-0.0.13-realistic.json` (finalize transaction `BLsJyPoQykcQr2X5VaqxMH2dY2bon1B1U4d71FNc4bRi`) |
| Cleared ratio 0.53, default rate 7.1%, clearing time 66 s | the same endpoint (`clearedRatio` 0.5272, `defaultRate` 0.071, `clearingTimeSeconds` 65.776) |
| 120 payments became 6, 0.6333 | `npm run demo:quick`, section "Epoch metrics" |
| Tool names | `sdk/packages/mcp/README.md`; the hosted server offers the six read tools |

If the dashboard no longer opens on epoch 8 (anybody can add epochs to the shared circle), open `/stats?epoch=8` or pick epoch 8 in the list. If a number on the screen differs from the narration, change the narration, not the screen.

## What must not be said

Mainnet, NEAR Intents on testnet (`intents.testnet` has no code), a real wallet through NEAR Connect, a TEE broker, "half of the credit never moves" (7.75 of 41.35 credit moves as USDT; 21.8 is cancelled), or that a third party has used it.
