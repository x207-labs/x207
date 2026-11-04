# near/awesome-near

**Status: PR open, 2026-11-05: [near/awesome-near#90](https://github.com/near/awesome-near/pull/90).** Submitted by the coordinator with the row and text below (the narrative is "multilateral clearing"). Nothing is decided until a maintainer merges or comments.

Source of the rules: the [README](https://github.com/near/awesome-near/blob/master/README.md) of the default branch `master`, read on 2026-11-05. The repository has no CONTRIBUTING file at `main`; the README is the only source. (The path `main/README.md` answers 404; use `master`.)

## What the rules say

- To add a tool, **open a pull request with the package name and a one-line description.**
- Every section is a two-column table: `| Package | Description |`, with the name linked, for example `| [near-cli-rs](https://github.com/near/near-cli-rs) | Human-friendly interactive CLI for NEAR Protocol interactions |`.
- The README says that products built on NEAR belong in the NEAR Catalog (`dev.near.org/applications`, linked at the top of the README), not in this list. The Catalog page did not load on 2026-11-04 ([adoption.md](../adoption.md), unchecked leads). The x207 MCP server is a developer tool, so it fits this list; the owner should not also list x207 as a "product" here.
- There is no section for payments. Sections that could take it: `CLI Tools` (it holds `near-hydra`, described as "All-in-one CLI + MCP server for Chain Signatures and NEAR Intents across 10 chains, built for AI agents", so there is a precedent for an MCP server) and `AI and Cloud Services` (NEAR AI services, no third-party tools in it on 2026-11-05).

## Section

`CLI Tools`. Reason: the only MCP server already in the list is there. Second choice: none; do not create a new section in the first pull request.

## The row

Add it at the end of the `CLI Tools` table (the table is not alphabetical):

```markdown
| [@x207/mcp](https://github.com/x207-labs/sdk/tree/main/packages/mcp) | MCP server for x207, multilateral clearing of x402 agent payments on NEAR; testnet only, mock USDT |
```

The row is one line, one sentence, and says "testnet only". It does not call x207 a payments network, a mainnet product or a gas saver.

## Pull request

Branch: `add-x207-mcp`. Commit message: `Add @x207/mcp to CLI Tools`.

Title:

```text
Add @x207/mcp (MCP server for x402 agent payments, NEAR testnet) to CLI Tools
```

Body:

```markdown
Adds one row to **CLI Tools**: [`@x207/mcp`](https://github.com/x207-labs/sdk/tree/main/packages/mcp).

It is an MCP server for x207, a multilateral clearing layer for x402 agent payments on NEAR (an `x207-circle` contract, a TypeScript SDK and a solver). Agents pay each other with signed vouchers; once per epoch the debt cycles are cleared and only the residual moves in USDT. A model can read a circle and, with explicit opt-in switches, join it and pay x402 endpoints.

Honest scope:
- Runs on NEAR **testnet** (`x207-v013.testnet`); no mainnet transaction has been sent.
- The stake token is a mock USDT that anybody can mint.
- No gas saving is claimed.

It fits the list as an installable developer tool (`npx -y @x207/mcp`), like `near-hydra` in the same table. Apache-2.0. Also in the Official MCP Registry as `io.github.x207-labs/x207-mcp`.
```
