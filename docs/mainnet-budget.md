# Mainnet demo accounts and budget (UM-009)

Status: **not done.** The steps, the amounts per account with their basis (measured on testnet or estimated) and the stop points are in [mainnet-runbook.md](mainnet-runbook.md); `node scripts/mainnet-preflight.mjs` reads the balances and contracts and prints what is missing (views only). Funding and every mainnet transaction are made or confirmed by the owner. No mainnet transaction has been sent from this repo. This file is the template for the spending log.

Accounts are listed in [`.env.example`](../.env.example): the contract account, six agent sub-accounts, and four supporting accounts (keeper, solver, facilitator relayer, DAO member).

## Budget

| Item | Limit |
| --- | --- |
| NEAR (storage deposits, gas, account creation) | about 13.5 NEAR without the DAO, about 20.7 with it (table in [mainnet-runbook.md](mainnet-runbook.md)); the backlog estimated 10–15 |
| USDT | a small nominal amount set by the owner |
| Rehearsals the balance must cover | two |

The NEAR figure is the total of the table in the runbook: storage of the contract and of the DAO, the join deposit of 0.32 NEAR per agent (ADR-41, **not returned** on exit) and gas. Parts are measured on testnet and parts are estimates; the table says which.

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
