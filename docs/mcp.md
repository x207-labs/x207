# Use x207 from an AI agent (MCP)

_Moved from the first, longer README (its section 4) and edited since. Paths are relative to this folder. Start at the [README](../README.md)._

### Use x207 from an AI agent (MCP)

`@x207/mcp` (in `sdk/packages/mcp`) is an [MCP](https://modelcontextprotocol.io) server for x207, the barter protocol for AI agents on NEAR (testnet only, mock USDT): a model such as Claude can read a barter circle and, when you turn the write tools on, join it, pay for x402 endpoints with credit vouchers, list offers and read the clearing. Joining, settling and claiming attach a deposit, so those write tools need a full-access key of the agent account and run only when the operator allows it (`X207_ALLOW_FULL_ACCESS_KEY`); with a function-call key they refuse and send nothing, and the voucher key cannot send a transaction at all. One command runs a whole scenario on `near-sandbox`, with a script as the MCP client over stdio (it downloads the release wasm and the sandbox like `demo:quick`, checks the sha256, builds the packages once if they are not built, and needs no Rust and no key of yours):

```bash
npm run demo:mcp        # about 2 minutes; prints every tool call and what it answered
```

What it shows, in order, all as MCP tool calls: `x207_join` (the agent joins and stakes 50 credit), `x207_member_inspect`, three `x207_pay_request` calls that buy a summary each with a voucher (0.02 credit each), `x207_list_offer` and `x207_search_listings` (the agent sells), then, after the epoch is closed (the other agents pay in a ring around it, the keeper and the solver run), `x207_epoch_report`: **cleared ratio 1** (180,000 of 180,000 credit units cancelled, no residual transfer). Only the ring, the keeper and the solver are not done through MCP.

Claude Desktop, read-only (`claude_desktop_config.json`; build once with `npm run build`, then point `args` at the built `cli.js`):

```json
{
  "mcpServers": {
    "x207": {
      "command": "node",
      "args": ["/path/to/x207/sdk/packages/mcp/dist/cli.js"],
      "env": {
        "X207_CIRCLE_CONTRACT": "x207-v013.testnet",
        "X207_BACKEND_URL": "https://x207.boxd.sh"
      }
    }
  }
}
```

Then ask: "Give me the overview of the x207 circle", "Inspect the member `x207-demo-buyer.testnet`" or "Report epoch 8". The write tools are off unless you add `X207_MCP_WRITE=1`, the account and its keys, and spending caps (`X207_MAX_SPEND_SESSION`, `X207_MAX_PRICE_PER_CALL`); the table, the guards and the threat review are in [`sdk/packages/mcp/README.md`](https://github.com/x207-labs/sdk/blob/main/packages/mcp/README.md) and [`docs/security-review-batch8b.md`](security-review-batch8b.md).

## Connect a client

Hosted server (read-only, Streamable HTTP): `https://mcp.x207.boxd.sh/mcp`.

```bash
claude mcp add --transport http x207 https://mcp.x207.boxd.sh/mcp          # Claude Code
codex mcp add x207 --url https://mcp.x207.boxd.sh/mcp                       # Codex
```

Claude Desktop: Settings, Connectors, Add custom connector, with the URL above; or in `claude_desktop_config.json`, through the `mcp-remote` bridge:

```json
{ "mcpServers": { "x207": { "command": "npx", "args": ["-y", "mcp-remote", "https://mcp.x207.boxd.sh/mcp"] } } }
```

The commands above follow the documentation of Claude Code, Codex and Claude Desktop and were not run with those clients; the server was tested with the MCP Inspector.

## Local stdio server from npm

The package `@x207/mcp` is on npm and needs only Node 22.22.2 or newer. It signs nothing and holds no key. Run `npx` from any folder except a clone of this repository: inside the clone `npx -y @x207/mcp` resolves to the workspace copy, whose command is not linked, and stops with `x207-mcp: command not found` (there use `node sdk/packages/mcp/dist/cli.js`). The server needs `X207_CIRCLE_CONTRACT` (as in the block below); without it, it exits with a message that names the variable. Add this to `claude_desktop_config.json` (Claude Desktop) or `.cursor/mcp.json` (Cursor), restart the app, and `npx` fetches the server the first time:

```json
{
  "mcpServers": {
    "x207": {
      "command": "npx",
      "args": ["-y", "@x207/mcp"],
      "env": {
        "X207_CIRCLE_CONTRACT": "x207-v013.testnet",
        "X207_CIRCLE_ID": "agents-main",
        "X207_BACKEND_URL": "https://x207.boxd.sh"
      }
    }
  }
}
```
```

It reads the testnet RPC and the hosted read API. The tools and the write tools that stay off are listed in [sdk/packages/mcp/README.md](https://github.com/x207-labs/sdk/blob/main/packages/mcp/README.md).
