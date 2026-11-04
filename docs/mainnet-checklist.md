# Mainnet checklist (UM-009, interface 0.0.12)

> For the release **v0.0.13** use [mainnet-deploy-v0.0.13.md](mainnet-deploy-v0.0.13.md) (CT-049): one command per step, dry run by default, pinned sha256, cost per account. Below, `--dry-run` is now the default and sending needs `--execute`.

Status: **a checklist for the owner. Nothing in it has run on mainnet.** No mainnet transaction was sent from this repository, no mainnet key exists here, and the testnet keys in `.secrets/` are never used on mainnet. [mainnet-runbook.md](mainnet-runbook.md) has the full plan and the rehearsals; this file is the short list for the day of the deploy, with the amounts updated for the join deposit of 0.35 NEAR (ADR-41) and the wasm of 0.0.12.

## 1. NEAR the owner must have

| Account | What it pays | NEAR | Basis |
| --- | --- | --- | --- |
| Circle contract account | storage of the code (the release wasm of 0.0.12 is about 656 KB: 6.6 NEAR locked) and of the state, gas of its own calls | 9.0 | *measured* size of the 0.0.12 build; 592 KB for `v0.0.11`. The script refuses an account with less than 8 NEAR. |
| Owner account, to create the Sputnik DAO | factory deposit 7 NEAR plus gas | 7.2 | *measured* on testnet (`contracts/dao/lib.mjs`, `FACTORY_DEPOSIT`) |
| Six agents | `join` deposit **0.35 NEAR each, not returned** (ADR-41) plus gas | 0.5 each, 3.0 | `JOIN_STORAGE_DEPOSIT` of 0.0.12 |
| Keeper, solver | `close_epoch`, `commit_epoch`, `finalize_epoch`, `submit_clearing` | 0.5 each, 1.0 | *measured* below 0.05 NEAR per epoch |
| Facilitator relayer | `register_cumulative` | 1.5 (0.5 without a gas key) | *estimate* |
| DAO council, 2 or 3 accounts | bond 0.1 NEAR per proposal, gas | 0.5 each, 1.5 | Sputnik default bond |
| USDT storage on `usdt.tether-token.near` | `storage_deposit` of each holder (six agents and the circle account) | 0.01 | *measured* 0.00125 NEAR each |
| **Total with the DAO** | | **about 23.2** | 20.7 in the runbook before 0.35 NEAR and 0.0.12 |
| **Total without the DAO** | | **about 16.0** | not allowed by `deploy-mainnet.mjs`: the owner must be a DAO |

USDT: stake 2 USDT per agent and 1 USDT spare each (18 USDT for the first rehearsal), *estimate*, a small nominal amount that the owner sets.

## 2. Steps in order

Before each step run `node scripts/mainnet-preflight.mjs` (views only). After each step write the hash in the spending log of [mainnet-budget.md](mainnet-budget.md). **Stop** at the first thing that is not as written.

1. **Accounts and funds (owner).** Choose the names, make the keys with `near` on the owner's own machine, fund the accounts of section 1, register the USDT holders. Keys never enter this repository.
2. **The release.** `gh release download v0.0.12 -R x207-labs/contracts`; `shasum -a 256 x207-circle-v0.0.12.wasm` must equal the line in `SHA256SUMS`; the release is the reproducible build (`scripts/verify-release.sh`). *Stop* if they differ.
3. **The DAO (owner).** `node contracts/dao/create-dao.mjs --name x207 --council a.near,b.near,c.near --signer owner.near --network mainnet` prints a `near-cli-rs` command; the owner reads it and runs it.
4. **Dry run of the deploy (anybody, reads only).**
   ```bash
   node scripts/deploy-mainnet.mjs --network mainnet --circle <circle>.near --owner <dao>.sputnik-dao.near --release v0.0.12 --dry-run
   ```
   It downloads the release, compares the sha256 with `SHA256SUMS`, and by views checks that the owner is a Sputnik DAO, that `usdt.tether-token.near` has 6 decimals, that `intents.near` has code, and that the circle account exists with at least 8 NEAR and no other code. It prints the `new` arguments (explicit `params`; pass `--params-file` to change them). *Stop* on any `problems`.
5. **The deploy (owner).**
   ```bash
   node scripts/deploy-mainnet.mjs --network mainnet --circle <circle>.near --owner <dao>.sputnik-dao.near --release v0.0.12 \
        --keys-dir <owner keys folder, with a mainnet/ subfolder> --out docs/mainnet-deploy.json --yes-owner-approved
   ```
   The script reads `<keys-dir>/mainnet/<circle>.json`, deploys, calls `new`, and then checks on chain: the `code_hash` equals the base58 of the release sha256, `interface_version` is `0.0.12`, `get_owner` is the DAO. It exits 1 and says so if one differs. *Stop* then: do not use the contract.
6. **Register the asset catalog** (`scripts/register-asset-classes.mjs`): `set_asset_class` is owner only, so on mainnet each entry is a DAO proposal.
7. **Onboarding, one epoch, the DAO proposal, the second rehearsal** (steps 3 to 7 of the runbook).

## 3. Who signs

| Action | Signer |
| --- | --- |
| Funding, keys, account names, the USDT, the 1Click token | the owner |
| Create the DAO | the owner (a council member signs the proposals afterwards) |
| Deploy and `new` | the key of the circle account, held by the owner, with `--yes-owner-approved` |
| `set_params`, `set_asset_class`, `set_asset_contracts`, `propose_freeze`, `propose_upgrade`, `apply_upgrade` | the DAO (council votes; two votes pass on testnet) |
| `close_epoch`, `commit_epoch`, `finalize_epoch`, `apply_freeze`, `settle_deal`, `prune_epoch` | anybody (the keeper account in practice) |
| Joining, staking, vouchers, deals | each agent with its own key |

The owner decides, and writes in the log, whether to delete the full-access key of the circle account after step 5: with the DAO as `owner_id`, code changes go through `propose_upgrade` and `apply_upgrade` (timelock), which need no key of the account.

## 4. Rollback

- **Before `new` ran:** the account only holds code. The owner deletes the account (`DeleteAccount`, beneficiary the owner) and starts again with another name; the locked NEAR returns.
- **After `new`, nothing in use:** `owner_id` cannot be changed (it is set at `new`). A circle with a wrong owner, version or `code_hash` is not repaired: delete the account as above and deploy again. The script stops at the check, so no member has joined yet.
- **In use, a code change:** only forward, by the DAO: `propose_upgrade` with the sha256 of the new wasm, the timelock, then `apply_upgrade`. A rollback to an older release is **not** safe once 0.0.12 state exists: open deals hold bonds (`bond_locked`) that 0.0.11 does not know. The test `ct094_upgrade_from_0_0_11` proves the way forward only.
- **A freeze** is lifted by `unfreeze_member` (the DAO); no money moves by a freeze.
- **Money:** stakes can be withdrawn by `request_exit` and `withdraw_stake` when no bond is locked; the join deposit is not returned.

## 5. What was rehearsed

The script ran on testnet with the real release wasm of `v0.0.11` (sha256 `a9d0c839…2f39`): circle `x207-dep-r1.testnet`, owner the Sputnik DAO `x207v8.sputnikv2.testnet`, `docs/testnet-deploy-script.json` has the hashes of the deploy and of `new`. A council member (`b.x207-dao-v8.testnet`) as owner is refused (`get_policy` fails). `scripts/deploy-mainnet.test.mjs` checks the guards without a network (refusal without `--yes-owner-approved`, real USDT and Intents on mainnet, testnet keys folder refused, sha256 from `SHA256SUMS`). A mainnet dry run was **not** run.
