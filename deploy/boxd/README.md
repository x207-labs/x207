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

## Second circle for EVM agents (BE-093)

The contract 0.0.14 (EVM members) is live on a new circle `x207-v014.testnet` (admission `dao`, owner `x207v8.sputnikv2.testnet`); `x207-v013.testnet` keeps running. Both circles are served from this machine. A second copy of the same backend follows the new circle: same code and folder, its own read model, no seed.

| Unit | What | Port | Public URL |
| --- | --- | --- | --- |
| `x207-backend-v014` | read API and indexer of `x207-v014.testnet` (`X207_NO_SEED=1`, `X207_START_BLOCK=276299160`, the block before the creation of the account; SQLite `/var/lib/x207/x207-v014.sqlite`) | 8081 | https://v014.x207.boxd.sh (proxy `v014`) |
| `x207-backend-v015` | read API and indexer of `x207-v015.testnet` (contract 0.0.15, opt-in auto-settle; `X207_NO_SEED=1`, `X207_START_BLOCK=276314900`; SQLite `/var/lib/x207/x207-v015.sqlite`) | 8082 | https://v015.x207.boxd.sh (proxy `v015`) |
| `x207-backend-v017` | read API and indexer of `x207-v017.testnet` (contract 0.0.17, relayer fee on every EVM action; `X207_NO_SEED=1`, `X207_START_BLOCK=276367650`, a few blocks before its deploy; SQLite `/var/lib/x207/x207-v017.sqlite`). Deployed 2026-11-08 (BE-103) from its own folder `/home/boxd/backend-v017` (a copy of `/home/boxd/backend` with the new `dist` and `vendor/x207-core/dist`, migration 16 = `relayer_fee` in `params`), so the three older units keep their build and are not restarted. | 8083 | https://v017.x207.boxd.sh (proxy `v017`) |
| `x207-backend-v018` | **PREPARED, NOT DEPLOYED** (TODO(boxd): change this when Worker E reports the deploy; P1, contract 0.0.18 on `main`): read API and indexer of `x207-v018.testnet` (contract 0.0.18: `account_escrow_held`, `member_removed`, `GET .../account-escrows`, migration 17 = `account_escrows` and `reputation_resets`, the sign history of #12 through `X207_MPC_CONTRACT_ID`). `X207_START_BLOCK=276797500` in the file is 67 blocks before the deploy of the account (block 276797567, transaction `GFdqKPY9BH7Z83hAZX2ztekGFwv63B5UUmpYhdoC1mG1`). Own folder `/home/boxd/backend-v018` (a copy of `/home/boxd/backend` with the `dist` of branch `p1-0.0.18` and its `vendor/x207-core/dist`), SQLite `/var/lib/x207/x207-v018.sqlite`; the four older units keep their build. Steps are those of v017 with `backend-v018.env`, `x207-backend-v018.service` and `boxd machine proxy add v018 --vm x207 --port 8084`. | 8084 | https://v018.x207.boxd.sh (proxy `v018`; TODO(boxd): live only after Worker E reports it) |
| `x207-keeper-v017` | `scripts/keeper.mjs` on `x207-v017.testnet` with a FUNCTION-CALL key of `x207-v013-aux.testnet` (receiver `x207-v017.testnet`, methods `close_epoch`, `commit_epoch`, `finalize_epoch`, allowance 5 NEAR; public key `ed25519:BGpCBWKeQMjhqSb3KFp7aneaY3FRks2CWBxeAnHVnvhn`); env `/etc/x207/keeper-v017.env` | none | none |
| `x207-keeper-v014` | `scripts/keeper.mjs` on `x207-v014.testnet`, with a second full-access key of `x207-v013-aux.testnet` (the two keepers do not share a nonce) | none | none |

Member ids that start with `0x` (EVM agents) appear in the same endpoints as any member (`/x207/circles/agents-main/members/0x…`); their `pubkeyVoucher` is a placeholder key, because the contract checks their EIP-712 signature against the address.

```bash
# the deploy block is in backend-v014.env (X207_START_BLOCK); copy backend/deploy/railway/start.sh to /home/boxd/backend/start.sh first (it knows X207_NO_SEED), then
boxd machine cp backend-v014.env x207:/tmp/backend-v014.env
boxd machine cp x207-backend-v014.service x207:/tmp/x207-backend-v014.service
boxd machine exec x207 -- 'sudo mv /tmp/backend-v014.env /etc/x207/ && sudo chown root:boxd /etc/x207/backend-v014.env && sudo chmod 640 /etc/x207/backend-v014.env && sudo mv /tmp/x207-backend-v014.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now x207-backend-v014'
boxd machine proxy add v014 --vm x207 --port 8081
curl https://v014.x207.boxd.sh/healthz
```

To add `x207-backend-v017` (after the new backend build is on the machine; the other units keep running): the same four steps as for v014 with `backend-v017.env`, `x207-backend-v017.service`, then `boxd machine proxy add v017 --vm x207 --port 8083` and `curl https://v017.x207.boxd.sh/healthz`. `GET /x207/circles/agents-main/params` then shows `relayer_fee` in `active`, and `GET /x207/circles/agents-main/events?event=relayer_fee_paid,relayer_fee_failed` lists the fee events. The keeper of v017 needs no full-access key: a function-call key limited to the three keeper methods is enough (`keeper-v017.env.example`; the key is made with `near account add-key x207-v013-aux.testnet grant-function-call-access --allowance '5 NEAR' --contract-account-id x207-v017.testnet --function-names 'close_epoch,commit_epoch,finalize_epoch' …`). A keeper that also prunes (`--prune-lag`) would need `prune_epoch` in the list.

Audit fixes BE-104..108 are on the machine since 2026-11-08 09:10 UTC (the same `dist` in `/home/boxd/backend` and `/home/boxd/backend-v017`; the keepers run the new `scripts/keeper.mjs` and `scripts/lib/keeper.mjs`). Root `/metrics` is closed (401: no `METRICS_TOKEN`, no `X207_METRICS_OPEN`); `epochs/{n}/metrics` of the dashboard is open. Read-only is the default of the build and the env files keep `X207_READ_ONLY=1`. The way back is in `/home/boxd/backup-20261108/` (`backend-dist`, `backend-v017-dist`, `keeper-scripts`, and a `sqlite3 .backup` of the four read models: migration 16 now also applies to the v013 to v015 databases, so go back to the old `dist` together with the old `.sqlite` copies, not alone), and `dist.prev` next to each `dist`.

The facilitator with the relayer routes `/evm/*` (SD-089) is a separate process that is not on this machine yet; see `sdk/.env.example` for `X207_EVM_RELAYER_ACCOUNT_ID` and the other variables.

Note: `boxd machine cp -r <dir> x207:<target>/vendor` makes `<target>/vendor/vendor` when `<target>/vendor` does not exist yet; copy to `<target>` and check the result. Both backends read the free neardata plan (30 blocks per minute for the machine), so two instances catch up more slowly than one.

The hosted MCP (UM-178) runs the package from the npm registry, no longer the vendored bundle: in `/home/boxd/mcp`, `npm install --omit=dev --legacy-peer-deps @x207/mcp@<version>` and the unit starts `node_modules/@x207/mcp/dist/cli.js`. To update, install the new version and `sudo systemctl restart x207-mcp`; check `initialize` (`serverInfo.version`) and `tools/list`. The old `vendor/` folder and `package.json.bak` stay on the machine as a way back (point `ExecStart` to `vendor/x207-mcp/dist/cli.js` again). On 2026-11-05 the machine runs 0.0.6.

Three indexers on one IP share the neardata limit of 30 blocks a minute, so every backend env sets `X207_INDEXER_POLL_MS=8000`. Since BE-098 the three backends do not call neardata themselves: `x207-neardata-cache` (`neardata-cache.mjs`, 127.0.0.1:8099, unit `x207-neardata-cache.service`, file at `/home/boxd/neardata-cache.mjs`) is the only reader. It keeps final blocks (fetched once per height), shares one `last_block/final` answer for 5 s, and spaces its upstream calls by 2.1 s (under 30 a minute for the whole machine). Every backend env has `X207_NEARDATA_URL=http://127.0.0.1:8099`. Check it with `curl localhost:8099/healthz` on the machine (`hits`, `upstream`, `errors`). If it dies, `Restart=always` brings it back; to bypass it, set `X207_NEARDATA_URL=https://testnet.neardata.xyz` again. The keepers use `KEEPER_RPC_URL=https://near-testnet.drpc.org,https://rpc.testnet.fastnear.com` (failover).
