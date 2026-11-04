# Mainnet demo accounts and budget (UM-009)

Status: **not done.** The steps, the amounts and the stop points are in [mainnet-runbook.md](mainnet-runbook.md); `node scripts/mainnet-preflight.mjs` reads the balances and contracts and prints what is missing (views only). Funding and every mainnet transaction are made or confirmed by the owner. No mainnet transaction has been sent from this repo. This file is the template for the spending log.

Accounts are listed in [`.env.example`](../.env.example): the contract account, six agent sub-accounts, and four supporting accounts (keeper, solver, facilitator relayer, DAO member).

## Budget

The amounts per account, the total (about 16.3 NEAR with the DAO, 20 USDT) and their basis are in section 2 of [mainnet-runbook.md](mainnet-runbook.md); this file holds only the log, so that no figure is written twice. Two rehearsals must be covered by the balance.

## Spending log

Filled by the owner or confirmed by the owner. One row per funding transaction.

| Date | Account | Purpose | Amount | Transaction hash | Signed by |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

| Total so far | NEAR | USDT |
| --- | --- | --- |
| | | |

## Open

- Account names for keeper, solver, relayer, and DAO member.
- USDT amount per account.
- Balance check of every account against the two rehearsals (TC-UM-009-02).
