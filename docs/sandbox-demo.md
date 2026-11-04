# Run the sandbox demo

_Moved from the README section 4. The content is unchanged; paths are relative to this folder. Start at the [README](../README.md)._

### Run the sandbox demo

The demo runs one epoch against a local `near-sandbox` node: a real `x207-circle` contract, six agents, the facilitator, the indexer and read API, the solver and a keeper.

**Quick path, no Rust.** Needs only Node 22.22.2 or newer and `git`. The script downloads the wasm of the circle from the release `v0.0.13`, checks its sha256 against `b9327f2b5d64b1180ba76dd619c6091ae57b48964f520a784e366c131e787054` (pinned in `scripts/deploy-mainnet.mjs`), fetches the near-sandbox 2.13.4 binary, and runs the demo with that wasm. **If the hash is not the pinned one, the script stops and the demo does not run.**

```bash
git clone --recurse-submodules https://github.com/x207-labs/x207.git && cd x207   # the six product repositories are submodules
npm ci
npm run build --workspaces --if-present                                           # the demos import the built TypeScript packages
npm run demo:quick                                                                # = node scripts/demo-quick.mjs --release-wasm; about 5 minutes, most of it the sandbox clock
```

`node scripts/demo-quick.mjs --check-only` downloads and verifies everything and runs nothing. The mock USDT token is a committed test fixture (`contracts/prebuilt/mock_ft.wasm`, sha256 in its README), so the Rust toolchain is not needed. The path below builds everything from source instead.

**From source.** Needs: Node 22.22.2 or newer, Rust 1.99.1 with the `wasm32-unknown-unknown` target (pinned by `contracts/rust-toolchain.toml`) and `cargo-near` 0.22.0. One-time setup from the root of this repository, tried on 2026-11-02 from a clean checkout:

```bash
git clone --recurse-submodules https://github.com/x207-labs/x207.git && cd x207   # the six product repositories are submodules
cd contracts
cargo near build non-reproducible-wasm                                            # the contract, about 30 seconds
cargo near build non-reproducible-wasm --manifest-path probes/mock_ft/Cargo.toml  # the mock USDT token used by every sandbox run
cargo near build non-reproducible-wasm --manifest-path probes/mock_nft/Cargo.toml # the mock NFT; only `tests/escrow-d9.sandbox.test.ts` needs it, no demo does
cargo near build non-reproducible-wasm --manifest-path probes/mock_intents/Cargo.toml # the mock NEAR Intents; the tests of `mt_on_transfer` and `withdraw_intents_balance` need it (`tests/security-review-contract3*.sandbox.test.ts`), no demo does
cargo test --no-run --test ct043_gas                                              # compiles one small test; the build script of near-workspaces downloads the near-sandbox binary (or set X207_SANDBOX_BIN)
cd ..
npm ci
npm run build --workspaces --if-present                                           # the demos import the built TypeScript packages
```

The `cargo test --no-run` step is the slow one: 17 minutes in the clean-checkout run, on a laptop that was compiling other Rust code at the same time. It compiles only; no Rust test runs. Then:

```bash
npm run demo:sandbox
```

Optional: `DEMO_PAYMENTS=120` (number of paid calls) and `DEMO_DENSITY=low|medium|high|star` (which agents buy from which). The run takes about three minutes with the sandbox clock fast-forwarded, prints every stage with transaction hashes and durations, and writes a log to `.demo/`. `npm run demo:testnet` and `npm run demo:mainnet` (`demo/network.demo.ts`) run the same stages against a real network; without `X207_CONFIRM_REAL_TX=yes` they only print the plan, and mainnet also needs `X207_CONFIRM_MAINNET=yes`. A testnet rehearsal ran on 2026-11-02 against a rehearsal contract `x207r-circle.testnet` with 5-minute epochs (twenty paid calls, twelve pair registrations, one clearing proposal, 0.28 of 0.40 credit cleared, two residual payments, one default, claims to `near`); its addresses, results and transaction hashes are in [docs/testnet-rehearsal.md](testnet-rehearsal.md). That contract is interface 0.0.1, older than the contract in this repository. A second rehearsal on 2026-11-03 used the current contract (see the next paragraph). The first testnet run reads the clearing snapshot from contract views instead of the indexer, because the public testnet endpoints rate-limit a block backfill. The second rehearsal (`tests/testnet-rehearsal.live.test.ts`, run with `X207_TESTNET=1`) deployed contract `x207-circle-v7.testnet` at interface 0.0.7 with a 10 minute epoch and used five accounts, the real backend and solver on one machine, and a mock USDT (`usdt.x207-deployer.testnet`). It ran the F9 quick barter 100 / 10 / 3 (pay and barter paths with a seeker share), a ring of three intents, three bundles (`commit_bundle`, then legs with `register_in_bundle`), one clearing, the residual payments, `finalize_epoch` and three claims. Read from the contract view `get_epoch` on 2026-11-03: epoch 4 is `finalized`, 8 edges, 5 participants, `total_obligation` 303.3 credit, `total_cleared` 200.3 credit, `pool` and `shortfall` 0. Not part of it: NEAR Intents (`intents.testnet` has no code), a DAO vote, access assets (F8), a default case, and the indexer following every block. The free testnet endpoints limit the rate, so the indexer of the rehearsal reads the receipts of each transaction it is told about, one hash at a time; the events are the real ones from the chain. The transaction hashes are in [docs/testnet-rehearsal-v7.json](testnet-rehearsal-v7.json). Two optional steps of the network demo are skipped with a message when their prerequisite is missing: `DEMO_BARTER=yes` runs the F5 ring (three signatures, `commit_bundle`, fifteen leg payments with `bundleId`) and needs a contract at interface 0.0.4, set through `CIRCLE_CONTRACT`; `DEMO_DAO_ACCOUNT`, `DEMO_DAO_COUNCIL` and `DEMO_DAO_PARAMS_FILE` run a `set_params` proposal through a Sputnik DAO and need a circle contract that the DAO owns. Neither step has run on a real network yet. The barter step is the code of `demo/barter-step.ts`, which `tests/network-barter.sandbox.test.ts` runs against the real contract in `near-sandbox`. The DAO step is not run anywhere: `contracts/dao/dao.test.mjs` tests the command builders, and `contracts/tests/ct048_sputnik_dao.rs` tests a real Sputnik DAO and `set_params` in `near-sandbox` from Rust. No mainnet transaction has been sent (UM-026, UM-040).

| Do | See |
| --- | --- |
| F1: six agents `join` and stake | Twelve transactions (`join`, then `ft_transfer_call` with `{"action":"stake"}`) with hashes and durations |
| F2: call a paid endpoint without paying | HTTP 402 whose `accepts` lists `batch-settlement@x207:agents-main` and `exact@near:mainnet` |
| F2: agents buy from each other | Paid calls with vouchers; the facilitator registers each pair on-chain (12 registrations for 120 calls in the `medium` run) |
| F3: keeper closes the epoch, the solver clears it, the keeper commits | `close_epoch`, `submit_clearing`, `commit_epoch` hashes and the 207 report with each member's net |
| F4: debtors pay the residual, the keeper finalizes, creditors claim | `settle`, `finalize_epoch` and `claim` hashes |
| F6: a debtor does not pay (`DEMO_DEFAULT=scraper npm run demo:sandbox`) | `finalize_epoch` emits `member_defaulted`; the member is `suspended` with limit 0 and its stake cut by the due amount; `/verify` answers `member_not_active` for a new voucher of that member; the 207 report lists it with status 409, settlement `defaulted` and `haircut` 0; creditors still claim in full; `DEMO_DEFAULT=<agent> npm run demo:testnet` prints the same branch from contract views (stake cut, status 409 from the `defaulted` position, limit) but has not run on a network |
| F7: a DAO proposal changes a parameter (`DEMO_DAO_ACCOUNT=<dao> DEMO_DAO_COUNCIL=<a,b> DEMO_DAO_PARAMS_FILE=<json> npm run demo:testnet`, the circle contract must be owned by the DAO) | `add_proposal` and two council votes, status `Approved`, the event `params_updated` with its `effective_epoch`; the next epoch shows the new value in `get_epoch`. Ran on testnet on 2026-11-03 (`limit_decay` 0 to 100, effective epoch 11, hashes in [docs/testnet-demo.json](testnet-demo.json)). `npm run demo:sandbox` only calls `set_params` from the owner account (stage `dao.set_params`) |
| Metrics | Voucher count, residual payments, cleared ratio, transfer savings and a line "N payments became M", all read from the epoch metrics |

Two real runs (output seen on 2026-11-02, sandbox, different graph density, so the numbers differ):

| Run | Paid calls | Residual payments | Cleared ratio | Transfer savings | Clearing transactions |
| --- | --- | --- | --- | --- | --- |
| `medium`, 120 calls | 120 | 6 | 0.6333 | 20 | 1 |
| `low`, 60 calls | 60 | 5 | 0.5 | 12 | 1 |

The log also marks which Level 0 external interfaces appeared: E1 (buyer), E2 (seller 402), E3 (owner stake), E4 (solver) and E5 (`set_params` by the owner account) were observed. E6 (NEAR Intents and 1Click) is not observable in sandbox mode and stays unchecked until a mainnet run. Report members from the `medium` run above (HTTP 207, `cleared` 1520000 in 6-decimal units, i.e. 1.52 credit; status 402 means the member owes a residual, 202 means the member is owed):

| Member | Status | Net (6 decimals) |
| --- | --- | --- |
| `translator` | 402 | -300000 |
| `scraper` | 402 | -140000 |
| `cleaner` | 402 | -40000 |
| `summarizer` | 202 | +20000 |
| `gpu` | 202 | +160000 |
| `image` | 202 | +300000 |

Net positions add up to zero. The answer of the read API for this epoch, as `npm run demo:sandbox` saved it (`GET /x207/circles/agents-main/epochs/1`, HTTP `207 Multi-Status`; two of the six members shown, the file is `.demo/report207-epoch1.json`):

```json
{
  "circle": "agents-main",
  "network": "x207:agents-main",
  "epoch": 1,
  "phase": "payment_window",
  "committed": true,
  "finalized": false,
  "unit": "credit",
  "decimals": 6,
  "totalObligation": "2400000",
  "cleared": "1520000",
  "clearedRatio": 0.6333,
  "committedAt": "2026-11-03T03:32:33Z",
  "paymentDeadline": "2026-11-03T03:47:33Z",
  "members": [
    {
      "account": "cleaner.test.near",
      "status": 402,
      "net": "-40000",
      "cleared": "260000",
      "settlement": "due",
      "amount": "40000",
      "due": "2026-11-03T03:47:33Z",
      "haircut": "0"
    },
    {
      "account": "gpu.test.near",
      "status": 202,
      "net": "+160000",
      "cleared": "240000",
      "settlement": "claimable",
      "amount": "160000",
      "claimable": false,
      "haircut": "0"
    }
  ]
}
```

`status` 402 means that the member owes a residual, 202 that it is owed; `settlement` follows the position (`due`, `claimable`, `defaulted`, `claimed`); `haircut` is the share of a claim that the stake and the reserve could not cover (0 here). Not yet written as steps: the F4 payment through NEAR Intents and the cross-chain withdrawal (they have not run on any network, see [What has and has not run](what-has-run.md#what-has-and-has-not-run)) and the dashboard views.
