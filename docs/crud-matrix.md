# CRUD matrix: processes by data stores

Source: DFD Level 1 (processes P1 to P8, stores D1 to D9) in the design vault, with the contract methods and events of interface 0.0.4. Every arrow between a process and a store in the diagram appears below as one or more letters: `C` create, `R` read, `U` update. `D` (delete) does not occur: the contract never deletes a row of D1 to D6, and `prune_epoch` is not in the 0.0.4 ABI.

A letter means "the process does this to the store in at least one step". The status names are the fixed ones of ADR-26: D1 `pending`, `active`, `suspended`, `exited`; D5 debtor `due` then `paid` or `defaulted`, creditor `claimable` then `claimed`.

| | D1 Members | D2 Obligations | D3 Vouchers | D4 Clearing log | D5 Settlements | D6 Stake pool | D7 Parameters | D8 Intent book | D9 Event index |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **P1 Onboarding and stake** | C U | | | | | C U | R | | |
| **P2 Pay with credit** | R | C U | C U | | | | R | | |
| **P3 Multi-party clearing** | | R U | | C | C | | R | | R |
| **P4 Residual settlement** | U | | | | R U | U | | | |
| **P5 Barter bundle** | U | C U | | | | | | C U | |
| **P6 Risk and limits** | U | | | | R U | R U | R | | |
| **P7 Governance** | U | | | | | | U | | |
| **P8 Reporting and index** | R | R | | R | R | | | | C |

## What each cell means

| Cell | Operation | Contract method or event | Status names |
| --- | --- | --- | --- |
| P1 / D1 | Create the member row, then activate it | `join` creates `pending`; `ft_on_transfer` with the stake action and admission set `active` and the first `limit` | `pending` to `active` |
| P1 / D6 | Add the stake to the pool | `ft_on_transfer` (action `stake`) | stake per member |
| P1 / D7 | Read admission and `base_limit_ratio` | `get_params` | |
| P2 / D1 | Read the voucher key, status and limit to check a voucher | view `member`, `headroom` | only `active` members pay |
| P2 / D2 | Add to the obligation of a pair for the epoch | `register_cumulative` (default) or `register_voucher` (demo mode) | creates the edge on its first voucher, then raises `cumulative` |
| P2 / D3 | Record the latest `seq` per pair | `register_cumulative`; the facilitator keeps unregistered vouchers in its pending store | |
| P2 / D7 | Read epoch and unit for the 402 answer | `get_params`, `get_epoch` | |
| P3 / D2 | Read the cutoff snapshot, then reduce obligations by the cleared amounts | `close_epoch`, `commit_epoch` | |
| P3 / D4 | Store the best proposal, the solver and the cleared total | `submit_clearing`; `commit_epoch` | |
| P3 / D5 | Create the net positions of the epoch | `commit_epoch` | debtor `due`, creditor `claimable` |
| P3 / D9 | The solver reads the cutoff snapshot from the index | `epoch_cutoff`, read API `.../obligations?stage=cutoff` | |
| P4 / D5 | Read what is due or claimable, then mark it | `ft_on_transfer` (action `settle`), `claim` | `due` to `paid`; `claimable` to `claimed` |
| P4 / D6 | USDT enters the pool on settle and leaves on claim | `ft_on_transfer`, `claim` (`near` or `intents`) | |
| P4 / D1 | Raise the cash settlement history; a member leaving becomes `exited` | `ft_on_transfer`, `withdraw_stake` | `active` to `exited` |
| P5 / D8 | Record an intent hash and the committed bundle with its per-leg limits | `post_intent`, `commit_bundle` (events `intent_posted`, `bundle_committed`) | bundle `active` |
| P5 / D1 | Reserve headroom for each leg of a bundle | `commit_bundle` (view `headroom` shows it) | |
| P5 / D2 | Register the obligation of a leg against the reserved headroom | `register_in_bundle` | |
| P6 / D5 | Read members that did not pay, mark them | `finalize_epoch` | `due` to `defaulted`; shortfall shares the claims |
| P6 / D6 | Cut the stake of a defaulter, reduce the reserve | `finalize_epoch` | |
| P6 / D1 | Recompute `limit`; suspend a defaulter | `finalize_epoch` | `active` to `suspended` |
| P6 / D7 | Read ratio, growth, cap and decay | `get_params` | |
| P7 / D7 | Replace the parameters from the next epoch | `set_params` (owner DAO), view `get_pending_params` | |
| P7 / D1 | Admit a member when the admission mode is DAO | `admit_member` | `pending` to `active` |
| P8 / D1, D2, D4, D5 | Read all four to build the 207 report and the dashboard | read API of the indexer | |
| P8 / D9 | Append events | indexer handlers | |

## Beyond the nine stores

Stores D10 (asset class registry) and D11 (access grants) belong to the F8 process P9 and D12 (listings and offers) to the F9 marketplace module M11; they are outside this matrix. D12 is an off-chain database written by the backend module `backend/src/marketplace/` (tables `listings`, `offers`, `matches`, `bundle_proposals`), and only the bundle hash reaches D8 on chain.

## Checks

The matrix was built from the arrows of `07 DFD/x207 - DFD Level 1.md`: 8 processes, 9 stores and 33 arrows between a process and a store. An arrow into a store needs `C` or `U`; an arrow out of a store needs `R`; every cell with letters must come from an arrow. The test `tests/crud-matrix.test.ts` parses this file and checks it against the arrow list in the test, so a new arrow in the diagram must change both. The vault note is not read by the test, so the list in the test is the copy that has to follow the diagram.
