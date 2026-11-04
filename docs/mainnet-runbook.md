# Mainnet runbook for x207-circle v0.0.13 (UM-009, UM-026, UM-027, UM-028, UM-029, CT-049, CT-050, UM-040)

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
| Owner, to create the DAO | factory deposit 7 NEAR plus gas; the 7 NEAR stays in the DAO account | 7.2 | 7.5 | *measured*, `FACTORY_DEPOSIT` of `contracts/dao/lib.mjs` |
| Keeper | `close_epoch`, `commit_epoch`, `finalize_epoch`, `prune_epoch` | 0.17 | 0.41 | *estimate* by the reserve rule (below); SV-020: the keeper refuses to sign with less than the reserve of the call |
| Solver | `submit_clearing` | 0.08 | 0.18 | same; SV-020: the solver stops with a clear message below its reserve |
| Six agents | `join` deposit 0.35 each, **not returned**, plus gas | 0.4 each | 0.5 each, 3.0 | `JOIN_STORAGE_DEPOSIT` |
| Facilitator relayer | `register_cumulative` for every pair, about 4 Tgas each | 0.5 | 1.5 with a gas key | *estimate* |
| DAO council, 3 accounts | proposal bond 0.1 NEAR each, gas | 0.2 each | 0.5 each, 1.5 | Sputnik default bond |
| USDT storage | `storage_deposit` on `usdt.tether-token.near` for six agents and the circle | 0.01 | 0.01 | *measured* 0.00125 each |
| **Total** | | | **about 22.3 NEAR** | |

- **Not returned:** the 6 join deposits (2.1 NEAR) and the gas. **Locked while the circle exists:** the code storage (6.83 NEAR, returned only if the account is deleted) and the 7 NEAR in the DAO account. **Bonds come back:** the full asset catalog is 92 proposals of 0.1 NEAR, 9.2 NEAR out at once unless the council adds them in batches, returned when each proposal is finalized.
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
| 7 | Register the asset classes | owner, council | `node scripts/print-class-proposals.mjs --network mainnet --dao <dao>.sputnik-dao.near --contract <circle>.near --signer <council member>.near --rpc-url https://rpc.mainnet.fastnear.com > class-proposals.sh` (92 commands, `--only` for a few, `--count` for the number); the owner or a council member runs lines of it (**SIGNS**), the council votes with `contracts/dao/vote-proposal.mjs`; check with `list_asset_classes` | a class is registered with other content |
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
- **A freeze** is lifted by `unfreeze_member` (the DAO); no money moves by a freeze. **Money:** stakes come back by `request_exit` and `withdraw_stake` when no bond is locked; the join deposit does not.

## 7. Schedule and what only the owner does

The window closes 2026-11-14T23:59Z. Working back: steps 1 to 7 at least three days before; the first epoch (step 8, 9) at least 24 hours before the end and the second (step 11) at least 12 hours before; step 10 as soon as the JWT exists, because it depends on a third party. If it cannot be done, the README says that the Intents and Base part has not run on any network.

Only the owner: funding; buying or bridging the USDT; creating and keeping the keys; registering the account name; the 1Click JWT; signing every mainnet transaction; the council's votes; the signature of the creditor's withdrawal; filling the spending log; the decision to publish packages, make repositories public and submit.

## 8. What was rehearsed

Step 4 ran against testnet with the 0.0.13 wasm (`x207-v013.testnet`, owner DAO `x207v8.sputnikv2.testnet`): every check passed, `alreadyDeployed: true`, nothing signed; a wrong `--expect-sha256` stops with `refused: sha256 of the wasm is … but the pinned number is …`, `--yes-owner-approved` without `--execute` is refused, and a council member as owner is refused (`get_policy` fails). The 92 class proposals counted against that circle: 92 to add, 2 already registered. Step 9's dry run ran against the same circle and DAO (`contracts/dao/mainnet-set-params.mjs --network testnet`). `node --test scripts/deploy-mainnet.test.mjs` (9) and `node --test contracts/dao/` (24) pass. **A mainnet dry run was not run.**
