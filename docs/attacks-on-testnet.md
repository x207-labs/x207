# Attacks that the contract refused on testnet

Each row is a real transaction sent to the circle `x207-v013.testnet` (interface 0.0.13) on NEAR testnet, from one of the `m00`…`m14.x207-v013-aux.testnet` member accounts of the realistic epoch run ([testnet-0.0.13-realistic.json](testnet-0.0.13-realistic.json)). The contract rejected every one of them and changed no state. The error column is the panic text of the contract, copied from the failed receipt; the transaction link opens the failed transaction in the explorer. This is the chain itself, not a test suite: the last column names the contract tests that cover the same check.

| # | Attack | Sent by | Method | Contract error | Transaction | Covered by test |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | A voucher from m00.x207-v013-aux.testnet to m01.x207-v013-aux.testnet in the open epoch 16, signed with a key that is not the voucher key of the payer | `m05` | `register_cumulative` | `ERR_BAD_SIGNATURE: ed25519 verification failed` | [`B2sk75Aa…`](https://testnet.nearblocks.io/txns/B2sk75AagKQ5kNsFABFxuw81DfWUyx6gTkQ9kXLPurq3) | `contracts/tests/ct025_registration_rules.rs`, unit test in `voucher.rs` |
| 2 | Replay a voucher that the payer really signed and the contract really booked in epoch 8, now that the circle is in a later epoch | `m05` | `register_cumulative` | `ERR_EPOCH_MISMATCH: voucher epoch 8, current 16` | [`9sJXYa1h…`](https://testnet.nearblocks.io/txns/9sJXYa1hfXVTUcnpQ2pDC3tVg8zwrBo4KnSWYAwWYuTk) | `contracts/tests/ct025_registration_rules.rs` |
| 3 | A member account that is not the DAO owner calls set_params to change the fees and the limit cap | `m03` | `set_params` | `ERR_NOT_OWNER: m03.x207-v013-aux.testnet is not the owner` | [`Asx6BQMT…`](https://testnet.nearblocks.io/txns/Asx6BQMTncJa3TwJDXeAHu4uRG9dbkp1nNT87gXW1yGe) | `contracts/tests/ct042_authority.rs` |
| 4 | Call ft_on_transfer directly, as if the USDT contract had delivered a stake of 1,000,000 units to the attacker's member account | `m04` | `ft_on_transfer` | `ERR_WRONG_TOKEN: m04.x207-v013-aux.testnet` | [`9kz4TGUL…`](https://testnet.nearblocks.io/txns/9kz4TGUL554yHisatL4hJTBxmq2B1YSRTZKpujd2ULw6) | `contracts/tests/ct019_onboarding.rs` |
| 5 | The creditor m12.x207-v013-aux.testnet claims its residual of epoch 8 a second time, after the first claim was paid | `m12` | `claim` | `ERR_NOT_CLAIMABLE: m12.x207-v013-aux.testnet is Claimed` | [`7KjR1DhG…`](https://testnet.nearblocks.io/txns/7KjR1DhGrP6gEnMw45tV19ZzLYxpSZpGnqocT49m1RLQ) | `contracts/tests/ct035_claim.rs` |
| 6 | The debtor m02.x207-v013-aux.testnet claims from the pool of epoch 8 | `m02` | `claim` | `ERR_NOT_CREDITOR: m02.x207-v013-aux.testnet` | [`CnY1fdR9…`](https://testnet.nearblocks.io/txns/CnY1fdR9FyDxGBSqQaAdekx62euya62NF9r2BVAhR12N) | `contracts/tests/ct036_residual_flow.rs` |
| 7 | Submit a clearing proposal that cancels 1,000,000 units on an edge that never existed, for the finalized epoch 8 | `m06` | `submit_clearing` | `ERR_WRONG_PHASE: epoch 8 is Finalized, expected Clearing` | [`74aD3tAo…`](https://testnet.nearblocks.io/txns/74aD3tAoETq7cj57YvUcV8j1feRkVnZ3fkcasktg9AeH) | `contracts/tests/ct033_finalize.rs`, `ct036_residual_flow.rs` |
| 8 | An active member withdraws its stake without asking to exit and without the epoch of the exit being finalized | `m07` | `withdraw_stake` | `ERR_EXIT_NOT_READY: m07.x207-v013-aux.testnet has not asked to exit` | [`B1zTtDJK…`](https://testnet.nearblocks.io/txns/B1zTtDJKSxMpjZYCF5ucpZmXfVkgbFk497Ywd3SKmM2z) | `contracts/tests/ct078_exit.rs` |

## What each row shows
1. **Forged signature.** A voucher from `m00` to `m01` in the epoch that was open at that moment, signed with a random key instead of the voucher key of the payer. The contract checks the epoch, the limit and the sequence first and the ed25519 signature after them, so the refusal is `ERR_BAD_SIGNATURE` and not a side effect of an earlier check.
2. **Replay of a real voucher.** The voucher that `m00` signed for epoch 8 (the one booked in the realistic epoch run) is sent again after the circle moved on. The signature is valid; the voucher is bound to its epoch, so it is refused as `ERR_EPOCH_MISMATCH`.
3. **Parameters changed by a non-owner.** `set_params` is owner-only, and the owner of the circle is the DAO. A member account asking for zero fees and a higher limit cap is refused.
4. **Fake deposit.** `ft_on_transfer` is how the USDT contract tells the circle that tokens arrived. Called directly by a person, the caller is not the USDT contract, so no stake is credited (`ERR_WRONG_TOKEN`).
5. **Second claim.** The creditor `m12` had claimed its residual of epoch 8; the position is `Claimed`, so a second claim is refused and the pool pays nothing twice.
6. **Claim by a debtor.** A debtor of epoch 8 asks the pool for money; only creditors can claim (`ERR_NOT_CREDITOR`).
7. **Invented clearing.** A proposal with an edge that never existed, for the finalized epoch 8. The phase check comes first (`ERR_WRONG_PHASE`). The checks on edges (an edge that is not in the snapshot, a cleared amount above the obligation) need an epoch in the clearing phase and are covered by the contract tests, not by this table.
8. **Stake taken out without exit.** An active member calls `withdraw_stake` without `request_exit` (`ERR_EXIT_NOT_READY`).

## What is not in this table
- Attacks that need the circle to be in a particular phase at a given second (a clearing proposal with edges that are not in the snapshot, `commit_epoch` before the proposal deadline) are covered by the contract tests; rows 1 and 2 were sent in a live epoch only because the open phase of a 600-second epoch is long enough for one transaction.
- A refused transaction still costs the sender a little gas; no attack here moved funds or changed the state of the circle.

## Run it again
```bash
node scripts/attacks-testnet.mjs --out docs/attacks-on-testnet.json
```
The script needs the member keys in `.secrets/testnet-deployer/` (`um100-v013.json`), sends the eight transactions, writes the hashes and errors to the JSON file, and stops with an error if the contract ever accepts one of them. The raw record of the run is [attacks-on-testnet.json](attacks-on-testnet.json).
