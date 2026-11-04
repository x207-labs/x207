# Keeper operations on testnet

Who moves the epochs of the circle `x207-v013.testnet`, where it runs, and until when.

| | |
| --- | --- |
| What | `scripts/keeper.mjs` in a loop: it calls `close_epoch`, `commit_epoch` and `finalize_epoch` when each is due (the phase comes from `get_epoch`, so a repeated call does nothing twice) |
| Who | The team. The keeper signs with the testnet account `x207-v013-aux.testnet`; its key is only the Railway variable `KEEPER_SECRET_KEY`, never in a repository |
| Where | Railway, project `x207-backend`, environment `production`, service `x207-keeper` (a worker with no public port). The folder that is uploaded is made by `node scripts/railway-keeper-bundle.mjs <out dir>` from `deploy/railway-keeper/` |
| Settings | Variables `KEEPER_RPC_URL` (`https://rpc.testnet.fastnear.com`), `KEEPER_CONTRACT` (`x207-v013.testnet`), `KEEPER_ACCOUNT`, `KEEPER_INTERVAL` (15 s), `KEEPER_LOOKBACK` (10 epochs, enough to catch up after a stop) |
| Until | 2026-11-18, the end of the judging period. Then the service is stopped (`railway down -s x207-keeper`) and the circle goes back to being moved by hand, as in [join-the-circle.md](join-the-circle.md#6-pay-the-residual-before-the-payment-window-ends) |
| Log | Railway log of the service: one JSON line per transaction (`method`, `epoch`, `hash`, `at`), and one line `{"error": …}` per failed pass |
| Cost | A testnet token with no value: about three transactions per epoch of 600 s. `x207-v013-aux.testnet` was topped up to about 5 NEAR on 2026-11-04 for the period; the keeper refuses to send when the balance is below its reserve (`balance_short` in the log) |

What it does not do: it does not run a solver. An epoch whose obligations form a cycle needs `submit_clearing` from a solver inside the proposal window; without one, `commit_epoch` clears nothing and each debtor owes its gross amount as the residual. The epochs of the guide (one obligation) have no cycle, so they need none. Run `npm run testnet:epoch` or a solver (see [competing-solvers.md](competing-solvers.md)) when you want a cleared cycle on the dashboard.

Because the keeper finalizes every epoch at its `payment_deadline`, **a debtor that has not paid by then defaults and is suspended** whether or not a person ran the finalization. Pay the residual inside the payment window (step 6 of the guide).

Stop or restart: `railway service x207-keeper` then `railway down` or `railway redeploy` from the bundle folder. Catch up by hand after a stop: `KEEPER_SECRET_KEY=… node scripts/keeper.mjs --rpc-url https://rpc.testnet.fastnear.com --contract x207-v013.testnet --account x207-v013-aux.testnet --once --lookback 10`.
