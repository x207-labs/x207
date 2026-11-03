# Mainnet runbook (UM-009, UM-026, UM-027, UM-028, UM-029, CT-049, CT-050, UM-040)

Status: **a plan for the owner. Nothing in it has been run on mainnet.** No mainnet transaction has been sent from this repository, and none may be sent without the owner: funding, keys and signatures are the owner's (rule of the project). Every number marked *estimate* is a plan figure, not a measurement; *measured* figures come from the testnet runs of 2026-11-02 and 2026-11-03 (`docs/testnet-demo.json`), where storage and gas prices are the same as on mainnet.

The point of this file is that the owner only has to decide. Sections 1 and 2 are the decisions and the money; section 3 is the steps in order, each with its stop point; section 4 is what no script does; section 5 is the schedule.

## 0. What the scripts cover, and what they do not

| Covered by `npm run demo:mainnet` (`demo/network.demo.ts`; the same script ran a full epoch on testnet) | Not covered by any script, never run on any network |
| --- | --- |
| F1 join and stake with the real USDT, F2 paid calls, F3 clearing and the 207 report, F4 residual payment and `claim` to a NEAR account, F6 a debtor that does not pay (`DEMO_DEFAULT`), F5 the barter ring (`DEMO_BARTER=yes`), F7 a `set_params` proposal through a Sputnik DAO (`DEMO_DAO_*`) | A creditor's `claim` to the Intents balance and the withdrawal to USDC on Base through 1Click (UM-027 second half, UM-035). The code exists (`backend/src/settlement/`, mode `dry` and `mock`); `live` mode and the signing of the creditor's intent are not rehearsed. NEAR Intents as the route of a residual (BE-034 for several debtors: the plan and, since interface 0.0.9, the contract methods `mt_on_transfer` and `withdraw_intents_balance` exist and run in the sandbox against a mock Intents contract; no live run) |

Set `DEMO_MINT_USDT` to nothing on mainnet: it is for the mock token of testnet only. The mainnet token is `usdt.tether-token.near`.

## 1. Decisions for the owner

| # | Decision | Recommendation | Why |
| --- | --- | --- | --- |
| 1 | Contract account name | `x207-circle.near` is what `.env.example` assumes. *Not verified:* how a `<name>.near` account is created and what it costs (the name was not taken when this was written: the view answered unknown account). An alternative that needs no registrar is a sub-account of an account the owner already has, such as `x207-circle.<owner>.near`. | The six agent accounts are sub-accounts of the contract account (`FX-02`) |
| 2 | With or without the Sputnik DAO | With, if UM-028 and CT-050 must be shown on mainnet; without, the owner account is `owner_id` and `set_params` is called by the owner | The DAO costs 7 NEAR (section 2) |
| 3 | Contract version | The tag that carries interface 0.0.8 or later (`contracts/scripts/package-release.sh v0.0.x` writes the wasm, the ABI and `SHA256SUMS` to `dist/`). Record the sha256 in the spending log | `owner_id` is fixed at `new`; there is no method that changes it |
| 4 | Parameters at `new` | Pass explicit `params` as tested on testnet: `epoch_length` 600, `payment_window` 900, `proposal_window` 60, `base_limit_ratio` 8000, `limit_growth` 1000, `limit_cap` "1000000000", `limit_decay` 0, no fees, `admission` "open". `dao/deploy-owned.mjs` prints `params: null` (the defaults of ADR-25: one hour epochs, not tested); edit the printed JSON | A rehearsal then takes about 50 minutes instead of two hours |
| 5 | USDT amounts | Section 2 (estimate) | Small nominal |
| 6 | 1Click | Request a JWT (the owner does this) for the dry quote and for the withdrawal; `ONECLICK_JWT` in `.env` | The preflight cannot check the quote without it |
| 7 | Who is on the DAO council | Two or three accounts of the owner with separate keys | Two votes pass a proposal on testnet |

## 2. Budget (estimates; measured figures marked)

NEAR (the owner funds each account):

| Account | Purpose | NEAR | Basis |
| --- | --- | --- | --- |
| Circle contract account | Locked storage of the code (558 KB, 5.59 NEAR) and of the state (21.7 KB after 6 members and 3 epochs, 0.22 NEAR) plus gas of its own calls | 8.0 | *measured* 5.81 NEAR locked on testnet; 8.0 leaves about 2 NEAR for state growth |
| Signer of the DAO factory (owner) | Factory deposit 7 NEAR; stays in the DAO account (a Sputnik `Transfer` proposal could move it out; not tried) | 7.2 | `contracts/dao/lib.mjs` (`FACTORY_DEPOSIT`); *measured* on testnet: the DAO account holds 7.0 and locks 5.41 NEAR for its storage |
| Six agents | `join` deposit 0.01 NEAR and gas | 0.2 each, 1.2 | *measured* about 0.014 NEAR spent per agent over the whole testnet demo |
| Keeper | `close_epoch`, `commit_epoch`, `finalize_epoch` | 0.5 | *measured* gas below 0.05 NEAR per epoch |
| Solver | `submit_clearing` | 0.5 | same |
| Facilitator relayer | `register_cumulative` for every pair, about 4 Tgas each; a gas key (NEP-611) is optional and needs its own balance | 1.5 (0.5 without a gas key) | *estimate*: one `exact` transaction cost the relayer 0.0003 NEAR on testnet (measured) and a registration is about 4 Tgas; the testnet gas key was funded with 2 NEAR |
| DAO council members (2 or 3) | Bond 0.1 NEAR per `add_proposal`, gas | 0.5 each | Sputnik default bond (`PROPOSAL_BOND`) |
| USDT storage registration | `storage_deposit` on `usdt.tether-token.near` for every holder (six agents and the circle contract) | 0.01 in total | *measured* by the view `storage_balance_bounds`: 0.00125 NEAR each |
| **Total with the DAO** | | **about 19.5** | |
| **Total without the DAO** | | **about 12.3** | the backlog estimated 10 to 15 NEAR; the DAO is what takes the plan above 15 |

USDT (6 decimals), *estimate*: stake 2 USDT per agent (the credit limit is 0.8 of the stake, enough for the prices of the demo, which is 0.02 per call) and 1 USDT spare per agent for the residual payment, so 18 USDT for the first rehearsal. The second rehearsal reuses the stakes; the debtor that defaults loses part of its stake (200000 units, or 0.2 USDT, in the testnet run) and needs another spare unit. Plan **20 USDT** in total. The withdrawal to Base is at most 1 USDT. The minimum size of a 1Click withdrawal is *unknown*; the dry quote of the preflight tells.

Time: *observed* on testnet, one epoch of the demo (join, 60 paid calls, clearing, residual, claims) takes roughly 40 to 50 minutes, and a debtor that defaults adds the 15 minutes of the payment window.

## 3. Steps in order

Before every step: `node scripts/mainnet-preflight.mjs` (views only: it signs and sends nothing, and reads no key). It reports what is missing. After every step: write the transaction hash in the spending log of `docs/mainnet-budget.md`. **Stop** means: do not go on to the next step; the state of the chain is described so that the owner can decide.

### Step 1: accounts and funds (UM-009)
1. The owner chooses the names (decision 1) and writes them in `.env` from `.env.example` (account ids only). Keys are made by the owner with `near` (near-cli-rs): `scripts/create-accounts.mjs` has modes `sandbox` and `testnet` only, none for mainnet. The demo script reads a key from `KEYS_DIR/mainnet/<account>.json` as `{"account_id": ..., "secret_key": "ed25519:..."}` (mode 0600), or from the variables `<ROLE>_SECRET_KEY` (`KEEPER`, `SOLVER`, `RELAYER`); the keys are never printed by any script of this repository.
2. The owner funds the accounts of section 2 (the amounts are the `NEAR` column) and obtains the USDT (section 2). Register every USDT holder: `storage_deposit` on `usdt.tether-token.near` for the six agents and the circle account (0.00125 NEAR each).
3. Run the preflight. **Stop** while it reports MISSING for an account or a balance.

*Cost:* the funds of section 2. *If it fails:* nothing is on chain yet except funded accounts; the owner can move the funds back.

### Step 2: the DAO and the contract (CT-045 on mainnet; needed by CT-050 and UM-028)
1. Build and package the contract: `cd contracts && scripts/package-release.sh v0.0.x`; keep `dist/SHA256SUMS` in the log.
2. Create the DAO with the owner as signer (7 NEAR): `node dao/create-dao.mjs --name x207 --council a.near,b.near,c.near --signer owner.near --network mainnet`. The script **prints** a `near-cli-rs` command; the owner reads it and runs it. *Correction before running:* the factory deposit is 7 NEAR and the gas of `create` should be 300 Tgas (100 Tgas ran out on testnet).
3. Deploy the contract with the DAO as owner and explicit params (decision 4): `node dao/deploy-owned.mjs --contract x207-circle.near --dao x207.sputnik-dao.near --circle agents-main --network mainnet`; edit `params` in the printed command; the owner runs it.
4. Check: `get_owner` answers the DAO; `interface_version` answers the tag; `get_params` answers the parameters of decision 4. The preflight prints all three.

*Cost:* 7 NEAR (DAO) and the locked storage of the contract (section 2). *Stop if:* `get_owner` is not the DAO or the version is not the tag. *If it fails:* a deployed contract with a wrong owner cannot be changed (`owner_id` is set at `new`); the account has to be deleted and made again, so check the printed command twice before the deploy.

### Step 3: onboarding and the real USDT (UM-026, CT-049)
Run `DEMO_NETWORK=mainnet X207_CONFIRM_REAL_TX=yes X207_CONFIRM_MAINNET=yes` with the variables of the header of `demo/network.demo.ts` (`CIRCLE_CONTRACT`, `USDT_TOKEN_ID=usdt.tether-token.near`, `KEYS_DIR`, `TERMS_HASH`, `STAKE_AMOUNT=2000000`, `AGENT_ACCOUNT_TEMPLATE` if the names differ, `KEEPER_ACCOUNT_ID`, `SOLVER_ACCOUNT_ID`, `RELAYER_ACCOUNT_ID`, `SPEND_POLICY_FILE`) and `npm run demo:mainnet`. Without the two `CONFIRM` variables the script only prints the plan: print it first and read it. Stage F1 sends `join` and `ft_transfer_call` with `{"action":"stake"}` for each agent.
*Pass:* six members `active`; the hashes of the stake transfers are the evidence of CT-049 (stake through `ft_transfer_call` to the real token). *Stop if:* a stake is refused (check `storage_deposit` of the token for the circle account first).

### Step 4: one full epoch (UM-040 first rehearsal; includes UM-029)
Same command with `DEMO_BARTER=yes DEMO_DEFAULT=<a debtor> DEMO_PAYMENTS=60 DEMO_GAS_KEY_LANES=4 DEMO_CALL_PAUSE_MS=1500 RPC_URLS=<paid or several endpoints> X207_DEMO_RECORD=docs/mainnet-demo.json`. The debtor must have a negative net position in the epoch; on testnet that was `translator` (net -0.2 credit); read the positions of the dry plan or the previous epoch. Stages: F1, the barter ring, 60 paid calls, F3 clearing, F4 residual payments and claims, then the default branch.
*Pass:* the 207 report shows 409 for the defaulter, its stake is cut by the amount due, its limit is 0, the creditors are paid in full (UM-029). The hashes are in `docs/mainnet-demo.json` and are copied to the README (UM-040).
*Stop if:* the facilitator answers HTTP 503: the public RPC is the limit (see `sdk/docs/rpc-load.md`). Use a paid endpoint or wait; do not pile up runs. A run that stops can be resumed with `DEMO_RESUME_EPOCH=<epoch>`.

**The keeper between rehearsals (interface 0.0.8).** The demo script runs the keeper's calls itself (`close_epoch`, `commit_epoch`, `finalize_epoch`). A keeper that keeps running between the rehearsals and afterwards is `node scripts/keeper.mjs --rpc-url <url> --contract <circle> --account <keeper> --prune-lag 2` with `KEEPER_SECRET_KEY` in the environment. The new option calls `prune_epoch(epoch, 200)` for every `finalized` epoch that is two epochs behind the current one, until the contract answers `0`. `prune_epoch` is permissionless, takes back the storage of the pairs, the participant totals and the bundles of that epoch (the epoch record, the clearing proposal and every position stay, so `claim` and `net_position` still work), and is **off by default** because what it removes cannot be read again: `list_obligations`, `obligation` and `get_bundle` of that epoch answer empty afterwards. Pruning is not needed for the rehearsals; it is for a circle that stays open, so that the storage of the contract does not grow with every epoch. Errors: `ERR_NOT_FINALIZED`, `ERR_UNKNOWN_EPOCH`. A barter bundle has at most 64 legs (`ERR_BAD_BUNDLE` above that); the ring of the demo has 3.

### Step 5: the DAO proposal (UM-028, CT-050)
In the same run or a second one: `DEMO_DAO_ACCOUNT=x207.sputnik-dao.near DEMO_DAO_COUNCIL=a.near,b.near DEMO_DAO_PARAMS_FILE=<json>`, with the params of decision 4 and one changed value inside the range of ADR-20 (testnet: `limit_decay` 0 to 100). The council members' keys must be in `KEYS_DIR/mainnet/`.
*Pass:* the proposal is `Approved` after two votes, the event `params_updated` carries `effective_epoch`, and the epoch after `close_epoch` shows the new value in `get_epoch`/`get_params`. The change is not visible before the next epoch. The dashboard page of governance (FE-014) has not been shown with a real value.

### Step 6: Intents and the withdrawal to Base (UM-027 second half, UM-035) **never rehearsed**
1. With the JWT, run the preflight with `X207_PREFLIGHT_BASE_ADDRESS` set to a Base address of the owner: the dry quote must answer.
2. **A residual paid through Intents** (interface 0.0.9, only if the owner wants this route): a debtor pays its residual from its Intents balance; `intents.near` calls `mt_on_transfer` on the circle (only `intents_id` may call it, only the token `nep141:usdt.tether-token.near`, `msg` as the `settle` action of `ft_on_transfer`), and the circle books the payment. The USDT is still on `intents.near`, so **before any `claim`** somebody (the keeper, any account) calls `withdraw_intents_balance()` with at least 130 Tgas (the SDK builder `buildWithdrawIntentsBalanceCall` uses 150): it moves the booked USDT from `intents.near` to the circle's NEP-141 balance and emits `intents_withdrawn { amount }`. The view `intents_balance` tells how much is waiting. Errors: `ERR_GAS_TOO_LOW`, `ERR_WITHDRAW_IN_FLIGHT` (a withdrawal is already running: wait), `ERR_NOTHING_TO_WITHDRAW`. These methods have run only in the sandbox against a mock Intents contract (`deployCircle(params, { mockIntents: true })`); on the real `intents.near` they have not run. Skip this item for the plain USDT route of Step 4, which does not use it.
3. A creditor claims to the Intents balance: `claim(epoch, destination: "intents")` (the contract part is tested in the sandbox with a mock Intents contract only).
4. The creditor's intent for the withdrawal is signed by the creditor's wallet (the backend only prepares an unsigned intent: `OneClickClient`), submitted to 1Click, and the USDC arrives at the Base address.
*Pass:* USDC at the Base address and the hashes of both transactions in the log. *Stop if* the dry quote fails, the token pair is not listed (the preflight lists both), or any step needs a signature that this repository cannot produce: then report that UM-027 and UM-035 stay open.

### Step 7: the second rehearsal and the record (UM-040)
Repeat Step 4 without changing code (UM-040 asks for two rounds in a row), using a second defaulter or the same one if the stake allows. Copy the hashes of both rounds to the README (`docs/mainnet-demo.json` holds them). Run `node scripts/check-window.mjs` and `npm run check:pins` before the submission.

## 4. What only the owner does

Funding the accounts; buying or bridging the USDT; creating the keys and keeping them; registering the contract account name; the 1Click JWT; signing every mainnet transaction (the scripts print or send only with `X207_CONFIRM_REAL_TX=yes` and `X207_CONFIRM_MAINNET=yes`, which the owner sets); the council's votes; the signature of the creditor's withdrawal; filling the spending log; the decision to publish packages, make repositories public and submit (none of which this file does).

## 5. Schedule

The window closes 2026-11-14T23:59Z. Working back: Step 1 and 2 at least three days before; the first rehearsal (Step 3 to 5) and the second (Step 7) at least 24 hours and 12 hours before the end, as the demo storyboard planned; Step 6 as soon as the JWT exists, because it is the only step that depends on a third party. If Step 6 cannot be done, say in the README that the Intents and Base part has not run on any network.
