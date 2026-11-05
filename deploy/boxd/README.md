# The x207 machine on boxd (UM-148)

One boxd machine, `x207` (2 vCPU, 8 GiB, auto-suspend and auto-hibernate off), runs the three public services of the testnet circle as systemd units. It replaced the Railway services when the Railway trial ended.

| Unit | What | Port | Public URL |
| --- | --- | --- | --- |
| `x207-backend` | read API and indexer of `x207-v013.testnet` (GET only, `X207_READ_ONLY=1`, SQLite in `/var/lib/x207`) | 8080 | https://x207.boxd.sh (default proxy) |
| `x207-mcp` | hosted MCP server, the six read tools (Streamable HTTP) | 3207 | https://mcp.x207.boxd.sh/mcp (proxy `mcp`) |
| `x207-keeper` | `scripts/keeper.mjs` in a loop on the account `x207-v013-aux.testnet` | none | none |

Bot protection of the machine is `off`, because API clients cannot pass the browser check. The files here are the units and the variables of the machine: `backend.env` and `mcp.env` hold public values only; `keeper.env.example` shows the keeper file, whose real copy holds the testnet key and is only on the machine (`/etc/x207/keeper.env`, mode 640).

## Set up (from a laptop with `boxd` logged in)

```bash
boxd machine new x207 --auto-suspend-timeout 0 --auto-hibernate-timeout 0
boxd machine config set x207 bot-protection off
# the folders: backend (npm run build; node backend/scripts/railway-bundle.mjs <dir> <read model sqlite>), mcp (node scripts/railway-mcp-bundle.mjs <dir>), keeper (scripts/keeper.mjs, scripts/lib/keeper.mjs and a sdk/package.json with near-api-js)
boxd machine cp -r <dir> x207:backend   # likewise mcp and keeper; then on the machine: npm install --omit=dev --legacy-peer-deps in each
# units and variables
boxd machine cp backend.env x207:/tmp/backend.env   # likewise mcp.env, keeper.env and the three .service files
boxd machine exec x207 -- 'sudo mkdir -p /etc/x207 /var/lib/x207 && sudo chown boxd /var/lib/x207 && sudo mv /tmp/*.env /etc/x207/ && sudo chown root:boxd /etc/x207/*.env && sudo chmod 640 /etc/x207/*.env && sudo mv /tmp/x207-*.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now x207-backend x207-mcp x207-keeper'
boxd machine proxy set-port --vm x207 --port 8080
boxd machine proxy add mcp --vm x207 --port 3207
```

## Check

```bash
curl https://x207.boxd.sh/healthz
curl -s https://mcp.x207.boxd.sh/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}'
boxd machine exec x207 -- 'sudo journalctl -u x207-keeper -n 20 --no-pager'
```
