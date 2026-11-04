# Mainnet checklist (UM-009, release v0.0.13)

Status: **a tick list for the owner. Nothing in it has run on mainnet.** No mainnet transaction was sent from this repository and no mainnet key exists in it. The steps, the amounts (NEAR and USDT), the gas figures and the hash of the release are in **[mainnet-runbook.md](mainnet-runbook.md)** and only there; the command of each contract step is in [mainnet-deploy-v0.0.13.md](mainnet-deploy-v0.0.13.md); every hash goes in the spending log of [mainnet-budget.md](mainnet-budget.md). Stop at the first line that is not as written.

Before each step: `node scripts/mainnet-preflight.mjs` (views only).

- [ ] Decisions of runbook section 1 written down (account name, parameters, council).
- [ ] 1. Accounts made, funded as in runbook section 2, USDT bought and every holder registered.
- [ ] 2. Release downloaded, sha256 equals the number of runbook section 0 and `SHA256SUMS`.
- [ ] 3. DAO created (**SIGNS**, owner); `get_policy` lists the council.
- [ ] 4. Dry run of the deploy has no `problems`.
- [ ] 5. Deploy and `new` (**SIGNS**, owner, `--execute --yes-owner-approved`); the script's three checks passed.
- [ ] 6. `verify-release.sh` and the preflight say the `code_hash` is the release.
- [ ] 7. Asset classes: the 92 proposals added and voted; `list_asset_classes` checked.
- [ ] 8. Onboarding and the first epoch; the defaulter's stake cut, creditors paid in full.
- [ ] 9. `mainnet-set-params.mjs` dry run clean; proposal added and voted; `get_params` shows the change from the next epoch.
- [ ] 10. Intents and Base (never rehearsed): dry quote answers; at most 8 debtors per `execute_intents`; or recorded as open.
- [ ] 11. Second epoch; hashes of both rounds in the README; `check-window` and `check:pins` run.
- [ ] The owner decided, and wrote in the log, whether to delete the full-access key of the circle account.

Who signs what and the rollback are in runbook sections 5 and 6.
