# What has and has not run

_Moved from the README section 4. The content is unchanged; paths are relative to this folder. Start at the [README](../README.md)._

**History of the rehearsals (the status paragraph of the first README).** Hackathon prototype for NEAR HACKATHON (1–14 Nov 2026). Almost everything runs in a local `near-sandbox`. Two testnet rehearsals ran: F1 to F4 on 2026-11-02 against an old rehearsal contract, and the barter flow (F5 ring, F9 quick barter, clearing, residual, finalize, claims) on 2026-11-03 against contract 0.0.7 (`x207-circle-v7.testnet`, mock USDT, no NEAR Intents). The network demo (`npm run demo:testnet` with its options) also ran one full epoch on testnet on 2026-11-03 with the barter ring, a gas key, clearing, a debtor that did not pay and a DAO vote on `set_params`, on its own circle with a mock USDT. Separate testnet runs covered the access assets of F8 (v9), the `exact` payment of a buyer outside the circle, and a gas key with four parallel lanes. No mainnet transaction has been sent, and each section says what has and has not run.

### What has and has not run

| Piece | `near-sandbox` | Testnet | Mainnet |
| --- | --- | --- | --- |
| F1 to F4, F6 | Run (`npm run demo:sandbox`) | F1 to F4 on 2026-11-02 against an old rehearsal contract (0.0.1); F1 to F4 again on contract 0.0.7 in the rehearsal of 2026-11-03 (mock USDT). F6 default: run on 2026-11-03 by the network demo on the circle `x207b-circle2.testnet` (a debtor did not pay: its stake was cut by the amount due, status 409, limit 0; [docs/testnet-demo.json](testnet-demo.json)) | No transaction sent |
| F5 barter ring | Run (`tests/barter.sandbox.test.ts`, `npm run demo:marketplace`; the network demo step in `tests/network-barter.sandbox.test.ts`) | Run on 2026-11-03 on contract 0.0.7 (`tests/testnet-rehearsal.live.test.ts`): ring of three intents, three bundles, clearing 200.3 of 303.3 credit, residual, finalize, claims; mock USDT. The optional barter step of `npm run demo:testnet` (`DEMO_BARTER=yes`) has not run on a network | No transaction sent |
| F9 marketplace, seeker, referral inbox | Run (`tests/marketplace.sandbox.test.ts`, `npm run demo:marketplace`) | The quick barter 100 / 10 / 3 with cashback and a seeker share ran in the rehearsal of 2026-11-03. Listing negotiation rounds and the referral inbox were not part of it | No transaction sent |
| F7 DAO vote on `set_params` | Not run; the demo calls `set_params` from the owner account | Run once on 2026-11-03: Sputnik DAO `x207v8.sputnikv2.testnet` owns circle `x207-circle-v8.testnet` (0.0.7); a `set_params` proposal (`limit_decay` 0 to 100) was voted by two council members and took effect from epoch 2 ([docs/testnet-dao-v8.json](testnet-dao-v8.json)). The network demo also ran its own DAO step on 2026-11-03 (DAO `x207b.sputnikv2.testnet`, council of two, `limit_decay` 0 to 100, `params_updated` with `effective_epoch` 11) | No transaction sent |
| NEAR Intents and 1Click (residual payment, withdrawal, `defi` track) | Not observable in sandbox | Not run (`intents.testnet` has no code) | Needs a mainnet run (UM-027, UM-035); not done |
| `exact` payment of a buyer outside any circle (NEP-366 delegate action, relayer pays the gas) | Run in unit tests with a fake signer | Run on 2026-11-03 on `near:testnet` (`sdk/apps/facilitator/test/exact-testnet.live.test.ts`): a buyer paid 0.02 USDT.e (`usdt.fakes.testnet`) to a seller endpoint through the facilitator; the buyer spent no NEAR; hashes in [docs/testnet-demo.json](testnet-demo.json). The mock USDT of this repository cannot be used here: it has no `storage_balance_of` | Not run |
| `business` and `realworld` blocks | Run (`npm run demo:business`, `npm run demo:realworld`) | Not run | No transaction sent. `realworld` is a demo scenario of invoices as vouchers, not a deployment with real businesses |
| Exit and withdraw stake from the dashboard | Run: the page against the real read API and contract, with a sandbox account as the wallet (`frontend/src/test/exit.sandbox.test.tsx`) | Not run. A real wallet through NEAR Connect has not been tried | No transaction sent |
| Parallel registration with a gas key (NEP-611) | Run (`sdk/apps/facilitator/test/gas-key.sandbox.test.ts`: four registrations on four lanes) | Run on 2026-11-03 (`gas-key-testnet.live.test.ts`): four transactions at the same time from one funded gas key of `x207b-relayer.testnet`, one per nonce lane, all accepted and each lane nonce advanced. The calls were `ft_total_supply`, not `register_cumulative`: the network demo then registered the vouchers of two epochs with `register_cumulative` through the same gas key, four lanes in parallel (hashes `relayer.register(gas key)` in [docs/testnet-demo.json](testnet-demo.json)) | No transaction sent |
| F8 class B (function-call key rental, revoke on default) | Run (`npm run demo:classb`, `tests/broker-class-b.sandbox.test.ts`). No TEE | Run on contract `x207-circle-v9.testnet` (0.0.7) with the real broker: `AddKey` and `DeleteKey` on a lease account, grants revoked by the grantor and expired ([docs/testnet-f8-v9.json](testnet-f8-v9.json)). No TEE | No transaction sent |
| F8 class A (NFT escrow) | Run: contract tests (`contracts/tests/ct075_escrow.rs`), the SDK (`sdk/packages/core/test/sandbox/escrow.sandbox.test.ts`, real `escrow_held` and `escrow_failed` logs) and the indexer (`tests/escrow-d9.sandbox.test.ts`). NFT only, mock NFT contract | Run on `x207-circle-v9.testnet`: a failed delivery (`escrow_failed`) and then a delivered sale, with a mock NFT contract ([docs/testnet-f8-v9.json](testnet-f8-v9.json)) | No transaction sent |
| F8 class C (secret behind a broker) | Proxy run (`tests/broker-class-c.sandbox.test.ts`) against a local mock provider; the secret sits in the environment of the broker. **No TEE and no attestation** | A grant of class C was offered on `x207-circle-v9.testnet`; the proxy ran locally against a mock provider ([docs/testnet-f8-v9.json](testnet-f8-v9.json)). No TEE | Not built for a real provider; no transaction sent |
| Residual of several debtors in one `execute_intents` (BE-034) | Plan, checks and a `live` run against the REAL Intents contract (the wasm of `intents.near`) in near-sandbox: three debtors sign with NEP-413, `simulate_intents` passes, one `execute_intents` pays all three, the balances match at each step, `withdraw_intents_balance` and the claim follow (`tests/residual-batch.sandbox.test.ts`, [`backend/docs/residual-batch.md`](https://github.com/x207-labs/backend/blob/main/docs/residual-batch.md)). A tampered payload is refused by the simulation | Passed in near-sandbox | Not run on mainnet or with `intents.near` itself: a mainnet run needs the owner; `mt_on_transfer` receipts are separate, so `paid` is not atomic across debtors |
| Clearing of a large proposal (more than 210 edges) | The failure is measured (CT-098): `commit_epoch` does not fit the log of one receipt. The fix of interface 0.0.13 (CT-099) is partly built: golden vector, SDK parser and hashes, indexer. Not built: the contract change | Not run | A circle whose clearing needs more than about 210 edges can stall until 0.0.13 is deployed (the benchmark: 50 members with 732 obligations give a solution of 651 edges); and a large dense circle clears only a fraction per epoch (300 edges per transaction) |
| NEAR AI inference for agents | Mock mode (ADR-33) | Not run | Waits for the account top-up |

The whole set of sandbox tests (`npm run test:integration`, among them `e2e`, `barter`, `marketplace`, `broker-class-b`, `broker-class-c` and `escrow-d9`) can also run on GitHub: the workflow `.github/workflows/e2e-sandbox.yml` runs on a manual dispatch and on every push to `main`. It builds the contract, the mock token and the near-sandbox binary on the runner and splits the files into four parallel jobs that each run their files one at a time (a new push waits for the run in progress). Its results are in the Actions tab of the umbrella repository; this README cites no run number.

### Epoch timeline of the demo

These are the default circle parameters (ADR-25). They match the defaults in `contracts/x207-circle/src/params.rs`. `set_params` can change them only inside the ranges coded in the contract (ADR-20). They have not yet been checked in a full near-sandbox epoch (UM-025); this table is updated if that test changes them.

| Parameter | Value | Where it applies |
| --- | --- | --- |
| `epoch_length` | 1 hour | From the start of the epoch to the cutoff |
| `proposal_window` | 10 minutes | After the cutoff, any solver can submit a clearing proposal |
| `payment_window` | 30 minutes | After `commit_epoch`, net debtors pay the residual |
| DAO proposal period | 1 hour | A Sputnik DAO proposal for `set_params` is open for voting. This is a DAO setting, not a contract parameter. |

T0 is the moment the demo epoch opens.

| Time | Stage | What happens |
| --- | --- | --- |
| T+0:00 | Epoch open | Agents pay with vouchers, and the facilitator registers each pair before the cutoff |
| T+1:00 | Cutoff | A keeper calls `close_epoch`. The obligations are frozen and the next epoch opens |
| T+1:00 to T+1:10 | `proposal_window` | A solver simulates and submits the clearing |
| T+1:10 | Commit | A keeper calls `commit_epoch`. The 207 report is available |
| T+1:10 to T+1:40 | `payment_window` | Net debtors pay. A debtor that does not pay will default |
| T+1:40 | Finalize | A keeper calls `finalize_epoch`. Defaults are covered by stake, and creditor positions become claimable |

One full cycle takes 1 hour 40 minutes from the opening of the epoch to finalization, plus the time to claim. It fits in one demo session.
