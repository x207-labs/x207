# CRUD matrix: processes by data stores

Source: DFD Level 1 (processes P1 to P8, stores D1 to D9) and DFD Level 2 of F8 (process P9, stores D10 and D11) in the design vault, with the contract methods and events of interface 0.0.9. Every arrow between a process and a store in the diagram appears below as one or more letters: `C` create, `R` read, `U` update. `D` (delete) is not a letter of this matrix: a deletion is counted under `C U`. The contract deletes a D1 row only in `remove_pending` (a `pending` member without stake, contract 0.0.18), and entries of D2, D3 and D8 only in `prune_epoch` (below; it is not in the 0.0.4 ABI).

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
| P1 / D1 | Create the member row, then activate it | `join` (an EVM member: `join_evm`) creates `pending`; `ft_on_transfer` with the stake action and admission set `active` and the first `limit`; contract 0.0.18 (A-CT-01): `remove_pending` deletes a `pending` row that has no stake, no debt and no withdrawal in flight and frees the slot (the owner at any time, anyone after the garbage-collection delay of a never-admitted row, default 7 days, set by `set_pending_gc_delay`; event `member_removed`), and a `join` in a full circle removes such a row itself; the deletion is counted under the existing `C U` of this cell | `pending` to `active`, or `pending` to removed |
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
| P4 / D5 | Read what is due or claimable, then mark it | `ft_on_transfer` (action `settle`), `mt_on_transfer` (a residual paid through NEAR Intents, same settle logic), `claim` (an EVM member: `claim_evm`; callback `on_claim_resolved_fee` settles the relayer fee and the claim) | `due` to `paid`; `claimable` to `claimed` |
| P4 / D6 | USDT enters the pool on settle and leaves on claim; USDT booked by `mt_on_transfer` stays on `intents.near` until somebody moves it into the pool | `ft_on_transfer`, `mt_on_transfer`, `withdraw_intents_balance` (callback `on_intents_withdrawn`, event `intents_withdrawn`), `claim` (`near` or `intents`), and for EVM members with a relayer fee (0.0.16, 0.0.17) the callbacks `on_claim_resolved_fee`, `on_withdraw_resolved_fee`, `on_action_fee_resolved` and `on_fee_refund_resolved`, which move the fee or refund it to the reserve when the transfer fails; `set_auto_settle_evm` | |
| P4 / D1 | Raise the cash settlement history; a member leaving records `exit_requested_epoch`, then becomes `exited` | `ft_on_transfer`, `mt_on_transfer`, `request_exit`, `withdraw_stake` (an EVM member: `request_exit_evm`, `withdraw_stake_evm`; callbacks `on_withdraw_resolved_fee` and `on_action_fee_resolved`; the opt-in auto-settle flag of an EVM member is set by `set_auto_settle_evm`) | `active` to `exited` |
| P5 / D8 | Record an intent hash and the committed bundle with its per-leg limits; the owner of an intent takes it back and gets the slot of the book back | `post_intent`, `remove_intent`, `commit_bundle` (events `intent_posted`, `bundle_committed`) | bundle `active` |
| P5 / D1 | Reserve headroom for each leg of a bundle; the reservation is a separate key beside D8, not a field of the member row | `commit_bundle` (view `headroom` shows it) | |
| P5 / D1 | The arbiter of a deal with a bond rules: the bond of the guilty party passes to the other party, or both bonds are released | `rule_deal` (event `deal_ruled`; `bond_released` per bond) | bond locked to released or paid |
| P5 / D2 | Register the obligation of a leg against the reserved headroom | `register_in_bundle` | |
| P6 / D5 | Read members that did not pay, mark them | `finalize_epoch` | `due` to `defaulted`; shortfall shares the claims |
| P6 / D6 | Cut the stake of a defaulter, reduce the reserve | `finalize_epoch` | |
| P6 / D1 | Recompute `limit`; suspend a defaulter | `finalize_epoch` | `active` to `suspended` |
| P6 / D7 | Read ratio, growth, cap and decay | `get_params` | |
| P6 / D2, D3, D8 | Housekeeping after the epoch is `finalized`: take the pair entries (D2, D3), the participant totals, and the bundles of the epoch with their reservations (D8) out of the contract storage; the epoch record, the clearing proposal and every position (D5) stay. Anyone may call it; `max_items` bounds the gas and the call is repeated until it answers 0. No letter in the matrix, see the table below | `prune_epoch` (errors `ERR_NOT_FINALIZED`, `ERR_UNKNOWN_EPOCH`) | epoch stays `finalized` |
| P7 / D7 | Replace the parameters from the next epoch | `set_params` (owner DAO), view `get_pending_params` | |
| P7 / D1 | Admit a member when the admission mode is DAO | `admit_member` | `pending` to `active` |
| P8 / D1, D2, D4, D5 | Read all four to build the 207 report and the dashboard | read API of the indexer | |
| P8 / D9 | Append events | indexer handlers | |
| P7 / D10 | Register or replace an asset class of the registry, only by the owner (the DAO) | `set_asset_class` | |
| P9 / D10 | Read the class and the allowed delivery methods and proofs of an asset type when a grant is offered | view `get_asset_class`; `offer_grant` checks it | |
| P9 / D11 | Offer a grant, activate it with the lessee's `delivery_pubkey`, end it. For class A (NFT escrow, interface 0.0.7) the owner deposits the asset, the buyer completes the sale and the grantor can take the asset back | `offer_grant`, `accept_grant`, `revoke_grant` (events `grant_offered`, `grant_activated`, `grant_revoked`); class A: `nft_on_transfer`, `complete_escrow`, `cancel_escrow`, `on_escrow_resolved` (events `escrow_held`, `escrow_failed`); account kind (contract 0.0.18, barter #11 and #14): `account_on_lock` (event `account_escrow_held`), `complete_account_escrow`, `cancel_expired_account_escrow`; view `get_grant`, `grants_of`, `get_escrow`, `get_account_escrow` | `offered`, `active`, `revoked` or `expired` |
| P9 / D3 | The usage voucher of a grant is the latest `seq` of the pair (lessee, grantor); the adapter reads it and the facilitator keeps it | `register_cumulative`; the broker and the adapters only read, they never write D3 | |
| P9 / D2 | The usage voucher becomes an ordinary obligation from the lessee to the grantor, registered like any payment of P2 | `register_cumulative`; the broker never writes D2. For class A, `complete_escrow` registers the buyer's voucher with the same code and `on_escrow_resolved` takes the registration back if the NFT transfer fails. For the account kind, `complete_account_escrow` registers the buyer's voucher the same way | |
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

| P6 x D2, D3, D8 (`prune_epoch`) | no cell | `prune_epoch` **removes** entries of D2, D3 and D8, and also pops the epoch's own indexes of edges, participants and bundle ids (the analysis also lists D4, D6 and D7 because the function reaches the shared epoch record; that record keeps its counts, as the module doc of `prune.rs` says) | The letters of this matrix are C, R and U (a test checks it), so the deletion has no letter and no cell is added to the matrix: the DFD has no arrow from P6 to D2, D3 or D8. The method is named in the explanation row `P6 / D2, D3, D8`, where the deletion is written in words. After the call, `obligation`, `list_obligations` and `get_bundle` of that epoch answer empty, which P8 and P3 must not rely on for a finalized epoch that has been pruned. |
| P4 x D5, D6, D1 (`mt_on_transfer`) | `ft_on_transfer` only | `mt_on_transfer` runs the same settle logic for a residual paid through NEAR Intents (only `intents_id` may call it), so it writes what the settle action of `ft_on_transfer` writes | Matrix fixed: `mt_on_transfer` is in the cells P4 / D5, D6 and D1; the letters did not change. The listed D2, D4 and D7 come from shared functions and are not new writes of P4. |
| P4 x D6 (`withdraw_intents_balance`, `on_intents_withdrawn`) | no cell | The USDT that `mt_on_transfer` booked is moved from `intents.near` into the NEP-141 balance of the contract; the callback `on_intents_withdrawn` closes it and emits `intents_withdrawn` | Matrix fixed: named in the cell P4 / D6, letter unchanged (`U`). The analysis finds no D1 to D8 store written by these two, so the test does not list them; they are named for completeness. |
| P5 x D8 (`remove_intent`) | `post_intent`, `commit_bundle` | `remove_intent` deletes one intent entry of the owner and frees the slot (`ERR_UNKNOWN_INTENT`, `ERR_NOT_INTENT_OWNER`) | Matrix fixed: named in the cell P5 / D8; a deletion of one entry is counted under the existing `C U` of that cell. |
| P9 x D1 (`complete_account_escrow`, contract 0.0.18) | empty | For the sale of a member account (#14) the call replaces the `pubkey_voucher` of the member row with the buyer's key (and the sale waits until the earlier epochs are `finalized`); the analysis also lists D2, D3, D4, D6, D7 and D8 through shared functions | Not added to the letters of the matrix: the DFD has no arrow from P9 to D1 and this is a change of the member row on a delivery. The method is named in the cells P9 / D11 and P9 / D2. The DFD Level 2 of F8 needs the arrow if it is to be drawn. |
| P7 x D7 (`set_max_escrow_ttl`, `set_pending_gc_delay`, `set_locker_code_hashes`) | no cell | The three owner calls keep their value in keys of their own (`account_escrow.rs`, `pending.rs`), not in the epoch parameters, so the analysis finds no D1 to D8 store written by them | Not added: they change no store of the matrix. They are the owner's parameters of 0.0.18 (CT-129 limit on the escrow time, A-CT-01 delay, locker code hashes) and are not part of the parameter snapshot of D7 (`get_params`). |
| P7 x D1 (`admit_member`) | `admit_member` | The analysis did not see the write of `admit_member` after `cargo fmt` split `self.members.get_mut(..)` over three lines | The analysis (`tests/support/contract-writes.ts`) now accepts white space and line breaks around the dots; the cell is unchanged. The test is not weaker: it finds a write it missed. |

Cells D9: the indexer (`backend/src/indexer/handlers/`) writes `events_raw` and the read model; the contract does not write D9.

## Checks

The matrix was built from the arrows of the Level 1 data flow diagram (8 processes, 9 stores, 33 arrows between a process and a store) and the Level 2 diagram of F8 (asset access adaptor) (process P9, stores D10 and D11, 7 arrows) plus the arrow P7 to D10 that the note of F8 states in words (D10 is written only by governance), so 9 processes, 11 stores and 41 arrows. An arrow into a store needs `C` or `U`; an arrow out of a store needs `R`; every cell with letters must come from an arrow. The test `tests/crud-matrix.test.ts` parses this file and checks it against the arrow list in the test, so a new arrow in the diagram must change both. The design note is not read by the test, so the list in the test is the copy that has to follow the diagram.
