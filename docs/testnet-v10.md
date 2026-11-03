# Testnet rehearsal of contract 0.0.9 (v10), 2026-11-03

Testnet only, run with the standing permission of the owner. The mainnet deployer account was not used and no mainnet transaction was sent. Every transaction hash is in `docs/testnet-v10.json` (names and hashes only; the file was scanned and holds no key). It is the merge of the files that the three live tests wrote from their first transaction.

## What ran
| Test | Circle (owner) | Result | Steps in the file |
| --- | --- | --- | --- |
| `tests/testnet-f8-v10.live.test.ts`: class B lease, class A escrow (scope `{nft_contract, token_id}` of 0.0.8), class C proxy | `x207-circle-v10f.testnet` + `x207-aux-v10.testnet` | **passed** in one run | 41 |
| `tests/testnet-dao-v10.live.test.ts`: Sputnik DAO owns the circle, `set_params` proposal approved by two council members | `x207-circle-v10d.testnet` (owner `x207v10.sputnikv2.testnet`) | **passed** in one run | 9 |
| `tests/testnet-rehearsal-v10.live.test.ts`: five members, two bundles (ring and quick barter), clearing, residual, finalize, claims, `prune_epoch`, the claim that was left | `x207-circle-v10s.testnet` | **stopped** at 39 steps (HTTP 520 of the RPC); the epoch was finished by `tests/testnet-v10-finish.live.test.ts` (**passed**, 9 steps) | 39 + 9 |

The rehearsal test did **not** pass in one uninterrupted run. Two circles before `v10s` (`x207-circle-v10`, `x207-circle-v10r`) were also cut short. So UM-074 stays partial: what is missing is one run of the rehearsal test from the first to the last step.

## The runs that failed, and what they mean
| Circle | Stop | Meaning |
| --- | --- | --- |
| `x207-circle-v10` run 1 | `fetch failed`, `ConnectTimeoutError` after 33 steps | The test's `patient()` retried only HTTP 429. Not the contract. |
| `x207-circle-v10` run 2 | `IndexerHaltError` (8 edges in the event, 0 in D9) | The resumed run did not feed the indexer the transactions of run 1. The indexer stopped instead of guessing, as designed. Fixed in the test (`X207_REHEARSAL_PRIOR`). |
| `x207-circle-v10` run 3 | `ERR_BUNDLE_HEADROOM: budi needs 93000000 headroom 27000000` | The unfinished epoch 1 still held its debt, so the headroom of the next epoch was smaller. **This is the contract doing its job**, not a bug; the test cannot continue an epoch that stopped half way. |
| `x207-circle-v10r` | `SocketError: other side closed` after 37 steps | `patient()` did not retry it. Fixed: network errors and HTTP 5xx are retried now. |
| `x207-circle-v10s` | `block: "HTTP 520"` after 39 steps | Same class (a 5xx of the free RPC). The continuation test finished the epoch, with a time limit per step so that it fails by name and does not hang. |

No error of the contract 0.0.9 appeared in any run. All of them are errors of the network or of the test.

## The new step: `prune_epoch`, and the claim that was not taken
On `x207-circle-v10s`, epoch 2, finalized: two creditors claimed, one claim was held back. Then four calls of `prune_epoch` (`max_items` 20) by an ordinary member removed **43 entries** (8 obligations among them); `list_obligations` of the epoch was empty afterwards, and `list_positions` was **identical** to what it was before. The creditor that had waited then claimed and its position became `claimed`. Hashes: the steps `prune_epoch` and `claim after prune_epoch` of the run "continuation on v10s" in `testnet-v10.json`.

## Difference from the rehearsals of 0.0.7
- 0.0.7: the rehearsal on `x207-circle-v7` (`docs/testnet-rehearsal-v7.json`, 27 steps), F8 on v9 (`docs/testnet-f8-v9.json`, 53 steps) and the DAO on v8 (`docs/testnet-dao-v8.json`, 13 steps) each ended in a run that reached the end. In 0.0.9 F8 (41 steps) and the DAO test (9 steps) also passed in their first run. The step counts are not comparable (the tests were edited between the runs and a step is whatever the recorder of that test wrote), so no claim about the contract is drawn from them.
- New in 0.0.9 and shown on testnet: class A with the scope of 0.0.8 (the NFT contract and the token are named in the grant), `prune_epoch` followed by a claim. `mt_on_transfer` and `withdraw_intents_balance` did **not** run here: `intents.testnet` has no code, so they were tested only against a mock in near-sandbox.
- The rehearsal test needed three changes to the test code before it got to the end of an epoch (retry of network errors and 5xx, feeding earlier transactions to the indexer, a limit of time per step). None of them changed the contract.

## The wasm is a local build, not a release
All circles run `code_hash` `6RjnJBmJDFCQJRCcmcN3rqv2a8gQdqYygsfT2iRu36C4`, which is the sha256 of the wasm that was built on this machine (`cargo near build non-reproducible-wasm`). The reproducible build of the same sources gives another number (`B3siH351r8z2q6fwqHmhGkUeaTSPznHhUwTmPoTzeJeX`, hex `95515ee8f759...`, checked on a GitHub runner), so this rehearsal does not show that the code on chain is the code of a tag. A rehearsal or a mainnet deployment that is meant to prove that deploys the wasm **downloaded from the release** (`contracts/docs/verify-release.md`).

## Not covered
Real Intents (`mt_on_transfer`, `withdraw_intents_balance` on testnet), mainnet, a run of the rehearsal test without a stop, more than one facilitator, and the unreliability of the free RPC endpoints: it cost this rehearsal four runs, which is a reason to use a paid or own RPC for the demo.
