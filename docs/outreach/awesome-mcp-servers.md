# punkpeye/awesome-mcp-servers

Source of the rules: [CONTRIBUTING.md](https://github.com/punkpeye/awesome-mcp-servers/blob/main/CONTRIBUTING.md) and the legend of the [README](https://github.com/punkpeye/awesome-mcp-servers/blob/main/README.md), read on 2026-11-05.

## What the rules say

- Scope: a server with a **public GitHub repository that you install and run yourself**. A remote-only server (a hosted URL) belongs in `awesome-remote-mcp-servers`. `@x207/mcp` qualifies: public repository `x207-labs/sdk`, installable with `npx -y @x207/mcp`.
- Edit `README.md` only. One server per line. The line has the server name linked to its repository and a short description.
- Put the line in the right category. CONTRIBUTING asks for **alphabetical order inside a category**. In the current README the Finance & Fintech list does not look alphabetical, so the owner should look at the neighbours when adding and follow what the maintainers do there.
- Legend (read from the README): language `📇` TypeScript or JavaScript; scope `🏠` local service, `☁️` cloud service; OS `🍎` macOS, `🪟` Windows, `🐧` Linux; `🎖️` official implementation.
- Most lines carry a Glama score badge before the emojis. CONTRIBUTING does not require it, and some lines have none. x207 has no Glama listing yet ([adoption.md](../adoption.md), row 4); add the badge after one exists.
- An automated agent may add `🤖🤖🤖` to the end of the pull request title to be fast-tracked. A human owner does not use it.

## Category

`💰 Finance & Fintech` (heading `### 💰 <a name="finance--fintech"></a>Finance & Fintech`). It already holds x402 servers (for example a server that decodes HTTP 402 challenges). Nothing in the README has a NEAR or mutual-credit category.

## The line

```markdown
- [x207-labs/sdk](https://github.com/x207-labs/sdk) 📇 🏠 - MCP server (`@x207/mcp`) for a mutual-credit settlement circle on NEAR testnet: read members, limits, epochs and clearing reports, and, with opt-in write tools, pay x402 endpoints with signed credit vouchers. Testnet only, mock USDT, no mainnet transaction.
```

Notes on the choices:

- `📇 🏠`: the package is TypeScript and runs on the user's machine over stdio. The hosted read-only endpoint (`https://x207-mcp-production.up.railway.app/mcp`) is a remote server, so it is **not** put in this line; it is a candidate for `awesome-remote-mcp-servers` later ([adoption.md](../adoption.md), row 5).
- No OS emojis: the server was run on macOS and in CI only, and Windows was not tried. Add `🍎` or `🐧` only if the owner has run it there.
- The line is 1 line and 2 sentences, in the style of its neighbours. The word "testnet" is in it on purpose.

## Pull request

Branch: `add-x207-mcp-server`. Commit message: `Add x207 MCP server`.

Title:

```text
Add x207 MCP server (NEAR testnet mutual credit for x402 payments)
```

Body:

```markdown
Adds one line to **Finance & Fintech**: [x207-labs/sdk](https://github.com/x207-labs/sdk), the MCP server `@x207/mcp`.

What it is: a server for x207, a mutual-credit settlement layer for x402 agent payments on NEAR. Agents pay each other with signed credit vouchers; once per epoch a solver nets the debt cycles and only the residual moves in USDT. The server reads a circle (members, limits, epochs, clearing reports) and, only when the user turns the write tools on, joins a circle and pays x402 endpoints.

Scope, stated plainly:
- It runs on NEAR **testnet** (`x207-v013.testnet`). No mainnet transaction has been sent.
- The stake token is a mock USDT that anybody can mint; it has no value.
- It does not claim a gas saving.
- Write tools are off by default and need explicit environment switches and spending caps.

Why it fits the list: public repository, Apache-2.0 licence, installable and run locally with `npx -y @x207/mcp` over stdio, 14 tools. It is in the Official MCP Registry as `io.github.x207-labs/x207-mcp`.

Checklist
- [x] One line, one server, in the right category
- [x] Name linked to the repository
- [x] Description checked against the repository
- [ ] Glama badge: not listed on Glama yet; will add when it is
```

Before sending, the owner checks one fact in the body: the count of tools (14 names appear in [`sdk/packages/mcp/README.md`](https://github.com/x207-labs/sdk/blob/main/packages/mcp/README.md) and [mcp.md](../mcp.md): `x207_accept_offer`, `x207_circle_overview`, `x207_claim`, `x207_confirm_milestone`, `x207_epoch_report`, `x207_join`, `x207_list_offer`, `x207_make_offer`, `x207_member_inspect`, `x207_order_status`, `x207_pay_request`, `x207_search_listings`, `x207_settle`, `x207_simulate_clearing`).
