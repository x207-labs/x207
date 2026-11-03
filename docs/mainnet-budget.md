# Mainnet demo accounts and budget (UM-009)

Status: **not done.** The steps, the amounts per account with their basis (measured on testnet or estimated) and the stop points are in [mainnet-runbook.md](mainnet-runbook.md); `node scripts/mainnet-preflight.mjs` reads the balances and contracts and prints what is missing (views only). Funding and every mainnet transaction are made or confirmed by the owner. No mainnet transaction has been sent from this repo. This file is the template for the spending log.

Accounts are listed in [`.env.example`](../.env.example): the contract account, six agent sub-accounts, and four supporting accounts (keeper, solver, facilitator relayer, DAO member).

## Budget

| Item | Limit |
| --- | --- |
| NEAR (storage deposits, gas, account creation) | about 10–15 NEAR in total |
| USDT | a small nominal amount set by the owner |
| Rehearsals the balance must cover | two |

The NEAR figure comes from the research report estimate, mostly refundable storage deposits. It is an estimate, not a measured cost.

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
