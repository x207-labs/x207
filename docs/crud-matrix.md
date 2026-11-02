# CRUD matrix: processes by data stores

Source: DFD Level 1 (processes P1 to P8, stores D1 to D9) and DFD Level 2 of F8 (process P9, stores D10 and D11) in the design vault, with the contract methods and events of interface 0.0.7. Every arrow between a process and a store in the diagram appears below as one or more letters: `C` create, `R` read, `U` update. `D` (delete) does not occur: the contract never deletes a row of D1 to D6, and `prune_epoch` is not in the 0.0.4 ABI.

A letter means "the process does this to the store in at least one step". The status names are the fixed ones of ADR-26: D1 `pending`, `active`, `suspended`, `exited`; D5 debtor `due` then `paid` or `defaulted`, creditor `claimable` then `claimed`.

| | D1 Members | D2 Obligations | D3 Vouchers | D4 Clearing log | D5 Settlements | D6 Stake pool | D7 Parameters | D8 Intent book | D9 Event index | D10 Asset classes | D11 Access grants |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **P1 Onboarding and stake** | C U | | | | | C U | R | | | | |
| **P2 Pay with credit** | R | C U | C U | | | | R | | | | |
| **P3 Multi-party clearing** | | R U | | C | C | | R | | R | | |
| **P4 Residual settlement** | U | | | | R U | U | | | | | |
| **P5 Barter bundle** | U | C U | | | | | | C U | | | |
| **P6 Risk and limits** | U | | | | R U | R U | R | | | | |
| **P7 Governance** | U | | | | | | U | | | U | |
| **P8 Reporting and index** | R | R | | R | R | | | | C | | |
| **P9 Access asset adapter** | | U | R U | | R | | | | | R | C R U |

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
| P4 / D1 | Raise the cash settlement history; a member leaving records `exit_requested_epoch`, then becomes `exited` | `ft_on_transfer`, `request_exit`, `withdraw_stake` | `active` to `exited` |
| P5 / D8 | Record an intent hash and the committed bundle with its per-leg limits | `post_intent`, `commit_bundle` (events `intent_posted`, `bundle_committed`) | bundle `active` |
| P5 / D1 | Reserve headroom for each leg of a bundle; the reservation is a separate key beside D8, not a field of the member row | `commit_bundle` (view `headroom` shows it) | |
| P5 / D2 | Register the obligation of a leg against the reserved headroom | `register_in_bundle` | |
| P6 / D5 | Read members that did not pay, mark them | `finalize_epoch` | `due` to `defaulted`; shortfall shares the claims |
| P6 / D6 | Cut the stake of a defaulter, reduce the reserve | `finalize_epoch` | |
| P6 / D1 | Recompute `limit`; suspend a defaulter | `finalize_epoch` | `active` to `suspended` |
| P6 / D7 | Read ratio, growth, cap and decay | `get_params` | |
| P7 / D7 | Replace the parameters from the next epoch | `set_params` (owner DAO), view `get_pending_params` | |
| P7 / D1 | Admit a member when the admission mode is DAO | `admit_member` | `pending` to `active` |
| P8 / D1, D2, D4, D5 | Read all four to build the 207 report and the dashboard | read API of the indexer | |
| P8 / D9 | Append events | indexer handlers | |
| P7 / D10 | Register or replace an asset class of the registry, only by the owner (the DAO) | `set_asset_class` | |
| P9 / D10 | Read the class and the allowed delivery methods and proofs of an asset type when a grant is offered | view `get_asset_class`; `offer_grant` checks it | |
| P9 / D11 | Offer a grant, activate it with the lessee's `delivery_pubkey`, end it. For class A (NFT escrow, interface 0.0.7) the owner deposits the asset, the buyer completes the sale and the grantor can take the asset back | `offer_grant`, `accept_grant`, `revoke_grant` (events `grant_offered`, `grant_activated`, `grant_revoked`); class A: `nft_on_transfer`, `complete_escrow`, `cancel_escrow`, `on_escrow_resolved` (events `escrow_held`, `escrow_failed`); view `get_grant`, `grants_of`, `get_escrow` | `offered`, `active`, `revoked` or `expired` |
| P9 / D3 | The usage voucher of a grant is the latest `seq` of the pair (lessee, grantor); the adapter reads it and the facilitator keeps it | `register_cumulative`; the broker and the adapters only read, they never write D3 | |
| P9 / D2 | The usage voucher becomes an ordinary obligation from the lessee to the grantor, registered like any payment of P2 | `register_cumulative`; the broker never writes D2. For class A, `complete_escrow` registers the buyer's voucher with the same code and `on_escrow_resolved` takes the registration back if the NFT transfer fails | |
| P9 / D5 | Read whether the lessee is `defaulted` to revoke the access | view `net_position`; event `member_defaulted` | `defaulted` |

## Beyond the eleven stores

Stores D10 (asset class registry) and D11 (access grants) are in the matrix since F8 (UM-065). D12 (listings and offers) to the F9 marketplace module M11; it is outside this matrix. D12 is an off-chain database written by the backend module `backend/src/marketplace/` (tables `listings`, `offers`, `matches`, `bundle_proposals`), and only the bundle hash reaches D8 on chain.

## Differences found and decided (UM-047)

`tests/crud-implementation.test.ts` reads the Rust source of `contracts/x207-circle/src` (without the test modules) and the 0.0.4 ABI, follows each public method through the functions it calls, and lists which stores it writes. It is a static approximation: functions with the same name in two files are merged, and `epochs` holds D4, D6 and D7 together. What it found:

| Cell | Matrix said | Implementation | Decision |
| --- | --- | --- | --- |
| P4 x D1 | `withdraw_stake` only | `request_exit` also writes the member row (`exit_requested_epoch`) | Matrix fixed: `request_exit` is now in the cell. |
| P5 x D1 | `U`: reserve headroom for each leg | `commit_bundle` writes the bundle (D8) and a separate reserve key (`reserves()` in `bundle.rs`), and does not write the member row; `headroom` subtracts the reserve | Letter kept as `U` because the DFD has the arrow P5 to D1 and the member's usable headroom changes. The reserve key is not in D1, and the cell text says so. |
| P2 x D1 | `R` only | `register_cumulative`, `register_voucher` and `register_in_bundle` reach a function that rewrites the member row for lazy status sync (reactivation, ADR-30) | Kept as `R`: that write is housekeeping on a first touch, not a flow of P2. A change of this code that makes P2 write other member fields must change the cell. |
| P2 x D8 | empty | `register_in_bundle` updates the registered amount of the bundle leg (D8) | Not added: the DFD has no arrow P2 to D8. The bundle leg is covered by the P5 / D2 cell, which names `register_in_bundle`. |

Cells D9: the indexer (`backend/src/indexer/handlers/`) writes `events_raw` and the read model; the contract does not write D9.

## Checks

The matrix was built from the arrows of `07 DFD/x207 - DFD Level 1.md` (8 processes, 9 stores, 33 arrows between a process and a store) and `07 DFD/x207 - DFD Level 2 F8 Adaptor Aset Akses.md` (process P9, stores D10 and D11, 7 arrows) plus the arrow P7 to D10 that the note of F8 states in words (D10 is written only by governance), so 9 processes, 11 stores and 41 arrows. An arrow into a store needs `C` or `U`; an arrow out of a store needs `R`; every cell with letters must come from an arrow. The test `tests/crud-matrix.test.ts` parses this file and checks it against the arrow list in the test, so a new arrow in the diagram must change both. The vault note is not read by the test, so the list in the test is the copy that has to follow the diagram.
