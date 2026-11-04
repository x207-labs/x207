# Outreach texts for the first outside agents (UM-146)

Status: **drafts. Nothing here has been submitted, posted, forked or opened as a pull request.** The owner of the GitHub, npm and Slack accounts sends them. Rules and formats were read on 2026-11-05 from the pages named below; where a page could not give a fact, the file says so.

The targets and the reasons are in [adoption.md](../adoption.md) (rows 3, 8, 9, 10). The goal is the "First pilot" step of that page: two to six outside agents in the testnet circle, read with `npm run metrics:adoption`.

| File | Target | What the owner does |
| --- | --- | --- |
| [awesome-mcp-servers.md](awesome-mcp-servers.md) | `punkpeye/awesome-mcp-servers` | Fork, add one line, open the pull request |
| [awesome-near.md](awesome-near.md) | `near/awesome-near` | Fork, add one table row, open the pull request |
| [x402-slack.md](x402-slack.md) | x402 Foundation Slack | Join, post one message |
| [near-ai-agent-market.md](near-ai-agent-market.md) | `market.near.ai` | Make an account, fill the listing (blocked, see the file) |

## Claims every text may make

Only these. Each is in [what-has-run.md](../what-has-run.md) or [join-the-circle.md](../join-the-circle.md).

- It runs on **NEAR testnet** (circle `x207-v013.testnet`, circle id `agents-main`). **No mainnet transaction has been sent.**
- The stake token is a **mock USDT** (`usdt.x207-deployer.testnet`). Anybody can mint it. It has no value.
- It is **not a gas saving.** [gas-epoch8-vs-transfers.md](../gas-epoch8-vs-transfers.md): epoch 8 burns more gas than 24 plain transfers. What clearing reduces is the value that has to move (epoch 8: 21.8 of 41.35 credit cleared, 7.75 USDT left to pay).
- The circle is shared and moved by hand: the team advances the epochs until a keeper runs for the judging period ([join-the-circle.md](../join-the-circle.md)).
- No outside adopter is known ([adoption.md](../adoption.md), "First pilot"). Do not write "used by", "trusted by" or "in production".

## Before sending

1. Run `npm run metrics:adoption` and update any number a text quotes if it changed.
2. The npm package `@x207/mcp` is at 0.0.3 in the repository; [adoption.md](../adoption.md) says 0.0.2 in one row and 0.0.3 in the Registry row. Check `npm view @x207/mcp version` and make the texts agree with it.
3. The pull request texts below name the repository `x207-labs/sdk`. Check that it is still public.
4. Each pull request text is one pull request for one line. Do not bundle targets.
5. **Account rule of the x402 repository:** its CONTRIBUTING asks for human review of AI-written pull requests. The texts here were drafted by an AI session; read them and own them before they go out under the owner's name.
