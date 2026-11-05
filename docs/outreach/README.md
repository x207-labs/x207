# Outreach texts for the first outside agents (UM-146)

Status on 2026-11-05: **two pull requests are open; the Slack message and the Agent Market listing are not sent.** The coordinator submitted the two pull requests with the texts in this folder (narrative changed from "mutual-credit" to "multilateral clearing"). The owner of the Slack and market accounts sends the rest. Rules and formats were read on 2026-11-05 from the pages named below; where a page could not give a fact, the file says so.

The targets and the reasons are in [adoption.md](../adoption.md) (rows 3, 8, 9, 10). The goal is the "First pilot" step of that page: two to six outside agents in the testnet circle, read with `npm run metrics:adoption`.

| File | Target | State |
| --- | --- | --- |
| [awesome-mcp-servers.md](awesome-mcp-servers.md) | `punkpeye/awesome-mcp-servers` | PR open: [#18606](https://github.com/punkpeye/awesome-mcp-servers/pull/18606) |
| [awesome-near.md](awesome-near.md) | `near/awesome-near` | PR open: [#90](https://github.com/near/awesome-near/pull/90) |
| [x402-slack.md](x402-slack.md) | x402 Foundation Slack | not sent: join, pick the channel, post one message |
| [x402-4131-evm-comment.md](x402-4131-evm-comment.md) | comment on x402#4131 | draft, the owner posts it |
| [near-ai-agent-market.md](near-ai-agent-market.md) | `market.near.ai` | not sent, blocked (see the file) |

## Claims every text may make

Only these. Each is in [what-has-run.md](../what-has-run.md) or [join-the-circle.md](../join-the-circle.md).

- It runs on **NEAR testnet** (circle `x207-v013.testnet`, circle id `agents-main`). **No mainnet transaction has been sent.**
- The stake token is a **mock USDT** (`usdt.x207-deployer.testnet`). Anybody can mint it. It has no value.
- It is **not a gas saving.** [gas-epoch8-vs-transfers.md](../gas-epoch8-vs-transfers.md): epoch 8 burns more gas than 24 plain transfers. What clearing reduces is the value that has to move (epoch 8: 21.8 of 41.35 credit cleared, 7.75 USDT left to pay).
- The circle is shared. The team's keeper moves its epochs until 2026-11-18; after that anybody can move them by hand ([join-the-circle.md](../join-the-circle.md)).
- No outside adopter is known ([adoption.md](../adoption.md), "First pilot"). Do not write "used by", "trusted by" or "in production".

## Before sending

1. Run `npm run metrics:adoption` and update any number a text quotes if it changed.
2. The npm package `@x207/mcp` is at 0.0.4 in the repository, in [adoption.md](../adoption.md) and in the Official MCP Registry. Check `npm view @x207/mcp version` and make the texts agree with it.
3. The pull request texts below name the repository `x207-labs/sdk`. Check that it is still public.
4. Each pull request text is one pull request for one line. Do not bundle targets.
5. **Account rule of the x402 repository:** its CONTRIBUTING asks for human review of AI-written pull requests. The texts here were drafted by an AI session; read them and own them before they go out under the owner's name.
