# Two solvers in one epoch (UM-123, audit KN-15)

Proof on testnet that the contract keeps the better proposal when two independent solvers compete for the same epoch, and refuses the worse and the equal ones. Circle `x207-v013.testnet`, epoch 18, 2026-11-04. Every hash below is in [testnet-epochs/um123-competing-solvers.json](testnet-epochs/um123-competing-solvers.json); the test that made it is `tests/testnet-competing-solvers.live.test.ts` (`X207_TESTNET=1 npx vitest run tests/testnet-competing-solvers.live.test.ts`, about 10 to 25 minutes because it waits for an open epoch and its cutoff).

## The rule

`submit_clearing` is permissionless: anybody may send a proposal while the proposal window (60 s after `close_epoch`) is open. The contract verifies the proposal (only cycles, nothing above the obligations) and stores it **only if it beats the stored one** (`beats_stored`, [contracts/x207-circle/src/verifier.rs](https://github.com/x207-labs/contracts/blob/main/x207-circle/src/verifier.rs)): a larger `cleared_total`, or an equal `cleared_total` with fewer edges. Otherwise it panics with `ERR_PROPOSAL_NOT_BETTER`. `commit_epoch` then applies the stored proposal.

## The graph

Six vouchers among members of the circle: a cycle X (`m00 -> m01 -> m02 -> m00`, 2 credit each, 6 credit cleared), a cycle Y (`m03 -> m04 -> m03`, 1 credit each, 2 credit cleared) and a chain `m05 -> m07` of 1 credit that no cycle can clear. The optimum clears 8 of 9 credit.

## The sequence

| # | Solver | Proposal | cleared_total | Result |
| --- | --- | --- | ---: | --- |
| 1 | solver 1, `x207-v013-aux.testnet` | Y alone | 2 credit | stored (tx `4qYB3CVPAjpWLAFFkW3G2X99ahem3AdNTNtBhahJGtpi`) |
| 2 | solver 2, `solver2.x207rh-keeper.testnet` (an unrelated account) | X and Y | 8 credit | **replaces 1**: the event `clearing_submitted` carries `replaced_solver` `x207-v013-aux.testnet` and `replaced_cleared_total` 2,000,000 (tx `4ww6h7y9YXRgbuDtU2a2QGfdt2MY4oBKoAZ3JXENpeEd`) |
| 3 | solver 1 | X alone | 6 credit | refused: `ERR_PROPOSAL_NOT_BETTER: stored proposal is at least as good` (worse than the stored 8) |
| 4 | solver 1 | X and Y | 8 credit | refused with the same error (equal to the stored one: the first of equals stays) |

After each submission `get_proposal` named the stored one: solver 1 with 2,000,000 after step 1; solver 2 with 8,000,000 and 5 edges after steps 2, 3 and 4.

`commit_epoch` (tx `7v1tBgrcScJAr36a4hisLJZKqfs2wcnVVBi9gVGuZ8aG`) applied the proposal of solver 2: `clearing_applied` with `solver` `solver2.x207rh-keeper.testnet`, `cleared_total` 8,000,000, `edge_count` 5, `edges_hash` `b9c91610...df650`, `solver_fee` 4,000 (booked for the solver that won). The residual of the chain was then paid by `m05` (settle tx `3wQY3Ku5VNctfe8ZSa8mExgXAa8mnjQaq98vTSjYu9YA`).

## What this shows and does not show

- The winner is decided by the contract, not by arrival order: a later, better proposal from an unrelated account replaced an earlier one, and earlier equal or worse proposals could not displace it.
- The tie-break by fewer edges was **not** exercised on testnet (it needs two decompositions with the same total); it is covered by the unit test `beats_stored_tie_break` in the contract.
- The hashes of the two refused transactions are not in the record: `near-api-js` throws when a contract panics and the error carried no hash. The refusal itself is recorded with its error text in the result file and visible in the `get_proposal` view after each step.
- The test needed four runs: the first three failed for reasons of the test, not of the contract (a payee `m06` that had been suspended since the default of UM-106; a run that was killed but whose worker went on and closed the same epoch; the library throwing on the refused calls instead of returning them). Only the last run is in the record.
- Epoch 18 stays in its payment window until about 15:16 UTC; nobody runs a keeper on this circle all the time, so it is finalized by hand (see [join-the-circle.md](join-the-circle.md)).
