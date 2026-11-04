# Demo run: one command, stages, and the external interfaces seen (UM-032)

**One command.** `npm run demo:quick` runs one epoch of six agents in a local `near-sandbox` with no account: joins and stakes (F1), paid calls (F2), clearing with the 207 report (F3), residual payments, `finalize_epoch` and claims (F4). The README has the command ([Run it locally](../README.md#run-it-locally-5-minutes)). The log prints the hash and the duration of every transaction and the duration of every stage; the run and its numbers are in [sandbox-demo.md](sandbox-demo.md). The same flow on a real network is `npm run demo:testnet` (it only prints the plan unless `X207_CONFIRM_REAL_TX=yes`); it ran a full epoch on testnet on 2026-11-03 and recorded every hash in [testnet-demo.json](testnet-demo.json). The mainnet variant `npm run demo:mainnet` has **not** been run, and the test case for it is a manual one that needs the owner.

## External interfaces of the Level 0 diagram, and where each one was seen

| Interface | Seen in | Evidence |
| --- | --- | --- |
| E1 buyer agent | `demo:quick`, `demo:testnet` | paid calls with `PAYMENT-SIGNATURE`; vouchers registered by the relayer ([testnet-demo.json](testnet-demo.json), steps `relayer.register`) |
| E2 seller (402) / reader of the report | `demo:quick`, `demo:testnet` | the 402 answers and the HTTP 207 report per member ([sandbox-demo.md](sandbox-demo.md)) |
| E3 owner of an agent (stake) | `demo:quick`, `demo:testnet` | `join` and stake of six agents; steps `<agent>.usdt` in [testnet-demo.json](testnet-demo.json) |
| E4 solver | `demo:quick`, `demo:testnet` | `submit_clearing` (and `commit_bundle` for the barter ring) in the same record |
| E5 DAO | `demo:testnet` with `DEMO_DAO_ACCOUNT`; live circle | steps `dao.add_proposal` and `dao.vote.*` in [testnet-demo.json](testnet-demo.json); the live proposal in [governance-live.md](governance-live.md) |
| E6 NEAR Intents and 1Click | **not in the demo log.** Seen apart from it: a live 1Click dry quote asked by a member of `x207-v013.testnet` on 2026-11-04, and the residual of three debtors in one `execute_intents` against the real Intents contract in `near-sandbox` | [what-has-run.md](what-has-run.md) (rows 1Click quote and BE-034). No Intents transaction has run on testnet or mainnet, because `intents.testnet` has no code |

So five of the six interfaces appear in the demo's own log, and E6 appears only through the two runs above. The checklist item for E6 stays open for a mainnet run (UM-027, UM-035), which is not done.
