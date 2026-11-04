# Use x207 from an AI agent (MCP)

_Moved from the README section 4. The content is unchanged; paths are relative to this folder. Start at the [README](../README.md)._

### Use x207 from an AI agent (MCP)

`@x207/mcp` (in `sdk/packages/mcp`) is an [MCP](https://modelcontextprotocol.io) server: a model such as Claude can read a circle and, when you turn the write tools on, join it, pay for x402 endpoints with credit vouchers, list offers and read the clearing. One command runs a whole scenario on `near-sandbox`, with a script as the MCP client over stdio (same build steps as the sandbox demo, no key of yours):

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
        "X207_BACKEND_URL": "https://x207-backend-production.up.railway.app"
      }
    }
  }
}
```

Then ask: "Give me the overview of the x207 circle", "Inspect the member `x207-demo-buyer.testnet`" or "Report epoch 8". The write tools are off unless you add `X207_MCP_WRITE=1`, the account and its keys, and spending caps (`X207_MAX_SPEND_SESSION`, `X207_MAX_PRICE_PER_CALL`); the table, the guards and the threat review are in [`sdk/packages/mcp/README.md`](https://github.com/x207-labs/sdk/blob/main/packages/mcp/README.md) and [`docs/security-review-batch8b.md`](security-review-batch8b.md).
