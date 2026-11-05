# Keeper operations on testnet

Who moves the epochs of the circle `x207-v013.testnet`, where it runs, and until when.

| | |
| --- | --- |
| What | `scripts/keeper.mjs` in a loop: it calls `close_epoch`, `commit_epoch` and `finalize_epoch` when each is due (the phase comes from `get_epoch`, so a repeated call does nothing twice) |
| Who | The team. The keeper signs with the testnet account `x207-v013-aux.testnet`; its key is only in `/etc/x207/keeper.env` on the machine (mode 640), never in a repository |
| Where | The boxd machine `x207`, systemd unit `x207-keeper` (no public port); the machine also runs the read API and the MCP server. Files in [deploy/boxd/](../deploy/boxd/README.md) |
| Settings | Variables in that file: `KEEPER_RPC_URL` (`https://rpc.testnet.fastnear.com`), `KEEPER_CONTRACT` (`x207-v013.testnet`), `KEEPER_ACCOUNT`, `KEEPER_INTERVAL` (15 s), `KEEPER_LOOKBACK` (10 epochs, enough to catch up after a stop) |
| Until | 2026-11-18, the end of the judging period. Then the service is stopped (`sudo systemctl disable --now x207-keeper` on the machine) and the circle goes back to being moved by hand, as in [join-the-circle.md](join-the-circle.md#6-pay-the-residual-before-the-payment-window-ends) |
| Log | `boxd machine exec x207 -- 'sudo journalctl -u x207-keeper -n 20 --no-pager'`: one JSON line per transaction (`method`, `epoch`, `hash`, `at`), and one line `{"error": …}` per failed pass |
| Cost | A testnet token with no value: about three transactions per epoch of 600 s. `x207-v013-aux.testnet` was topped up to about 5 NEAR on 2026-11-04 for the period; the keeper refuses to send when the balance is below its reserve (`balance_short` in the log) |

What it does not do: it does not run a solver. An epoch whose obligations form a cycle needs `submit_clearing` from a solver inside the proposal window; without one, `commit_epoch` clears nothing (cleared total 0). A debtor still owes only its net position of the epoch (what it owes minus what it is owed), because the contract computes `due` from those totals and clearing does not change them (`commit_epoch` in `contracts/x207-circle/src/commit.rs`: "Net positions do not change by clearing"). Clearing changes the cleared total and the fees, not who pays what. The epochs of the guide (one obligation) have no cycle, so they need none. Run `npm run testnet:epoch` or a solver (see [competing-solvers.md](competing-solvers.md)) when you want a cleared cycle on the dashboard.

Because the keeper finalizes every epoch at its `payment_deadline`, **a debtor that has not paid by then defaults and is suspended** whether or not a person ran the finalization. Pay the residual inside the payment window (step 6 of the guide).

## Monitoring (UM-151)

The workflow [.github/workflows/monitor.yml](../.github/workflows/monitor.yml) runs `scripts/monitor-check.mjs` every 15 minutes on GitHub Actions (free, no secrets). It checks three things and, if any fails, opens one issue labelled `monitor` in this repository (later failures add a comment; the first green run closes the issue):

| Check | Passes when |
| --- | --- |
| Read API | `GET https://x207.boxd.sh/healthz` answers HTTP 200 and `db.ok` is true. The `status` `degraded` that the endpoint shows while the indexer is idle is not a failure |
| Hosted MCP | `initialize` on `https://mcp.x207.boxd.sh/mcp` answers a `serverInfo.name` |
| Keeper heartbeat | The newest finalized epoch of `x207-v013.testnet` (read straight from NEAR RPC, so it does not depend on the machine) has a `payment_deadline` at most **2 × epoch_length + payment_window = 2 × 600 + 900 = 2100 s** ago. In normal running the keeper finalizes right after each `payment_deadline`, so the age stays under about 650 s; above 2100 s at least two epochs were missed |

Each check retries three times, 5 s apart, before it counts as failed. Run it by hand with `node scripts/monitor-check.mjs` (exit code 1 on failure), or from the Actions tab with "Run workflow". GitHub pauses scheduled workflows in a repository after 60 days without activity; the circle is only needed until 2026-11-18, so this does not matter.

When the heartbeat fails but the API and MCP pass, only the keeper is down: read its log (below), restart it, and catch up by hand if needed (last line of this page). When all three fail, the machine is down: use the plan below.

## Backup and restore

Two copies of the machine exist, taken on 2026-11-05 (UM-151):

- A **disk backup every 24 h**, kept 7 days (`boxd machine config set x207 backups.period 24h`, `backups.retention 7d`). List: `boxd machine backup list x207`. Take one now: `boxd machine backup now x207`. `boxd machine backup restore` puts a backup back **in place** and overwrites the current disk, so use it only when the machine runs but its disk is damaged.
- A **snapshot** `x207-backup` (memory and disk, 11.8 GiB, version 1). Take a new one before a risky change: `boxd snapshots save x207 x207-backup`.

If the machine is lost, make a new one from the snapshot (tested on 2026-11-05: a machine made this way came up with `x207-backend`, `x207-mcp` and `x207-keeper` all active in a few seconds):

```bash
boxd machine new x207 --from-snapshot x207-backup   # remove the dead machine of that name first: boxd machine remove x207 --confirm
boxd machine config set x207 bot-protection off
boxd machine config set x207 auto-suspend.timeout 0
boxd machine config set x207 auto-hibernate.timeout 0
boxd machine proxy set-port --vm x207 --port 8080
boxd machine proxy add mcp --vm x207 --port 3207
boxd machine exec x207 -- 'sudo systemctl restart x207-backend x207-mcp x207-keeper'
node scripts/monitor-check.mjs
```

A machine that is not named `x207` gets another URL (`<name>.boxd.sh`); then the URLs in the READMEs, `server.json` and the Vercel variable `VITE_X207_API_URL` must change. If the snapshot is gone too, rebuild from [deploy/boxd/](../deploy/boxd/README.md) (about 20 minutes): the keeper key is in `.secrets/` on the owner's laptop, and the read model is rebuilt by the indexer from the chain (a few hours at 30 blocks a minute, see the neardata limit in the backend README). While the keeper is down the circle stops moving: epochs do not close, and no one defaults, because `finalize_epoch` has not run. Run `scripts/keeper.mjs --once --lookback 10` from a laptop to catch up (last line of this page).

Two things to keep in mind: a snapshot made from the running machine also holds the keeper's memory, and two keepers at once are harmless (every call checks the phase first), but do not leave a test copy running. The balance is about $1 a day of the $30 credit; check it with `boxd manage billing activity`.

Stop or restart: `boxd machine exec x207 -- 'sudo systemctl restart x207-keeper'`. Catch up by hand after a stop: `KEEPER_SECRET_KEY=… node scripts/keeper.mjs --rpc-url https://rpc.testnet.fastnear.com --contract x207-v013.testnet --account x207-v013-aux.testnet --once --lookback 10`.
