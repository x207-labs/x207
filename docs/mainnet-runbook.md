# Mainnet runbook for x207-circle (v0.0.13 tagged, v0.0.15 current) (UM-009, UM-026, UM-027, UM-028, UM-029, CT-049, CT-050, UM-040, UM-169)

**UM-169 update (2026-11-05): which release goes to mainnet is an owner decision (section 0a), and section 12 has the exact command order with a testnet check of each command.** Sections 1 to 10 were written for v0.0.13; where v0.0.15 differs, section 0a and section 12 say so and win.

Status: **a plan for the owner. Nothing in it has been run on mainnet.** No mainnet transaction was sent from this repository, no mainnet key exists in it, and none may be sent without the owner: funding, keys and signatures are the owner's. The testnet keys in `.secrets/` are never used on mainnet.

This is the one document to follow. The other three are parts of it: [mainnet-deploy-v0.0.13.md](mainnet-deploy-v0.0.13.md) is the command reference of the contract steps, [mainnet-checklist.md](mainnet-checklist.md) is the tick list for the day, [mainnet-budget.md](mainnet-budget.md) is the spending log. **Every number (NEAR, USDT, gas, the hash) is in this file and nowhere else**; the others point here. A figure marked *measured* comes from a testnet or sandbox run (storage and gas prices are the same on mainnet); *estimate* is a plan figure.

## 0. The release, and what the scripts cover

| | |
| --- | --- |
| Tag | `v0.0.13` of `x207-labs/contracts`, interface 0.0.13 |
| wasm sha256 | `b9327f2b5d64b1180ba76dd619c6091ae57b48964f520a784e366c131e787054` (pinned in `scripts/deploy-mainnet.mjs`, `KNOWN_SHA256`) |
| `code_hash` on chain (base58) | `DTw5rUUdJSbWjD361MmBxKW4nm4ETnNkex63mfUCjsjh` (the same bytes) |
| Size | 682,707 bytes, 6.83 NEAR of storage locked |
| Join deposit | 0.35 NEAR per member, **not returned** (`JOIN_STORAGE_DEPOSIT`) |

| Covered by `npm run demo:mainnet` (`demo/network.demo.ts`; the same script ran a full epoch on testnet) | Never run on any network, or only in the sandbox |
| --- | --- |
| join and stake with the real USDT, paid calls, clearing and the 207 report, residual payment and `claim` to a NEAR account, a debtor that does not pay (`DEMO_DEFAULT`), the barter ring (`DEMO_BARTER=yes`), a `set_params` proposal through a Sputnik DAO (`DEMO_DAO_*`) | The route through NEAR Intents and the withdrawal to USDC on Base through 1Click. The residual of three debtors in one `execute_intents` ran against the wasm of the real `intents.near` in `near-sandbox` (`tests/residual-batch.sandbox.test.ts`); no network has run it, and `intents.testnet` has no code |

Set `DEMO_MINT_USDT` to nothing on mainnet: it is for the mock token of testnet. The mainnet token is `usdt.tether-token.near`.

## 0a. Which release: v0.0.13 or v0.0.15 (owner decision, UM-169)

| | v0.0.13 (tagged, pinned) | v0.0.15 (current `contracts` HEAD, no tag yet) |
| --- | --- | --- |
| Interface | 0.0.13 | 0.0.15: EVM agents (`join_evm`, `claim_evm`, ...), `auto_settle` (CT-108), `set_auto_settle` needs 1 yocto |
| Wasm | 682,707 bytes, sha256 `b9327f2b…7054` | 721,250 bytes, sha256 `f832e53f…` (reproducible build, file `contracts/prebuilt/x207_circle-0.0.15.wasm`, base58 code_hash `Hhs82yW5…`; full values in `contracts/prebuilt/README.md`) |
| Reproducible | yes (release asset, `verify-release.sh`) | yes: the prebuilt file is the output of `contracts/scripts/repro-build.sh` (CT-111) and is what `x207-v015.testnet` runs |
| On testnet | `x207-v013.testnet` | `x207-v015.testnet` (deployed 2026-11-05) |
| Pin in `scripts/deploy-mainnet.mjs` | `KNOWN_SHA256["v0.0.13"]` | `KNOWN_SHA256["v0.0.15"]` = `f832e53f…` (CT-111) |

Recommendation: go live with v0.0.15 only after (1) the coordinator tags `v0.0.15`, (2) the release wasm comes from the reproducible build, (3) its sha256 is added to `KNOWN_SHA256` or passed with `--expect-sha256`. Until then the commands below use `--wasm`. If the owner prefers the tested-on-mainnet-rehearsal path, v0.0.13 still works with every step as written, but has no EVM agents and no auto-settle. Cost difference: +38,245 bytes of code, +0.38 NEAR of locked storage.

## 1. Decisions for the owner

| # | Decision | Recommendation |
| --- | --- | --- |
| 1 | Contract account name | `x207-circle.near` is what `.env.example` assumes; `.env.mainnet.example` lists the variables of the preflight (copy to `.env.mainnet`, ignored by git). *Not verified:* how a top-level `<name>.near` is created and what it costs (the name was unused at block 222,830,048). A sub-account of an account the owner has, such as `x207-circle.<owner>.near`, needs no registrar. The six agents are sub-accounts of the contract account |
| 2 | Sputnik DAO | **Yes.** `deploy-mainnet.mjs` refuses an owner that is not a DAO, and `owner_id` is fixed at `new` |
| 3 | Parameters at `new` | `epoch_length` 600, `payment_window` 900, `proposal_window` 60, `base_limit_ratio` 8000, `limit_growth` 1000, `limit_cap` "1000000000", `limit_decay` 0, no fees, `admission` "open" (`DEFAULT_PARAMS` of the script, tested on testnet; `--params-file` for others). A rehearsal then takes about 50 minutes instead of two hours |
| 4 | USDT | 20 USDT in all (section 2) |
| 5 | 1Click | The owner requests a JWT (`ONECLICK_JWT` in `.env`) for the dry quote and the withdrawal; only step 9 needs it |
| 6 | DAO council | Two or three accounts of the owner with separate keys; two votes pass a proposal on testnet |

## 2. Money: one table

NEAR, funded by the owner. "Fund" is the recommended amount (`node scripts/mainnet-costs.mjs --wasm x207-circle-v0.0.13.wasm` prints the first four rows).

| Account | What it pays | Minimum | Fund | Basis |
| --- | --- | ---: | ---: | --- |
| Circle contract | storage of the code (6.83) and of `new` and the asset catalog (about 0.37), gas of its own calls | 8.0 | 8.2 | *measured* size of v0.0.13; the deploy script refuses an account below 8 NEAR |
| Owner, to create the DAO | factory deposit plus gas (300 Tgas prepaid, a few hundredths of a NEAR burnt); what is attached stays in the DAO account. Mainnet DAOs now use the global DAO code, so a new one holds about 0.09 NEAR (section 9); the 7 NEAR of `FACTORY_DEPOSIT` in `contracts/dao/lib.mjs` was measured on the testnet factory, which deploys the whole code | 1.2 | 1.5 | *views of 2026-11-04*, section 9; a `create` that is refused for a small deposit fails and returns it, so raise it to 7.5 only if the factory says `ERR_NOT_ENOUGH_DEPOSIT` |
| Keeper | `close_epoch`, `commit_epoch`, `finalize_epoch`, `prune_epoch` | 0.17 | 0.41 | *estimate* by the reserve rule (below); SV-020: the keeper refuses to sign with less than the reserve of the call |
| Solver | `submit_clearing` | 0.08 | 0.18 | same; SV-020: the solver stops with a clear message below its reserve |
| Six agents | `join` deposit 0.35 each, **not returned**, plus gas | 0.4 each | 0.5 each, 3.0 | `JOIN_STORAGE_DEPOSIT` |
| Facilitator relayer | `register_cumulative` for every pair, about 4 Tgas each | 0.5 | 1.5 with a gas key | *estimate* |
| DAO council, 3 accounts | proposal bond 0.1 NEAR each, gas | 0.2 each | 0.5 each, 1.5 | Sputnik default bond |
| USDT storage | `storage_deposit` on `usdt.tether-token.near` for six agents and the circle | 0.01 | 0.01 | *measured* 0.00125 each |
| **Total** | | | **about 16.3 NEAR** (22.3 if the factory demands the 7 NEAR of testnet) | |

- **Not returned:** the 6 join deposits (2.1 NEAR) and the gas. **Locked while the circle exists:** the code storage (6.83 NEAR, returned only if the account is deleted) and whatever was attached to the DAO account. **Bonds come back:** the full asset catalog is 92 proposals of 0.1 NEAR, 9.2 NEAR out at once unless the council adds them in batches, returned when each proposal is finalized.
- **The reserve rule (CT-102, `contracts/docs/gas-and-cost.md`):** a transaction reserves about 0.001 NEAR per Tgas of prepaid gas and returns what it does not burn. `commit_epoch` (150 Tgas) reserves 0.151 NEAR, `submit_clearing` (60 Tgas) 0.061, `close_epoch` 0.021, `finalize_epoch` 0.101, `prune_epoch` 0.201. One epoch of 210 edges burns about 0.1075 NEAR in all, so two rehearsals cost the gas of two small epochs, well under 0.5 NEAR.
- **USDT (6 decimals), *estimate*:** stake 2 USDT per agent (the credit limit is 0.8 of the stake, enough for the 0.02 price of a call) and 1 USDT spare per agent for the residual, 18 USDT for the first rehearsal; the second reuses the stakes, and a defaulter loses part of its stake (0.2 USDT in the testnet run). Plan **20 USDT** in all. The withdrawal to Base is at most 1 USDT; the minimum of a 1Click withdrawal is *unknown* and the dry quote tells.
- **Time (observed on testnet):** one epoch of the demo takes 40 to 50 minutes; a defaulter adds the 15 minutes of the payment window.

## 3. The steps, in order

Before each step run `node scripts/mainnet-preflight.mjs` (views only, reads no key). After each step write the hash in the spending log of [mainnet-budget.md](mainnet-budget.md). **Stop** at the first thing that is not as written, and report it; the state of the chain is described so the owner can decide. Steps marked **SIGNS** are run by the owner after reading what they print.

| # | Step | Who | Command or action | Stop if |
| --- | --- | --- | --- | --- |
| 1 | Accounts and funds | owner | choose the names (decision 1), write the ids in `.env`, make the keys with `near` on the owner's machine (`scripts/create-accounts.mjs` has no mainnet mode), fund the accounts of section 2, buy the 20 USDT, register every USDT holder | the preflight reports MISSING for an account or a balance |
| 2 | The release | anybody | `gh release download v0.0.13 -R x207-labs/contracts`; `shasum -a 256 x207-circle-v0.0.13.wasm` must be the sha256 of section 0 and the line in `SHA256SUMS`; `contracts/scripts/verify-release.sh` is the reproducible build. Never deploy a wasm built on a laptop | the sha256 differs |
| 3 | The DAO (**SIGNS**) | owner | `node contracts/dao/create-dao.mjs --name x207 --council a.near,b.near,c.near --signer owner.near --network mainnet` prints one command; gas of `create` should be 300 Tgas (100 ran out on testnet) | `get_policy` of the new DAO does not list the council |
| 4 | Dry run of the deploy | anybody | `node scripts/deploy-mainnet.mjs --network mainnet --circle <circle>.near --owner <dao>.sputnik-dao.near --release v0.0.13 --out docs/mainnet-dry-run.json` (default: reads only, signs nothing) | exit 1 with `STOP`, or any `problems` |
| 5 | Deploy and `new` (**SIGNS**) | owner | the same command with `--keys-dir <keys folder with a mainnet/ subfolder> --out docs/mainnet-deploy.json --execute --yes-owner-approved`; it reads `<keys-dir>/mainnet/<circle>.json`, deploys, calls `new` with the DAO as `owner_id`, then checks the `code_hash`, `interface_version` and `get_owner` | any check differs: do not use that contract (`owner_id` cannot be changed; delete the account and start again) |
| 6 | Verify the code on chain | anybody | `contracts/scripts/verify-release.sh v0.0.13 <circle>.near https://rpc.mainnet.fastnear.com`; and `X207_EXPECTED_WASM_SHA256=<sha256> node scripts/mainnet-preflight.mjs` must print OK on "code_hash against the release". Write the `code_hash` next to the deploy hash in the log | the `code_hash` is not `DTw5…jsjh` |
| 7 | Register the asset classes | owner, council | `node scripts/print-class-proposals.mjs --network mainnet --dao <dao>.sputnik-dao.near --contract <circle>.near --signer <council member>.near --rpc-url https://rpc.mainnet.fastnear.com > class-proposals.sh` (94 commands on 2026-11-04, `--only` for a few, `--count` for the number); the owner or a council member runs lines of it (**SIGNS**), the council votes with `contracts/dao/vote-proposal.mjs`; check with `list_asset_classes` | a class is registered with other content |
| 8 | Onboarding and the first epoch | owner | `DEMO_NETWORK=mainnet X207_CONFIRM_REAL_TX=yes X207_CONFIRM_MAINNET=yes` with the variables of the header of `demo/network.demo.ts` (`CIRCLE_CONTRACT`, `USDT_TOKEN_ID=usdt.tether-token.near`, `KEYS_DIR`, `TERMS_HASH`, `STAKE_AMOUNT=2000000`, the keeper, solver and relayer ids, `SPEND_POLICY_FILE`) and `npm run demo:mainnet`; without the two `CONFIRM` variables it only prints the plan (read it first). Then `DEMO_BARTER=yes DEMO_DEFAULT=<a debtor> DEMO_PAYMENTS=60 DEMO_GAS_KEY_LANES=4 DEMO_CALL_PAUSE_MS=1500 RPC_URLS=<paid or several> X207_DEMO_RECORD=docs/mainnet-demo.json`. *Pass:* six members `active`; the 207 report shows 409 for the defaulter, its stake cut by the amount due, its limit 0, creditors paid in full (UM-029) | a stake is refused (check `storage_deposit` of the token for the circle first); the facilitator answers 503 (the public RPC is the limit, see `sdk/docs/rpc-load.md`; use a paid endpoint; resume with `DEMO_RESUME_EPOCH=<epoch>`) |
| 9 | The DAO proposal `set_params` (UM-028, CT-050) | council | first the dry run, which reads the chain and prints the proposal, the votes and the reads, and cannot send: `node contracts/dao/mainnet-set-params.mjs --dao <dao>.sputnik-dao.near --contract <circle>.near --signer <member>.near --params-file params.json`. Then the owner runs the printed `add_proposal` (**SIGNS**), the council votes. Or in the demo: `DEMO_DAO_ACCOUNT DEMO_DAO_COUNCIL DEMO_DAO_PARAMS_FILE`, one value changed inside ADR-20 (testnet: `limit_decay` 0 to 100). *Pass:* `Approved` after two votes, `params_updated` carries `effective_epoch`, `get_params` shows it from the next epoch | the dry run prints a PROBLEM |
| 10 | Intents and Base (UM-027 second half, UM-035; **never rehearsed**) | owner | see section 4 | the dry quote fails, a token pair is not listed, or a step needs a signature this repository cannot produce: say that UM-027 and UM-035 stay open |
| 11 | The second epoch and the record (UM-040) | owner | repeat step 8 without changing code, a second defaulter or the same one if the stake allows; copy the hashes of both rounds from `docs/mainnet-demo.json` to the README; `node scripts/check-window.mjs` and `npm run check:pins` before the submission | |

**The keeper between rehearsals.** The demo script runs the keeper's calls itself. A keeper that keeps running is `node scripts/keeper.mjs --rpc-url <url> --contract <circle> --account <keeper> --prune-lag 2` with `KEEPER_SECRET_KEY` in the environment; `--prune-lag` calls `prune_epoch(epoch, 200)` for each `finalized` epoch two behind, off by default because what it removes cannot be read again (`list_obligations`, `obligation`, `get_bundle` of that epoch answer empty; `claim` and `net_position` still work). It is for a circle that stays open, not for the rehearsals.

## 4. Step 10: Intents and the withdrawal to Base

1. With the JWT, run the preflight with `X207_PREFLIGHT_BASE_ADDRESS` set to a Base address of the owner: the dry quote must answer.
2. **A residual paid through Intents** (only if the owner wants this route): `intents.near` calls `mt_on_transfer` on the circle (only `intents_id`, only `nep141:usdt.tether-token.near`, `msg` as the `settle` action), and the circle books the payment. **Before any `claim`** somebody calls `withdraw_intents_balance()` with at least 130 Tgas (the SDK builder uses 150); it emits `intents_withdrawn { amount }`, and the view `intents_balance` says how much waits. Errors: `ERR_GAS_TOO_LOW`, `ERR_WITHDRAW_IN_FLIGHT`, `ERR_NOTHING_TO_WITHDRAW`.
3. **At most 8 debtors per `execute_intents`, each signed transfer with `min_gas` of 10 Tgas** (BE-034, measured in the sandbox with the wasm of `intents.near`: with the default of Intents 7 debtors already fail, with `min_gas` 10 Tgas ten work and 12 fail; the backend uses 8, `DEFAULT_MAX_PER_CALL` and `DEFAULT_MIN_GAS` in `backend/src/settlement/residual/batch.ts`; table in `contracts/docs/gas-and-cost.md` section 3a). A call that exceeds the prepaid gas pays nobody; send the same batch again with fewer debtors. Mainnet gas can differ with the version of Intents: try with two debtors first.
4. A creditor claims to the Intents balance: `claim(epoch, destination: "intents")` (tested in the sandbox with a mock Intents contract and the real wasm only).
5. The creditor's intent for the withdrawal is signed by the creditor's wallet (the backend only prepares an unsigned intent: `OneClickClient`), submitted to 1Click, and the USDC arrives at the Base address. *Pass:* USDC at the Base address and both hashes in the log.

## 5. Who signs

| Action | Signer |
| --- | --- |
| Funding, keys, account names, USDT, the 1Click token | the owner |
| Create the DAO | the owner |
| Deploy and `new` | the key of the circle account, held by the owner, with `--execute --yes-owner-approved` |
| `set_params`, `set_asset_class`, `set_asset_contracts`, `propose_freeze`, `propose_upgrade`, `apply_upgrade` | the DAO (council votes) |
| `close_epoch`, `commit_epoch`, `finalize_epoch`, `apply_freeze`, `settle_deal`, `prune_epoch`, `withdraw_intents_balance` | anybody (the keeper in practice) |
| Joining, staking, vouchers, deals | each agent with its own key |

The scripts print or send only with `X207_CONFIRM_REAL_TX=yes` and `X207_CONFIRM_MAINNET=yes` (the demo) or `--execute --yes-owner-approved` (the deploy). `print-class-proposals.mjs`, `contracts/dao/*.mjs` and `mainnet-set-params.mjs` only print. The owner decides, and writes in the log, whether to delete the full-access key of the circle account after step 5: with the DAO as owner, code changes go through `propose_upgrade` and `apply_upgrade` (timelock), which need no key of the account.

## 6. Rollback

- **Before `new` ran:** the account only holds code. The owner deletes the account (beneficiary the owner) and starts again with another name; the locked NEAR returns.
- **After `new`, nothing in use:** `owner_id` cannot be changed. A circle with a wrong owner, version or `code_hash` is not repaired: delete the account and deploy again. The script stops at its check, so no member has joined.
- **In use, a code change:** only forward, by the DAO: `propose_upgrade` with the sha256 of the new wasm, the timelock, then `apply_upgrade`. A rollback to an older release is **not** safe once 0.0.12 or later state exists: open deals hold bonds (`bond_locked`) that 0.0.11 does not know (`ct094_upgrade_from_0_0_11` proves the way forward only).
- **Never reuse a contract account name after an EVM member joined; use a new name.** The EIP-712 domain salt is a function of the account name, and the nonce of an EVM member lives in contract state. If the account is deleted and deployed again under the same name, state is empty (nonce 0, no member), but signatures that members signed earlier for that name carry the same salt, and a signed action whose deadline has not passed (or a `join` with nonce 0) is valid again. Start over under a new name (CT-113 R2).
- **A freeze** is lifted by `unfreeze_member` (the DAO); no money moves by a freeze. **Money:** stakes come back by `request_exit` and `withdraw_stake` when no bond is locked; the join deposit does not.

## 7. Schedule and what only the owner does

The window closes 2026-11-14T23:59Z. Working back: steps 1 to 7 at least three days before; the first epoch (step 8, 9) at least 24 hours before the end and the second (step 11) at least 12 hours before; step 10 as soon as the JWT exists, because it depends on a third party. If it cannot be done, the README says that the Intents and Base part has not run on any network.

Only the owner: funding; buying or bridging the USDT; creating and keeping the keys; registering the account name; the 1Click JWT; signing every mainnet transaction; the council's votes; the signature of the creditor's withdrawal; filling the spending log; the decision to publish packages, make repositories public and submit.

## 8. What was rehearsed

Step 4 ran against testnet with the 0.0.13 wasm (`x207-v013.testnet`, owner DAO `x207v8.sputnikv2.testnet`): every check passed, `alreadyDeployed: true`, nothing signed; a wrong `--expect-sha256` stops with `refused: sha256 of the wasm is … but the pinned number is …`, `--yes-owner-approved` without `--execute` is refused, and a council member as owner is refused (`get_policy` fails). The 92 class proposals counted against that circle: 92 to add, 2 already registered. Step 9's dry run ran against the same circle and DAO (`contracts/dao/mainnet-set-params.mjs --network testnet`). `node --test scripts/deploy-mainnet.test.mjs` (9) and `node --test contracts/dao/` (24) pass. **A mainnet dry run was not run.**

## 9. The chain as it is, read on 2026-11-04 (views only, no key, no transaction)

Read with the public mainnet RPC (`https://rpc.mainnet.fastnear.com`) at block height about 223,009,000. Nothing was signed or sent.

| What | Read | Effect on the plan |
| --- | --- | --- |
| Price of storage | 1e19 yoctoNEAR per byte (0.00001 NEAR); gas price 1e8 | the wasm of v0.0.13, 682,707 bytes (size of the release asset), locks 6.827 NEAR; section 2 is right |
| `x207-circle.near`, `x207.sputnik-dao.near`, `x207-labs.near` | `UNKNOWN_ACCOUNT` (free) | names of decision 1 and of the DAO are available today; nothing reserves them |
| How a top-level name is made | the registrar `near` (code `HiyC5tB1...`) has `create_account`, `create_account_advanced` and `create_account_and_claim`, and in its strings no minimum balance or length rule | the owner can create `x207-circle.near` with a full-access key and a deposit; *not run*, the exact deposit is the storage of the account and its key |
| Sputnik DAO factory `sputnik-dao.near` | 2,069 DAOs; default DAO code is the **global contract** `DtHZA1mU...` (version 3.2); the last 40 DAOs hold 0.01 to 0.25 NEAR, almost all about 0.09, one 6.0 | the 7 NEAR deposit of section 2 was the price of the old way (the factory deployed 444,088 bytes of code into each DAO, about 4.4 NEAR of storage). The factory still has a check (`ERR_NOT_ENOUGH_DEPOSIT`) whose limit cannot be read by a view; a refused `create` returns the deposit, so start with 1 NEAR and raise it only if refused |
| DAO version | v3.2; `get_policy` of an existing DAO has the same shape as the testnet DAO (roles, `permissions`, `vote_policy`, `proposal_period`) | `contracts/dao/*.mjs` and the sandbox test (CT-048) used the original `sputnikdao2` wasm and a testnet factory. The create arguments and the proposal kinds `FunctionCall` / `ChangePolicy` are the same; **not run against a v3.2 DAO**: after step 3 check `get_policy` (council, `proposal_period` of 1 hour) before anything else, and treat the `set_params` proposal of step 9 as the first real test of the DAO |
| USDT `usdt.tether-token.near` | `USDt`, 6 decimals, supply 525,944,120.793709; `storage_balance_bounds` min = max = 0.00125 NEAR; `intents.near` is registered (0.00125 total) | each new holder (six agents, the circle, the keeper if it holds USDT) pays 0.00125 NEAR once: 8 holders 0.01 NEAR, as in section 2 |
| `intents.near` | code 1.3 MB; no `storage_balance_bounds`; it has an `add_public_key` call (1 yoctoNEAR), `ft_withdraw`, `mt_withdraw`, `execute_intents`, `simulate_intents`, and the intent `storage_deposit`; the circle has no balance there (`mt_balance_of` 0) | depositing USDT to Intents needs no storage deposit from the user; a debtor pays 1 yoctoNEAR for its `add_public_key`, and a withdrawal to a NEAR account that is not registered at USDT needs the `storage_deposit` intent (0.00125 NEAR) |
| Preflight | `node scripts/mainnet-preflight.mjs`: 12 missing (no account exists yet), 1 not checked (dry quote needs the JWT); USDT, Intents, `simulate_intents` and the 1Click token list answer | no surprise on the third-party side |

The order that needs the owner's signature is unchanged (section 5). What changed: the owner needs about 16.3 NEAR and 20 USDT instead of 22.3 NEAR; the DAO is cheaper and the DAO code is newer than the one that was rehearsed, which is the one thing worth a look before step 3. `contracts/dao/lib.mjs` (`FACTORY_DEPOSIT`) and `scripts/mainnet-preflight.mjs` (`daoFactoryDeposit`) still say 7 NEAR; they are not changed here.

## 10. Rehearsal of these steps on testnet (2026-11-04, UM-009)

Same scripts, fresh faucet accounts, keys in `.secrets/testnet-deployer/testnet/` (never on mainnet). Circle `x207-rh-circle.testnet`, DAO `x207rh.sputnikv2.testnet`, council `x207-rh-owner.testnet` and `x207-rh-c1.testnet`, six agents `x207rh-<name>.testnet`, keeper, solver and relayer.

| Step | Result | What it taught |
| --- | --- | --- |
| 3 DAO | `create-dao.mjs` command run; `get_policy` lists the council, `proposal_period` 3600000000000 | before the fix the command named the mainnet factory for testnet and attached 100 Tgas; now the factory, the deposit (testnet 7 NEAR, mainnet 1 NEAR) and 300 Tgas follow `--network` |
| 4, 5 deploy | dry run, then `--execute`: `code_hash` equals the release, `ownerIsTheDao`, `interface_version` 0.0.13 | on testnet `--usdt` is required (`usdt.x207-deployer.testnet`) |
| 6 verify | `contracts/scripts/verify-release.sh`: MATCH; preflight with `X207_PREFLIGHT_NETWORK=testnet` OK for code, version and owner | the USDT, Intents and 1Click rows are mainnet-only and show MISSING on testnet |
| 7 classes | one proposal added, two council votes, `Approved`, class registered | the council of two needs both votes; 94 proposals exist, not 92 |
| 8 epoch | `npm run demo:testnet` with `DEMO_MINT_USDT=yes`: 6 agents joined, 20 vouchers, cleared 0.28 of 0.40 credit (20 payments became 2 transfers), `finalize_epoch`, claims; about 23 minutes. **The default branch needs a debtor:** `DEMO_DEFAULT=gpu` named a creditor in this graph (slashed 0 of 2,000,000); the second epoch with `DEMO_DEFAULT=summarizer` (a debtor) slashed 40,000 of 2,000,000, answered 409 on the 207 report and left the limit at 0 | needs `KEYS_DIR`, `TERMS_HASH`, `STAKE_AMOUNT`, `AGENT_ACCOUNT_TEMPLATE`, keeper, solver and relayer ids and `SPEND_POLICY_FILE` (`agents/config/spend-policy.example.json`) |
| 9 `set_params` | `mainnet-set-params.mjs` dry run, then the proposal, two votes, `Approved` | the file must hold the WHOLE params (take them from `get_params`; the dry run says which fields are missing); the new values wait in `get_pending_params` and are active after the next epoch rolled (here `limit_cap` changed in epoch 2) |
| 10, 11 | not run: `intents.testnet` has no code; step 11 repeats step 8 | |

Signing with `near ... sign-with-access-key-file` needs `{account_id, public_key, private_key}`, while the key files of this repository hold `secret_key`: `node scripts/cli-key-file.mjs --keys-dir <dir> --network testnet --account <id> --out <file outside the repo>` converts one account (testnet only). On mainnet the owner uses the keychain (`sign-with-keychain`, the default of the printed commands).

## 12. Go-live command order for v0.0.15, with the testnet check of each command (UM-169, 2026-11-05)

Nothing here was run on mainnet. Each command was run on testnet with the equivalent parameters (circle `x207-v015.testnet`, DAO `x207v8.sputnikv2.testnet`, mock token `usdt.x207-deployer.testnet`); the right column says what happened. Placeholders: `<circle>` = the circle account (decision 1), `<dao>` = `<name>.sputnik-dao.near`, `<owner>` = the owner's account, `<m>` = a council member, `<agent>` = a member. `near` is near-cli-rs 0.30. **Never use `print-to-terminal` for a key or a seed phrase**; make mainnet keys with the keychain (`save-to-keychain`) or into a file outside the repo.

### 12.1 Accounts and keys (names only, never values)

| Account | Key | Created by | Used for |
| --- | --- | --- | --- |
| `<owner>` | full access, owner's keychain | owner (exists) | pays the DAO factory deposit, adds proposals |
| `<council a, b, c>.near` | full access, one key each | owner | vote on proposals; two votes pass |
| `<circle>.near` (decision 1) | full access, `<keys-dir>/mainnet/<circle>.json` for the deploy script; the owner may delete it after step 5 (section 5) | owner | holds the contract; deploy and `new` |
| keeper, solver, relayer | function-call or full access, in `.env` of the service | owner | epoch calls, `submit_clearing`, `register_cumulative` |
| six agents | one key each (ed25519; or only a `0x` key for EVM agents) | owner or the agents | `join`, stake, vouchers, `claim` |
| 1Click | JWT in `.env` (`ONECLICK_JWT`) | owner requests it | the dry quote and the withdrawal to Base (section 4, 12.5) only |

### 12.2 Cost per step (NEAR and USDT; amounts for v0.0.15)

`node scripts/mainnet-costs.mjs --wasm contracts/prebuilt/x207_circle-0.0.15.wasm` (run 2026-11-05): circle minimum 7.31 NEAR, recommended 8.58 (code 7.21 locked + `new` and catalog); keeper 0.17 / 0.41; solver 0.08 / 0.18; agents 0.4 / 0.5 each; the script's total 12.17 NEAR. With the DAO (1.5), the facilitator relayer (1.5) and the council (1.5) the plan is **about 16.7 NEAR and 20 USDT** (section 2 plus 0.38 NEAR of extra code storage). The deploy script's minimum for the circle account is 8 NEAR; fund 8.6.

| Step | NEAR | USDT |
| --- | ---: | ---: |
| 1 fund accounts | the sums of section 2 | buy 20 |
| 3 DAO | 1 to 1.5 (deposit stays in the DAO) + gas ≈ 0.03 | 0 |
| 5 deploy + `new` | gas ≈ 0.05 on top of the 8.6 funded | 0 |
| 7 class proposals | 0.1 bond each × 94, returned when finalized (9.4 out at once, or add in batches) | 0 |
| 9 stake, 6 agents | 0.35 join deposit each (not returned) + 0.00125 token storage each | 2 each = 12 (+ spare 6) |
| 10 `set_params` | 0.1 bond (returned) + gas | 0 |
| 11 claim to Intents, Base withdrawal | 1 yocto per `claim`, gas < 0.01 | ≤ 1 fee on the withdrawal |

### 12.3 Order

The step numbers of this table differ from the table of section 3 (here 9 is admit and stake, 10 is `set_params`, 11 is the claim to Intents); the schedule in section 7 uses the numbers of section 3. All commands run from the root of this repository. "Verify" says what must be true before the next step; **stop at the first difference**.

| # | Step | Command | Testnet check (2026-11-05) | Verify |
| --- | --- | --- | --- | --- |
| 1 | Preflight | `node scripts/mainnet-preflight.mjs` (mainnet env: copy `.env.mainnet.example`) | ran with `X207_PREFLIGHT_NETWORK=testnet`: reads only, "16 missing, 1 not checked. Nothing was signed or sent." (testnet has no real USDT, Intents or 1Click listing, so those rows say MISSING) | after funding, no MISSING row except the ones for steps not yet done |
| 2 | Release file | `gh release download v0.0.15 -R x207-labs/contracts` (after the tag exists), `shasum -a 256 x207-circle-v0.0.15.wasm` | `shasum` of the prebuilt file = `f832e53f…` (reproducible build) | equals `SHA256SUMS` and the hash of `repro-build.sh` |
| 3 | DAO (**SIGNS**) | `node contracts/dao/create-dao.mjs --name x207 --council a.near,b.near,c.near --signer <owner> --network mainnet` prints one `near contract call-function` for `sputnik-dao.near` `create` (300 Tgas, deposit 1 NEAR on mainnet, 7 on testnet); the owner runs it | the printed command was inspected on testnet (factory `sputnikv2.testnet`, 300 Tgas, deposit 7 NEAR); the DAO `x207v8.sputnikv2.testnet` was made this way and passes `get_policy` | `near contract call-function as-read-only <dao> get_policy …` lists the council and `proposal_period` 3600000000000 |
| 4 | Deploy dry run | `node scripts/deploy-mainnet.mjs --network mainnet --circle <circle> --owner <dao> --wasm x207-circle-v0.0.15.wasm --expect-sha256 <sha256> --params-file params.json --out docs/mainnet-dry-run.json` | ran on testnet with the prebuilt 0.0.15 wasm, `--usdt usdt.x207-deployer.testnet`, params file with `admission: "dao"`: `problems: []`, `steps: []`, "dry run (default): nothing signed, no key read" | `problems` is empty |
| 5 | Deploy and `new` (**SIGNS**) | the same command plus `--keys-dir <dir> --out docs/mainnet-deploy.json --execute --yes-owner-approved` | `x207-v015.testnet` runs the 0.0.15 wasm (deployed 2026-11-05 with near-cli, not with this script; the script's `--execute` path was rehearsed with 0.0.13 in section 10), `interface_version` 0.0.15 | `code_hash` = release, `get_owner` = `<dao>`; on mismatch delete the account and start over |
| 6 | Verify | `contracts/scripts/verify-release.sh v0.0.15 <circle> https://rpc.mainnet.fastnear.com`, then `X207_EXPECTED_WASM_SHA256=<sha256> node scripts/mainnet-preflight.mjs` | CT-110 ran the hash comparison for v0.0.14 and v0.0.15 on testnet (`contracts/docs/verify-release.md`) | "code_hash against the release" prints OK |
| 7 | Asset classes | `node scripts/print-class-proposals.mjs --network mainnet --dao <dao> --contract <circle> --signer <m> --rpc-url https://rpc.mainnet.fastnear.com > class-proposals.sh`; owner runs lines (**SIGNS**); council `node contracts/dao/vote-proposal.mjs …` | ran on testnet against `x207-v015.testnet`: "94 proposal(s) to add, 0 class(es) already registered", each line is one `near contract call-function … add_proposal` with a `FunctionCall` to `set_asset_class` | `list_asset_classes` lists the classes |
| 8 | Token storage | `near contract call-function as-transaction usdt.tether-token.near storage_deposit json-args '{"account_id":"<id>","registration_only":true}' prepaid-gas '30 Tgas' attached-deposit '0.00125 NEAR' sign-as <payer> network-config mainnet sign-with-keychain send` for the circle and every agent | the same call shape is what `demo/network.demo.ts` and `scripts/` use on the mock token | `storage_balance_of` is not null for each |
| 9 | Admit and stake | see 12.4 | `ft_transfer_call` with `msg` `{"action":"stake"}` against `x207-v015.testnet`: accepted by the token, the circle refused a non-member and the token refunded (result `"0"` used), so the argument shape is right | `member` shows `stake` = the amount, status `active` |
| 10 | `set_params` proposal | `node contracts/dao/mainnet-set-params.mjs --network mainnet --dao <dao> --contract <circle> --signer <m> --params-file params.json` (dry run), then the printed `add_proposal` (**SIGNS**), then each member votes | dry run on testnet with the 0.0.15 circle and the DAO: "2 of 2 council votes approve", printed `bond_bps: 2000 -> 0`, `bond_threshold`, `prune_delay_epochs`, then the `add_proposal` and the vote commands | `Approved`; `get_pending_params`; active after the next epoch |
| 11 | Claim to Intents | see 12.5 | `claim` with `destination` `"near"` and `"intents"` against `x207-v015.testnet`: both parse (`ERR_NOT_FINALIZED: epoch 1`, the epoch was not finalized, as expected); `"bogus"` is refused by the JSON decoder | `intents_balance`, then the Base steps of section 4 |

`params.json` must hold the WHOLE `get_params` object (the dry run tells which fields are missing). For a circle that admits agents by DAO decision use `admission: "dao"` (v0.0.15 testnet value); decision 3 of section 1 says `"open"`, which lets anyone join with the deposit: the owner decides.

### 12.4 Admit and stake (step 9)

With `admission: "dao"` a joiner is `pending` until the DAO admits it. With `"open"` skip the admit line.

```bash
# the agent joins (0.35 NEAR deposit, not returned); pubkey_voucher is the agent's ed25519 voucher key
near contract call-function as-transaction <circle> join json-args '{"circle_id":"<id>","pubkey_voucher":"ed25519:<pubkey>","terms_hash":"<64 hex>"}' prepaid-gas '30 Tgas' attached-deposit '0.35 NEAR' sign-as <agent> network-config mainnet sign-with-keychain send
# only for admission "dao": the DAO admits (proposal FunctionCall admit_member {"account_id":"<agent>"}, council votes)
# stake 2 USDT (6 decimals) from the agent's USDT balance
near contract call-function as-transaction usdt.tether-token.near ft_transfer_call json-args '{"receiver_id":"<circle>","amount":"2000000","msg":"{\"action\":\"stake\"}"}' prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' sign-as <agent> network-config mainnet sign-with-keychain send
```

An EVM agent uses `join_evm` with an `eip712:` signature (section `evm-agents.md`); its stake is the same `ft_transfer_call` with `"msg":"{\"action\":\"stake\",\"member_id\":\"0x…\"}"` sent by whoever holds the USDT. To pay `due` from the stake automatically, a member calls `set_auto_settle {"enabled":true}` with 1 yocto **before** the epoch is committed (CT-108; opting in later does not count for that epoch).

### 12.5 Claim to Intents (step 11)

```bash
# the creditor claims a finalized epoch to its Intents balance (1 yocto; 100 Tgas is enough)
near contract call-function as-transaction <circle> claim json-args '{"epoch":<n>,"destination":"intents"}' prepaid-gas '100 Tgas' attached-deposit '1 yoctoNEAR' sign-as <creditor> network-config mainnet sign-with-keychain send
```

`"destination":"near"` pays a plain `ft_transfer` to the creditor instead. For an EVM creditor the Intents claim is `claim_evm` with `receiver` = `intents.near`. The route through `intents.near` and the 1Click withdrawal to Base has never run (section 4); stop there and report if the dry quote fails.

### 12.6 Verification points (all views, sign nothing)

`interface_version` = `0.0.15`; `get_owner` = `<dao>`; `get_params` equals `params.json`; `member <agent>` after each join and stake; `list_asset_classes`; `get_epoch` moves through `open`, `committed`, `finalized`; `is_auto_settle <agent>`; `intents_balance` after a claim; `node scripts/mainnet-preflight.mjs` after every step.

### 12.7 Rollback (adds to section 6)

- Deploy or `new` wrong: delete the account with the owner as beneficiary and start over (the 8.6 NEAR return). If an EVM member has already joined, start over under a **new** account name, never the same one (see section 6).
- v0.0.15 specific: `auto_settle` cannot be turned off by the DAO; each member sets `set_auto_settle {"enabled":false}`. The sidecar maps (`v`, `u`) are part of the state; a code change goes forward only (`propose_upgrade`).
- A wrong class or parameter: a new proposal that overwrites it (`set_asset_class`, `set_params`); params apply from the next epoch.
- Money: stakes come back by `request_exit` and `withdraw_stake` when no bond is locked; the 0.35 join deposit and gas do not.

### 12.8 Not tested, and why

Mainnet itself (the owner's decision); `usdt.tether-token.near` and `intents.near` behaviour (they exist only on mainnet; Intents `execute_intents` batch limits are from the sandbox, section 4); the v3.2 global-code DAO factory (testnet factory deploys the whole code); a full `join` → `stake` → epoch → `claim` chain with a real admitted member on v0.0.15 (needs a DAO `admit_member` vote; the same chain ran on v0.0.13 in section 10 and the auto-settle epoch ran in CT-108's testnet tests); the reproducible hash of v0.0.15 (the Docker build was started but `timeout` is missing on this Mac, so it did not finish; run `contracts/scripts/repro-build.sh HEAD <dir>` on the tagging machine).

## 13. Mainnet preparation for v0.0.18, backend, appraiser and frontend (BE-121, 2026-11-12)

**Nothing in this section ran on mainnet.** It was prepared on 2026-11-12 and rehearsed on testnet in a mainnet-like configuration (13.6). Every mainnet transaction and deploy needs the owner's explicit approval per step. The keys in `.secrets/testnet-deployer/` are never used or moved for mainnet; mainnet accounts are created and funded by the owner. Sections 1 to 12 stay valid for the order of steps; this section replaces their numbers for v0.0.18 (wasm 787,568 bytes, sha256 `4701ecce4168d18b0674b6b4af9f789219afc33be99d89c09f3a433c0bd0d198`, tag `v0.0.18`, pinned in `scripts/deploy-mainnet.mjs`).

### 13.1 Inventory of what must exist on mainnet

The owner creates every account with a full-access key in the owner's keychain (`near account create-account fund-myself …`). There is no faucet. Names are proposals; decision 1 of section 1 fixes the circle name.

| Account | Role | Who signs with it | Minimum NEAR | Notes |
| --- | --- | --- | ---: | --- |
| `<owner>.near` (exists) | pays the DAO deposit, adds proposals, funds the others | owner | see 13.2 | the owner's own account |
| `<council-a>.near`, `<council-b>.near` | DAO council, two votes pass | owner (keychain, one key each) | 0.5 each | add a third if the owner wants 2 of 3 |
| `x207-circle.near` (decision 1) | holds contract 0.0.18 | `deploy-mainnet.mjs` once, key file in a folder with a `mainnet` subfolder; delete the key after step M5 | 9.25 | top-level name: `near account create-account fund-myself x207-circle.near '9.3 NEAR' …` |
| `<keeper>.near` | `commit_epoch`, `close_epoch`, `finalize_epoch`, `prune_epoch` | script (`scripts/keeper.mjs`) | 0.41 | the keeper refuses to sign below its reserve |
| `<solver>.near` | `submit_clearing` | script (`solver`) | 0.18 | |
| `<relayer>.near` | facilitator relayer, pays gas for `register_cumulative` | script (`backend`/facilitator) | 1.5 | |
| `<agent-1..6>.near` (or sub-accounts of the circle) | demo members: `join`, stake, vouchers, `claim` | script or owner | 0.5 each | the join deposit is 0.35 NEAR and is not returned |
| `<creditor-base>` | an EVM address on Base that receives USDC in UM-027 | owner's wallet | n/a | a fresh address the owner controls |

Third-party contracts (all read on 2026-11-04, section 9): `usdt.tether-token.near` (6 decimals, `storage_deposit` 0.00125 NEAR per holder), `intents.near` (the circle is not registered there; no storage deposit by the user), `sputnik-dao.near` (factory, v3.2 global code). 1Click needs an `ONECLICK_JWT` that the owner requests.

New infrastructure (templates committed, nothing started):

| Unit | What | Port | File | Needs |
| --- | --- | --- | --- | --- |
| `x207-neardata-cache-mainnet` | one reader of `mainnet.neardata.xyz` (`302` on `/v0/last_block/final`, checked 2026-11-12) | 8098 | `deploy/boxd/x207-neardata-cache-mainnet.service` | none |
| `x207-backend-mainnet` | read API + indexer of the mainnet circle, `X207_READ_ONLY=1`, no faucet | 8085 | `deploy/boxd/x207-backend-mainnet.service`, `deploy/boxd/backend-mainnet.env` | the circle account and its deploy block |
| appraiser (inside the backend unit) | `POST /x207/appraise`, same NEAR AI model as testnet | 8085 | `X207_APPRAISER_NEARAI_KEY` set on the machine only | the same key as v018; it does not touch money |
| proxy | `boxd machine proxy add mainnet --vm x207 --port 8085` gives `https://mainnet.x207.boxd.sh` | | | |

The indexer reads `https://tx.main.fastnear.com/v0/account` (answers for `usdt.tether-token.near`, checked 2026-11-12) and `https://rpc.mainnet.fastnear.com`; the MPC contract of the marketplace is `v1.signer`. The unit uses its own SQLite `/var/lib/x207/x207-mainnet.sqlite`, so the testnet units are untouched.

### 13.2 Cost, with the source of every number

Price of storage 1e19 yoctoNEAR per byte, gas price 1e8 (read from the mainnet RPC on 2026-11-04, section 9). `node scripts/mainnet-costs.mjs --wasm contracts/prebuilt/x207_circle-0.0.18.wasm` (run 2026-11-12) gives the lines marked [costs].

| Item | NEAR | USDT | Source |
| --- | ---: | ---: | --- |
| Contract code of 0.0.18, locked as storage (787,568 bytes × 1e19) | 7.876 | 0 | arithmetic, [costs] "code 7.88" |
| State of `new`, asset catalog, 1 NEAR spare → circle account funded | 9.25 (minimum 7.98; `deploy-mainnet.mjs` refuses below 8) | 0 | [costs] |
| Keeper (reserve of `commit_epoch` 150 Tgas = 0.15 NEAR, covers 20 epochs at 0.41) | 0.41 | 0 | [costs] |
| Solver (`submit_clearing` 60 Tgas reserves 0.061, burns about 0.003) | 0.18 | 0 | [costs] |
| Six demo agents: join deposit 0.35 + gas, funded 0.5 | 3.0 | 0 | [costs] |
| Facilitator relayer | 1.5 | 0 | section 12.2 |
| DAO factory deposit (kept in the DAO; start with 1, raise only if refused) | 1.0 to 1.5 | 0 | section 9 |
| Two council accounts | 1.0 | 0 | 0.5 each, new accounts |
| DAO gas (`create` 300 Tgas = 0.03; each `add_proposal` and `act_proposal` about 0.002 to 0.02) | 0.1 | 0 | 1 Tgas = 1e12 × 1e8 yocto = 0.0001 NEAR |
| Class proposals: bond 0.1 NEAR × 94, **returned when finalized** (float, not a cost) | 9.4 float | 0 | section 12.2; `print-class-proposals.mjs` prints 94 for v0.0.18 |
| Token storage: 0.00125 NEAR per USDT holder, 9 holders | 0.011 | 0 | section 9 |
| `set_params` proposal bond 0.1, returned | 0.1 float | 0 | `mainnet-set-params.mjs` |
| USDT: 6 agents stake 2 each + spare for residuals and fees | 0 | 20 | sections 2 and 12.2 |
| Withdraw USDT to USDC on Base through 1Click (fee not known until the dry quote) | < 0.01 gas | ≤ 1 | UM-027; **the minimum amount of the route is not verified**, read it from the dry quote |

**Total the owner must hold: about 17 NEAR (of which 9.4 comes back and about 8 is locked in the contract code) and 20 USDT**, plus a few cents of NEAR AI credit (an appraisal costs about 0.00022 USD; the caps of 20 per IP and 200 per day bound it to about 0.044 USD a day). The old figure of section 12.2 (16.7 NEAR) grew by the 0.0.15 → 0.0.18 code: 0.66 NEAR more storage. The boxd machine already runs; the mainnet unit adds one SQLite file and one process.

### 13.3 Ordered steps

"Signs": **owner** = the owner approves and signs in the keychain; **script** = a script signs with a key the owner placed. Every step ends with a check; stop at the first difference. Commands run from the root of this repository. `<circle>`, `<dao>`, `<owner>`, `<m>` as in section 12.

| # | Step | Command | Signs | Verify | Rollback |
| --- | --- | --- | --- | --- | --- |
| M0 | Accounts | the owner creates and funds the accounts of 13.1; copy `.env.mainnet.example` to `.env.mainnet` (ids only) | owner | `node scripts/mainnet-preflight.mjs`: NEAR rows OK for every account | none needed; unused accounts can be deleted |
| M1 | Reproducible build and release check | `gh release download v0.0.18 -R x207-labs/contracts`; `contracts/scripts/repro-build.sh <commit of the tag> <dir>` (needs Docker; the pinned hash comes from two byte-identical builds of `f551f51`, see `KNOWN_SHA256`); `shasum -a 256 x207-circle-v0.0.18.wasm` | none | sha256 equals `4701ecce…d198` (also `KNOWN_SHA256["v0.0.18"]`, `SHA256SUMS`, and `contracts/prebuilt/`) | none |
| M2 | DAO | `node contracts/dao/create-dao.mjs --name x207 --council <a>.near,<b>.near --signer <owner> --network mainnet`, the owner reads and runs the printed command (300 Tgas, deposit 1 NEAR) | owner | `get_policy` of `x207.sputnik-dao.near` lists the council and `proposal_period` 3600000000000 | an unspent name is free again; the deposit stays in the DAO; if `create` is refused the deposit returns |
| M3 | Deploy dry run | `node scripts/deploy-mainnet.mjs --network mainnet --circle <circle> --owner <dao> --wasm x207-circle-v0.0.18.wasm --expect-sha256 4701ecce4168d18b0674b6b4af9f789219afc33be99d89c09f3a433c0bd0d198 --params-file params.json --out docs/mainnet-dry-run.json` | none (no key read) | `problems` is empty; `facts.usdt` is `usdt.tether-token.near` | none |
| M4 | **Owner go for mainnet** | the owner reads `docs/mainnet-dry-run.json` | owner | explicit "yes" in chat | |
| M5 | Deploy and `new` | the same command plus `--keys-dir <dir> --out docs/mainnet-deploy.json --execute --yes-owner-approved` (`usdt_token_id=usdt.tether-token.near`, `intents_id=intents.near`, `owner_id=<dao>`) | script, key of `<circle>` | `code_hash` = release, `get_owner` = `<dao>`, `interface_version` 0.0.18 | `near account delete-account <circle> beneficiary <owner>`, start over under a new name if a member already joined |
| M6 | Verify | `contracts/scripts/verify-release.sh v0.0.18 <circle> https://rpc.mainnet.fastnear.com`, then `X207_EXPECTED_WASM_SHA256=4701ecce… node scripts/mainnet-preflight.mjs`; the owner deletes the circle's full-access key | owner | "MATCH"; preflight shows no MISSING row for the contract | |
| M7 | Token storage | step 8 of 12.3, for the circle and every holder | owner | `storage_balance_of` is not null | none (0.00125 NEAR each) |
| M8 | Asset classes | `node scripts/print-class-proposals.mjs --network mainnet …` (94 proposals), the council votes with `contracts/dao/vote-proposal.mjs` | owner / council | `list_asset_classes` | a new proposal overwrites a class |
| M9 | Backend and appraiser | on the boxd machine: fill `<circle>` and the block in `deploy/boxd/backend-mainnet.env`, copy it to `/etc/x207/backend-mainnet.env`, copy the two `.service` files, build the backend bundle as for v018, set `X207_APPRAISER_NEARAI_KEY` with the temporary-file method of BE-120, `systemctl enable --now x207-neardata-cache-mainnet x207-backend-mainnet`, `boxd machine proxy add mainnet --vm x207 --port 8085` | owner approves, Worker runs | `curl https://mainnet.x207.boxd.sh/healthz`; `/x207/circles/agents-main/params` equals `get_params`; the indexer follows blocks | `systemctl disable --now` both units; the testnet units are not touched |
| M10 | Frontend | 13.4 | owner | the page shows the mainnet circle | delete the Vercel project |
| M11 | Join and stake (UM-026) | section 12.4, six agents, 2 USDT each; `admission` as the owner decided | script / owner | `member` is `active` with `stake` 2000000; the indexer shows it | `request_exit` + `withdraw_stake` (the 0.35 NEAR does not return) |
| M12 | One clearing epoch | `DEMO_NETWORK=mainnet X207_CONFIRM_REAL_TX=yes X207_CONFIRM_MAINNET=yes npm run demo:mainnet` with the env of 13.6 (about 25 minutes) | script | `get_epoch` goes `open` → `committed` → `finalized`; transfers = members with a non-zero net position | a failed epoch is finalized by the keeper; stakes are not lost |
| M13 | Residual through Intents (BE-026, UM-027) | `claim` with `destination: "intents"` (12.5), `simulate_intents`, a dry 1Click quote, then a nominal amount | owner | `intents_balance`; `mt_balance_of` at `intents.near` | funds stay on `intents.near` under the creditor's key |
| M14 | Withdraw to Base (UM-027) | 1Click quote with the real destination, then the withdrawal | owner | USDC arrives at `<creditor-base>`; hash recorded | stop at the dry quote if it fails (section 12.5) |
| M15 | DAO `set_params` (CT-050, UM-028) | section 12.3 step 10 | owner / council | `Approved`, `get_pending_params`, active after the next epoch | a new proposal restores the old value |

### 13.4 Frontend on mainnet

Do not touch the testnet production project (`x207-dashboard`, `x207`). Create a **separate Vercel project** `x207-mainnet` from the same `frontend/` directory (a project, not a branch, so the testnet alias keeps its own environment). Its build variables, from `frontend/.env.example`:

| Variable | Value |
| --- | --- |
| `VITE_NEAR_NETWORK` | `mainnet` |
| `VITE_X207_CONTRACT_ID` | `<circle>` |
| `VITE_X207_CIRCLE` | `agents-main` |
| `VITE_X207_API_URL` | `https://mainnet.x207.boxd.sh` |
| `VITE_X207_USE_FIXTURES` | `false` |
| `VITE_NEAR_RPC_URL` | `https://rpc.mainnet.fastnear.com` |

`X207_CORS_ORIGINS` of the mainnet backend lists `https://x207-mainnet.vercel.app`; change both together if the owner picks another name. Per the standing order the frontend work is last and needs the owner's explicit yes; only `VITE_*` values go to Vercel, never a key.

### 13.5 Parameterised scripts

`deploy-mainnet.mjs`, `mainnet-preflight.mjs` (`X207_PREFLIGHT_NETWORK`), `contracts/dao/*.mjs` (`--network`, `--factory`, `--deposit`), `print-class-proposals.mjs` (`--network`), `verify-release.sh` (account and RPC arguments) and `demo/network.demo.ts` (`DEMO_NETWORK`) already take the network as an argument, which is what made 13.6 possible with new names and no code change. Added in BE-121: the three `deploy/boxd` mainnet templates above. The gate stays: `deploy-mainnet.mjs` needs `--execute --yes-owner-approved`, the demo needs `X207_CONFIRM_REAL_TX=yes` and `X207_CONFIRM_MAINNET=yes`, and a keys folder with `testnet` in its path is refused for mainnet.

### 13.6 Rehearsal on testnet, mainnet-like (2026-11-12)

Same scripts and steps as 13.3 with new faucet accounts (keys in `.secrets/testnet-mainnet-rehearsal/`, outside every repository; not the old circle and not `.secrets/testnet-deployer/`). Circle `x207mn-circle.testnet`, DAO `x207mn.sputnikv2.testnet`, council `x207mn-c1`, `x207mn-c2`, mock token `x207mn-usdt.testnet` (testnet has no real USDT), keeper `x207mn-keeper.testnet`, solver `solver.x207mn-c1.testnet`, relayer `relayer.x207mn-c2.testnet`, six agents `<name>.x207mn-keeper.testnet`, three extra members `x207mn-a1..a3`. Release 0.0.18, `admission: "open"`.

| Step | Result | Transaction |
| --- | --- | --- |
| M2 DAO | `get_policy`: council c1, c2; `proposal_period` 3600000000000 (testnet factory takes 7 NEAR, mainnet 1) | `Hh9hqhZvYHCA54SVTYRLzgkd4WYBbPq51pDtQXnk3PaK` |
| mock token | deploy + `new` | `CRdWa5mdXz85Y8g67RFZHEDg2ZcCLXYRq5YDPXYHyP7R` |
| M3 dry run | `problems: []`, `steps: []`, "nothing signed, no key read" | none |
| M5 deploy / `new` | `code_hash` `5nBeeNaeWbVH7Q1c3mfG1NPThENb9PA8BvVgjauf6Aib` = release, `ownerIsTheDao: true`, `interface_version` 0.0.18 | deploy `Ak3QVYSBueqbssaeE8Lf2kYL63kifgumKcqW2FjAEEMW`, `new` `DnVgVM9XUDDGyqXQ7tMZa4ptFuMv2bjx685nYRWHPUHe` |
| M6 verify | `verify-release.sh v0.0.18 x207mn-circle.testnet`: "MATCH: the account runs the wasm of v0.0.18"; preflight OK for code, version, owner (USDT, Intents and 1Click rows MISSING on testnet, as expected) | none |
| M8 class | 1 of 94 proposals: `Approved` after two votes (the other 93 not run) | add `AxC9Gs68zbbqnrkrYvRNkRLNvfx2soUthi9ghWRrZbA9`, votes `8UJ81umhTiN8ZNNCGtjCSfF65PCDvg42VLADj6uN1ar1`, `7sXevyjU27vKjdds6M77Bm6QuzGBNGAzJjHbTT3vtUGo` |
| M11 join, stake (3 members) | `member`: `active`, `stake` 2000000, `limit` 1600000 | join/stake a1 `2NtrZ1Z94e2Har9gaQ4sUbYuQd8HnGLzd5J3KPjVvvWa` / `4zozgXBgEWWvJfYiYzzSGQqHgHhPRiEbANU4Fm8kbTGN`; a2 `Fj94tgVxnL2o8HFs3epSb4bd2fMgojUwtRfkBnLVMaWB` / `72cc85YQGTWCWrp8Uq93LTYAS7acUDvUna5xXYKkEo55`; a3 `224gjYowNp8A9zMzK1zua5mEReoF6ahb6D2K6cJfTE3M` / `3DPCiDUqukq6e8XBrarD5CgQomyY4hNwjWr8T91YzUr4` |
| M15 `set_params` | dry run `epoch_length: 600 -> 900`; proposal `Approved` after two votes; `get_pending_params` shows 900 | add `67MTTPU9Sscq3RL1mgtaTB4fqQyHjRUE8koKkvb9PXsn`, votes `2TxjgBCUDuUYe7td36J6RyjvJa7hZfvsqghxurNTvRLy`, `HXbbvNCnmc7iEXAxMu1wQ26R9K8BQ6nK6GcyBoDPZrp3` |
| M12 epoch | `demo:testnet` (`DEMO_MINT_USDT=yes`, `DEMO_DEFAULT=summarizer`), 1 test passed in 1357 s: 6 agents joined and staked, 20 vouchers, cleared 280000 of 400000 (20 payments became 2 transfers), `finalize_epoch`, creditors `claimable`; the debtor `summarizer` was `defaulted`, 40000 of 2000000 slashed, limit 0. All hashes in `docs/rehearsal/mn-demo.json` | `close_epoch` `88qCwosVt5EsfxivaQ71waEHdD4BLoLWzWbzcWJapxgs`, `submit_clearing` `EMhEuMtJgx5G27kosEZQs1g6zpi7yDNrYLPcHHMKPuEn`, `commit_epoch` `65TkuQfFLc4SRQwwgW49t7htaAyW99egAot1MyznQL8m`, `finalize_epoch` `996tmyF8PEipneEoKv4Zao3jvqbNYkrKXxVqLjowUVA7`, claims `AWBmb4quwNty3A5Zhhwn1yKeBLQKuZ6pQ9SWev5QFwrT`, `GFs9HjAUNBK66Rj33MPKxzPCzMQZSFNBjpaRipRtYJPK` |
| M13, M14 | **not run**: `intents.testnet` has no code and testnet has no 1Click route to Base | |

What the rehearsal taught: the faucet refused the 11th top-level account of one run (10 were created), so the six agents were made as sub-accounts of a funded parent (`create-faucet-accounts.mjs` gives them 2 NEAR each), which also fits `AGENT_ACCOUNT_TEMPLATE`; the DAO deposit of testnet (7 NEAR) is not the mainnet one (start at 1).

### 13.7 Readiness of the mainnet backlog items (read from the Backlog Masters on 2026-11-12)

| Item | Status | What is missing | Blocked by |
| --- | --- | --- | --- |
| CT-045 DAO script | selesai (script, tested on testnet and in the sandbox) | the mainnet run: M2 | owner's council accounts and the "go" of M4; the v3.2 global-code DAO factory was never run (section 9) |
| CT-049 real USDT stake and claim to Intents | sebagian (`7d7b97d`, prepared for v0.0.13) | M5 for 0.0.18, M7, M11, M13 with real USDT; the tx hashes of stake and claim | accounts, 20 USDT, CT-045 |
| CT-050 DAO `set_params` on mainnet | sebagian (`ca93f61`, dry run) | M15 on mainnet | CT-049 (a live circle) |
| BE-026 residual path | sebagian (`b3072ef`, stages 1 to 3 on 2026-11-04) | stage 4: one nominal residual through `intents.near` | `ONECLICK_JWT`, a funded circle, owner confirmation |
| BE-029 entry path | selesai (sandbox `42c1637`) | nothing new; mainnet use is M13 | none |
| BE-033 end-to-end residual | sebagian (`723436c`) | one withdrawal to another chain (M14) | BE-026 stage 4, UM-024 |
| UM-026 onboarding e2e | belum | M11 with real USDT, indexer shows `active` | accounts, USDT, M9 backend |
| UM-027 settlement e2e | belum | M12 to M14, USDC arrives on Base | everything above, a minimum amount of 1Click that is not verified |
| UM-028 governance e2e | belum | M15, then the dashboard shows the new `epoch_length` | M10 frontend, which waits for the owner's "go" |
| UM-040 two dress rehearsals on mainnet | belum | the whole of 13.3 twice, hashes in the README before 2026-11-14T23:59Z | the owner's decision and funding; each run is about 25 minutes of epoch plus the DAO waits |

None of these rows can be closed without a mainnet transaction, so none is closed by this preparation.
