# punkpeye/awesome-mcp-servers

**Status: PR open, 2026-11-05: [punkpeye/awesome-mcp-servers#18606](https://github.com/punkpeye/awesome-mcp-servers/pull/18606).** Submitted by the coordinator; on 2026-11-05 the line gained the Glama score badge (commit `78a6e08` in the fork `Shenhan01-sys:add-x207-mcp-server`) and the body was rewritten to "multilateral netting" with the Glama box ticked. The text below is that final version. Nothing is decided until a maintainer merges or comments. Outside members of the circle: still 0 ([adoption.md](../adoption.md)).

**Read again on 2026-11-08 (read only, nothing posted):** the PR is still `OPEN` and `MERGEABLE`, with no maintainer comment and no human review (one Copilot review). The checks `check-submission` pass and `welcome` is skipped; the labels are `has-emoji`, `valid-name` and `has-glama`. The last bot comment (2026-11-05 05:01 UTC, `glama-badge-check`) asks that Glama has scored the server; the Glama page [x207-labs/sdk](https://glama.ai/mcp/servers/x207-labs/sdk) now shows TDQS A 4.4 of 5, scored 2026-11-05 05:35 across 6 tools, so that request is met. The badge URL answers 200 and the hosted MCP endpoint answers `initialize` (server `x207` 0.0.6). Still open, and both need the owner or a public action: the connector listing is not claimed, and no outside agent has joined.

Source of the rules: [CONTRIBUTING.md](https://github.com/punkpeye/awesome-mcp-servers/blob/main/CONTRIBUTING.md) and the legend of the [README](https://github.com/punkpeye/awesome-mcp-servers/blob/main/README.md), read on 2026-11-05.

## What the rules say

- Scope: a server with a **public GitHub repository that you install and run yourself**. A remote-only server (a hosted URL) belongs in `awesome-remote-mcp-servers`. `@x207/mcp` qualifies: public repository `x207-labs/sdk`, installable with `npx -y @x207/mcp`.
- Edit `README.md` only. One server per line. The line has the server name linked to its repository and a short description.
- Put the line in the right category. CONTRIBUTING asks for **alphabetical order inside a category**. In the current README the Finance & Fintech list does not look alphabetical, so the owner should look at the neighbours when adding and follow what the maintainers do there.
- Legend (read from the README): language `📇` TypeScript or JavaScript; scope `🏠` local service, `☁️` cloud service; OS `🍎` macOS, `🪟` Windows, `🐧` Linux; `🎖️` official implementation.
- Most lines carry a Glama score badge before the emojis. CONTRIBUTING does not require it, and some lines have none. x207 now has a Glama listing ([adoption.md](../adoption.md), row 4) and the line carries the badge.
- An automated agent may add `🤖🤖🤖` to the end of the pull request title to be fast-tracked. A human owner does not use it.

## Category

`💰 Finance & Fintech` (heading `### 💰 <a name="finance--fintech"></a>Finance & Fintech`). It already holds x402 servers (for example a server that decodes HTTP 402 challenges). Nothing in the README has a NEAR or clearing category.

## The line

```markdown
- [x207-labs/sdk](https://github.com/x207-labs/sdk) [![x207-labs/sdk MCP server](https://glama.ai/mcp/servers/x207-labs/sdk/badges/score.svg)](https://glama.ai/mcp/servers/x207-labs/sdk) 📇 🏠 - MCP server (`@x207/mcp`) for x207, multilateral netting of x402 agent payments on NEAR testnet: read circle members, limits, epochs and clearing reports, and, with opt-in write tools, pay x402 endpoints with signed vouchers that are netted once per epoch. Testnet only, mock USDT.
```

Notes on the choices:

- `📇 🏠`: the package is TypeScript and runs on the user's machine over stdio. The hosted read-only endpoint (`https://mcp.x207.boxd.sh/mcp`) is a remote server, so it is **not** put in this line; it is a candidate for `awesome-remote-mcp-servers` later ([adoption.md](../adoption.md), row 5).
- No OS emojis: the server was run on macOS and in CI only, and Windows was not tried. Add `🍎` or `🐧` only if the owner has run it there.
- The line is 1 line and 2 sentences, in the style of its neighbours. The word "testnet" is in it on purpose.

## Pull request

Branch: `add-x207-mcp-server`. Commit message: `Add x207 MCP server`.

Title:

```text
Add x207 MCP server (clearing of x402 agent payments, NEAR testnet)
```

Body:

```markdown
Adds one line to **Finance & Fintech**: [x207-labs/sdk](https://github.com/x207-labs/sdk), the MCP server `@x207/mcp`.

What it is: a server for x207, a multilateral netting layer for x402 agent payments on NEAR. Agents in a circle pay each other with signed vouchers backed by a stake; once per epoch the contract nets every position and only the net amounts move in USDT. The server reads a circle (members, limits, epochs, clearing reports) and, only when the user turns the write tools on, joins a circle and pays x402 endpoints.

Scope, stated plainly:
- Runs on NEAR **testnet** (`x207-v013.testnet`). No mainnet transaction has been sent.
- The stake token is a mock USDT that anybody can mint; it has no value.
- No gas saving is claimed; what netting reduces is the value that has to move.
- Write tools are off by default and need explicit environment switches and spending caps.

Why it fits the list: public repository, Apache-2.0, installed and run locally with `npx -y @x207/mcp` over stdio, 14 tools. Listed in the Official MCP Registry as `io.github.x207-labs/x207-mcp`.

- [x] One line, one server, in the right category
- [x] Name linked to the repository
- [x] Glama badge: [x207-labs/sdk on Glama](https://glama.ai/mcp/servers/x207-labs/sdk) (Dockerfile build passes, release 0.0.4)
```

Narrative: since UM-152 the cash saving is attributed to netting, and the PR text says "multilateral netting". Use the same words in every later text.

Before sending, the owner checks one fact in the body: the count of tools (14 names appear in [`sdk/packages/mcp/README.md`](https://github.com/x207-labs/sdk/blob/main/packages/mcp/README.md) and [mcp.md](../mcp.md): `x207_accept_offer`, `x207_circle_overview`, `x207_claim`, `x207_confirm_milestone`, `x207_epoch_report`, `x207_join`, `x207_list_offer`, `x207_make_offer`, `x207_member_inspect`, `x207_order_status`, `x207_pay_request`, `x207_search_listings`, `x207_settle`, `x207_simulate_clearing`).

## Glama listing (UM-154): done on 2026-11-05, steps kept for the record

**State:** the server <https://glama.ai/mcp/servers/x207-labs/sdk> is claimed through `glama.json` in the repository (sdk `38a361e`). The Glama Dockerfile build passes with the build steps `npm ci` for the workspace and `npx tsc -b packages/mcp`, run command `node packages/mcp/dist/cli.js`, release 0.0.4, discovery score 67%. Glama also made an automatic connector listing, <https://glama.ai/mcp/connectors/io.github.x207-labs/x207-mcp> (score A, 3.7 of 5), which is **not claimed** yet. The steps below were written before this and are no longer open, except the claim of the connector listing.

Why: the `awesome-mcp-servers` bot and the maintainers look for a Glama score badge on the line, and Glama only scores a server that has a Dockerfile it can build and a server that answers `tools/list`. Source of the Glama steps: community reports (issues and pull requests of other servers), because Glama has no public page that states the rules; check the Glama admin page if a step differs.

Done by Worker E (nothing to do here): `sdk/Dockerfile` and `sdk/.dockerignore` build `@x207/mcp` from the repository (stdio, read tools only, defaults to `x207-v013.testnet` and `https://x207.boxd.sh`, no key, `X207_MCP_WRITE` not set). Checked on 2026-11-05:

```bash
cd sdk && docker build -t x207-mcp .          # builds, image 98 MB
# initialize, then tools/list over stdin: serverInfo x207 0.0.4, capability tools, 6 tools
# x207_circle_overview, x207_member_inspect, x207_epoch_report, x207_simulate_clearing, x207_search_listings, x207_order_status
```

Steps for the owner, after the sdk repository (with `Dockerfile`) is pushed to `x207-labs/sdk`:

1. Sign in at https://glama.ai with the GitHub account that owns or administers `x207-labs/sdk`.
2. Open https://glama.ai/mcp/servers and use "Add Server" (or search for `x207-labs/sdk`; Glama indexes public GitHub repositories, so the server may already exist). Give the repository URL `https://github.com/x207-labs/sdk`.
3. Claim the server (Glama shows a "Claim" or admin button for the repository owner). Claiming is what unlocks the admin page.
4. On the admin page open the Dockerfile settings. Glama detects a `Dockerfile` in the repository root on the next refetch; if it asks for build steps instead, use: install `npm ci --ignore-scripts`, build `npx tsc -b packages/mcp`, run `node packages/mcp/dist/cli.js`, and set the environment `X207_CIRCLE_CONTRACT=x207-v013.testnet`, `X207_CIRCLE_ID=agents-main`, `X207_BACKEND_URL=https://x207.boxd.sh`. Do not set any key or `X207_MCP_WRITE`.
5. Run the build/introspection check on the admin page. It must show the server starting and answering `initialize` and `tools/list` with 6 tools. If it fails, copy the log into the hand-over note of the coordinator; the local check above passes with the same image.
6. When the listing shows a score, copy its badge markdown (`[![...glama.ai/mcp/servers/.../badge](...)](https://glama.ai/mcp/servers/...)`) and add it to the line in PR #18606, before the `📇 🏠` emojis, as the neighbours do. Then tick the Glama box in the PR body.
7. Optional: Glama can read a `glama.json` in the repository root with `{"$schema": "https://glama.ai/mcp/schemas/server.json", "maintainers": ["<github user>"]}` to name who may claim. It is not created here, because the GitHub user name of the owner is theirs to choose.
