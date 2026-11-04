# Changelog of the contract interface (`x207-circle`), 0.0.1 to 0.0.13

For reviewers and for users of the SDK. This file is the interface of the circle contract, version by version: methods, events, error codes, decisions, and whether a circle that already runs the previous version needs a migration. It is written from the Interface Spec of the contract (`vault/14 x207/04 Arsitektur/x207 - Spec Antarmuka Kontrak.md`, sections 1, 14 to 18), from the history of `abi.json` and from the commits of the repository `contracts`. Where the sources do not say something, this file says so; it does not fill the gap.

**How versions work (spec section 1, rules of the `0.0.x` freeze).** While the version is `0.0.x`, every change that an outside caller can see raises the patch number: the name or arguments of a method, the return type of a view, a field of an event, an error code, the `msg` schema, the byte format of a voucher. The view `interface_version()` returns the version, and the field `version` of every NEP-297 event (`standard: "x207"`) carries it. A consumer refuses an event with a higher minor than it knows and ignores fields it does not know. The first release tagged `v0.1.0` changes the rule: after it, a minor raises for a break and a patch for a compatible addition. The SDK pins the version it was generated from: `X207_CIRCLE_ABI_VERSION` in `sdk/packages/core/src/contract/types.generated.ts` (today `"0.0.11"`, pinned from `contracts` `6d9ef76`; `be4da8f` has the same ABI).

**Releases and reproducibility.** A release is a tag `vX.Y.Z` of the repository `contracts` with `x207-circle-vX.Y.Z.wasm`, `abi-vX.Y.Z.json` and `SHA256SUMS`. GitHub has the releases `v0.0.4` to `v0.0.9` and `v0.0.11`. There is no tag for `0.0.1`, `0.0.2`, `0.0.3` and `0.0.10`: those are interface versions only (the methods of `0.0.10` are in `v0.0.11`).

| Release | Reproducible build | Basis |
| --- | --- | --- |
| `v0.0.4`, `v0.0.5`, `v0.0.6`, `v0.0.7`, `v0.0.8` | **No** | Built on a developer machine or by the earlier workflow, before the pinned container existed. `Cargo.toml` at each of these tags has no `reproducible_build` section (checked for `v0.0.7` and `v0.0.8`), and `contracts/docs/verify-release.md` says that versions up to `v0.0.7` are not reproducible. The `code_hash` of a deployment of these versions cannot be tied to the source of the tag. |
| `v0.0.9` (tag on `b9236b1`, published 2026-11-03 07:25 UTC) | **Yes, the first** | Built twice in a pinned container (image by digest, `cargo near build non-reproducible-wasm --locked`, `Cargo.lock` committed); the release workflow publishes nothing if the two sha256 differ. `SHA256SUMS` of the release: wasm `fa8309059a84…` (full value in the file), ABI file `ea01ea625262…`; `shasum -a 256 -c SHA256SUMS` passes on the downloaded files. The coordinator reports the same wasm sha256 from the two builds of the runner; two builds of ours in the container at `1f9b618` gave the same value too. The earlier proof run (41575069378, CT-087) built another commit twice with `95515ee8f759…`. How to check a `code_hash`: `contracts/docs/verify-release.md`. Limit: the repository is private, so a third-party verifier such as SourceScan may compute another number until it is public. |
| `v0.0.11` (tag on `be4da8f`) | **Yes** | Built in the same pinned container and checked the same way. Reported by the coordinator: wasm sha256 `a9d0c839149a6e84ce4f87c1898b2cf871d2eda117f1988e13d0c59ae13a2f39`, which as a NEAR `code_hash` (base58) is `CRtYqTc47ADcDkHp7UJaRPLXu5XHS7KYftrTNUnZ8bNx`; the release is https://github.com/x207-labs/contracts/releases/tag/v0.0.11. The release carries the interface `0.0.10` (token escrow, CT-090 and CT-091) and `0.0.11` (multi-token escrow, CT-092). Same limit as `v0.0.9`: the repository is private, so a third-party verifier may compute another number until it is public. How to check a `code_hash`: `contracts/docs/verify-release.md`. |

A rehearsal or a mainnet deployment uses the wasm of a release and records its `code_hash` ([docs/mainnet-runbook.md](docs/mainnet-runbook.md)).

Dates are those of the commits (UTC+07:00). "Commit" is the commit of the repository `contracts` in which the version appears in `abi.json`.

---

## 0.0.13 (not released; in progress in `contracts`, 2026-11-03, CT-099)

**Why.** NEAR limits the total log of one receipt to 16,384 bytes. `commit_epoch` wrote every edge (`clearing_applied`, chunks of 50) and every position (`epoch_committed`), so it failed with `TotalLogLengthExceeded` at about 180 edges (50 character names; about 100 with 64 character names) although `submit_clearing` accepts 300 (`MAX_EDGES_PER_TX`). A proposal that the verifier accepted could therefore never be committed. Found by the gas report (CT-098, `contracts/docs/gas.md`). Principle of the fix: **every proposal that `submit_clearing` accepts can be committed.**

**Changed (events; readers must change)**
- `clearing_applied` is now `{epoch, solver, cleared_total, edge_count, edges_hash, clearing_fee, solver_fee}`. The fields `edges`, `chunk` and `chunks` are **removed**. `edges_hash` is the sha256 of the compact JSON of the edges with `cleared > 0`, sorted by (debtor, creditor) as byte strings.
- `epoch_committed` is now `{epoch, committed_at, payment_deadline, total_due, total_claimable, position_count, positions_hash, positions}`: all positions in **one** log (at most `MAX_MEMBERS` = 64), `chunk` and `chunks` **removed**. `positions_hash` is the sha256 of the compact JSON of the positions sorted by account id. The definitions and a golden vector are in `contracts/tests/vectors/clearing_hashes.json`, written and checked by `contracts/scripts/clearing_hashes.py` and compared with the contract by `ct099_hash_vectors`.
- Log budget: with names of 64 characters and amounts of 13 digits the two logs of `commit_epoch` are about 13 KB, under 90 percent of the 16,384 bytes (a unit test and the sandbox tests keep it so).

**Added**
- View `get_proposal(epoch, from_index, limit)`: a page of the stored proposal (`solver`, `cleared_total`, `committed`, `edge_count`, `edges`) before `commit_epoch`. After the commit the edges are gone from it and `list_obligations` gives `cleared` per pair.

**Not changed:** `clearing_submitted` (already a summary), `finalize_epoch` (its log budget cuts `member_defaulted` events first, tested with 63 defaults and names of 64 characters), `commit_bundle` (64 legs with names of 64 characters stay under the budget). The limit of 300 edges per proposal stays; SV-019 shows what it costs on dense circles (`solver/docs/benchmark.md`).

**Review findings of batch 8, fixed before the release (still 0.0.13)**
- B8-F1 (Medium): new parameter `prune_delay_epochs` (default 2, range 1 to 30, in `get_params`, `set_params` and `params_updated`; set with the usual timelock). `prune_epoch` is refused with `ERR_PRUNE_TOO_EARLY` until the running epoch is that many epochs after the pruned epoch, so the cleared edges stay readable from `list_obligations` for a late reader. Stored in its own raw key; no stored record changes.
- B8-F2: `get_proposal.edge_count` is the stored count (it was `0` after the commit).
- B8-F3: `get_proposal` has `proposal_hash` (the `edges_hash` of the stored edges, equal to the one in `clearing_applied`), so a reader that pages notices a replaced proposal.
- B8-F4: the log size test uses the worst entry and asserts the digit bounds.

**Upgrade from 0.0.12:** no migration; the stored data is the same. Indexers and SDK parsers must read the new shape of the two events and read the edges through the views (the indexer verifies them with `edges_hash`).

## 0.0.12 (not released; in progress in `contracts`, 2026-11-03, ADR-43)

Rules of conduct: a frozen member (CT-095), official contracts per asset type (CT-096), a bond with an arbiter (CT-094). The design is `contracts/docs/rules-0.0.12.md`. A section is added here with each of the three when it is built.

### CT-094: bond of both sides, with an arbiter
**Added**
- `BundleInput` takes optional `arbiter`, `agreement_hash` and `confirm_by` (ns, between commit + 1 hour and + 14 days). They enter the signed terms after `search_leg` only when an arbiter is present, so the `terms_hash` of a bundle without a deal is the one of 0.0.11.
- Methods `confirm_deal(bundle_id)`, `dispute_deal(bundle_id, evidence_hash)`, `rule_deal(bundle_id, verdict)` (verdict `accused_guilty`, `complaint_false` or `no_fault`; the arbiter only), `settle_deal(bundle_id)` (anybody). Views `get_deal`, `bond_locked`.
- Events `bond_locked`, `deal_confirmed`, `deal_disputed`, `deal_ruled`, `bond_slashed`, `bond_released {reason}` with reason `confirmed`, `elapsed`, `arbiter_silent` or `ruling`.
- Parameters `bond_threshold` (default 100 credit) and `bond_bps` (default 2000, that is 20 percent of the value of the bundle), set with `set_params` (the usual timelock). They are kept in raw keys, because the Borsh `Params` inside each `Epoch` record cannot change.
- Storage: `StorageKey::Deals` (`d`), raw keys `x207_bond_locked:<account>`, `x207_deal_count:<account>`, `x207_rules`, `x207_rules_pending`. Errors `ERR_BOND_REQUIRED`, `ERR_BOND_LOCKED`, `ERR_DEAL_LIMIT` and the deal errors listed in `abi.json`.

**Changed (behaviour)**
- A bundle of two participants whose largest owed amount is at or above `bond_threshold` needs an arbiter and `confirm_by`. Each side locks a bond on its stake (the limit is bounded by `stake - bond_locked`); `request_exit` and `withdraw_stake` are refused with `ERR_BOND_LOCKED` while a bond is held. A member has at most 8 open deals.
- `complaint_false`: half of the complainant's bond goes to the stake of the accused, the rest is released. A silent arbiter (7 days after the dispute) releases all bonds.

**Limits (written, not hidden)**
- A ring of three or more participants has **no bond** in 0.0.12.
- Open deals of a frozen member continue, and a frozen arbiter may still rule.

**Join deposit (changed):** `JOIN_STORAGE_DEPOSIT` goes from 0.32 to **0.35 NEAR** (ADR-41). The worst case of one member grows by 2,954 bytes to 34,236 bytes (0.3424 NEAR), measured by `ct062_storage_per_member`, which now fails if the deposit does not cover it. Members who joined with 0.32 are not asked for more. SDK and onboarding code must send 0.35.

**Upgrade from 0.0.11:** no data migration. `get_params` shows the two new fields with their defaults until the owner sets them (`ct094_upgrade_from_0_0_11`).

### CT-095: `freeze_member`
**Added**
- `propose_freeze(account_id, reason_hash?)` (owner), `apply_freeze(account_id)` (anybody, after the timelock of 24 hours), `cancel_freeze(account_id)` (owner, while pending), `unfreeze_member(account_id)` (owner, at once). Views `get_freeze`, `is_frozen`.
- Events `freeze_proposed {account_id, eta, reason_hash}`, `member_frozen {account_id, from_epoch}`, `freeze_cancelled`, `member_unfrozen`.
- Errors `ERR_FREEZE_PENDING`, `ERR_FREEZE_NOT_PENDING`, `ERR_FREEZE_TIMELOCK`, `ERR_ALREADY_FROZEN`, `ERR_NOT_FROZEN`, `ERR_FROZEN`, `ERR_BAD_HASH`.
- Storage: a raw key `x207_freeze:<account>`; `Member` is unchanged.

**Changed (behaviour)**
- A frozen member is refused `commit_bundle` (any participant), `post_intent`, `offer_grant`, `accept_grant` and `complete_escrow` at once (`ERR_FROZEN`). `register_cumulative`, `register_voucher` and `register_in_bundle` refuse a frozen payer or payee only for a voucher of an epoch **after** the epoch in which the freeze took effect, so a seller that already handed over its goods can still register the voucher of a frozen buyer until the cutoff of that epoch.
- A frozen member can still pay a residual, claim, add stake, `request_exit`, `withdraw_stake`, `cancel_escrow`, `revoke_grant`, `remove_intent`. No money moves by a freeze (ADR-20).
- A pending freeze blocks nothing.

**Upgrade from 0.0.11:** no migration for this part.

### CT-096: official contracts per asset type
**Added**
- `set_asset_contracts(asset_type, contracts)` (owner; the type must be registered with class `A`; at most 16 distinct accounts; an empty vector clears the list) and the view `get_asset_contracts(asset_type)`. Event `asset_contracts_set {asset_type, contracts}`. Errors `ERR_ASSET_CLASS_NOT_A`, `ERR_TOO_MANY_CONTRACTS`, `ERR_DUPLICATE_CONTRACT`, `ERR_CONTRACT_NOT_OFFICIAL`.
- Storage: `StorageKey::AssetContracts` (`w`), a side map; `AssetClassEntry` is unchanged.

**Changed (behaviour)**
- With a non-empty list for the asset type of a grant, `offer_grant` refuses a class A scope that names another contract, and `nft_on_transfer`, `ft_on_transfer` (escrow action) and `mt_on_transfer` (escrow action) refuse a deposit from another contract (the multi-token receiver hands everything back by its answer and logs the reason). An empty list, which is the default, is the behaviour of 0.0.11. A held escrow is not touched by a change of the list.

**Upgrade from 0.0.11:** no migration for this part.

## 0.0.11 (released as `v0.0.11`, tag on `be4da8f`, reproducible; first written in `6d9ef76`, 2026-11-03)

Class A escrow of an exact amount of one NEP-245 multi-token (CT-092). A new interface version because it adds a view, an event and three errors, and `0.0.10` was already pinned by the SDK.

**Added**
- `mt_on_transfer` takes a new action, `{"action":"escrow","grant_id":N}`, from any multi-token contract (the `settle` action keeps its own checks: only `intents_id`, only `nep141:<usdt>`). The grantor of a class A grant deposits the token with `mt_transfer_call`; `complete_escrow` pays the buyer with `mt_transfer`, and when that fails the registration of the buyer's voucher is taken back exactly, as for NFTs and tokens of NEP-141.
- The scope of a class A grant for a multi-token is `{"mt_contract": ..., "token_id": ..., "amount": ...}` (`amount` in the units of that token, decimal text). The deposit must be exactly this contract, token and amount.
- View `get_mt_escrow(grant_id) -> {grant_id, mt_contract, token_id, amount, state, buyer} | null`; event `mt_escrow_held { grant_id, mt_contract, token_id, amount }` (35 events in total). The stored escrows of NFTs and NEP-141 tokens are unchanged (the new map has its own storage key).
- Reasons of refusal: `ERR_ESCROW_MT_MISMATCH` (other contract or token than the scope), `ERR_ESCROW_MT_AMOUNT` (other amount), `ERR_ESCROW_MT_BATCH` (a deposit with more than one token, one amount or one owner). From `7b57f7b` (in `be4da8f`) a refused deposit is **not a panic**: `mt_on_transfer` logs the reason and returns every amount as unused, so the multi-token contract gives the tokens back whatever it does with a failed receipt. The caller must be the `mt_contract` named in the scope.
- This is the way to trade a balance held at NEAR Intents (a multi-token such as `nep141:<usdt>`) or a pool share as a barter good.
- SDK: `get_mt_escrow` and `mt_escrow_held` in the pinned ABI, `mtEscrowGrantScope`, `buildMtEscrowDepositCall`, `KNOWN_EVENT_VERSION` 0.0.11.

**Tested by the contract owner:** `ct092_mt_escrow` (4 sandbox tests), `ct092_intents_sequence` (settle, then escrow, then refused escrows, then settle through `intents_id`) with `probes/mock_mt` (a NEP-245 mock with batch calls, a blocked receiver and a frozen account); `ct068_abi_freeze`, `be034_mt_on_transfer` and the escrow tests of 0.0.10 still pass. Only the mock ran: the multi-token contract of NEAR Intents (`intents.near`) was not used.
**Breaking for callers:** none that the sources name; no existing method changes its signature.
**Migration:** not stated in the sources; the new map is under its own storage key. An upgrade from `0.0.10` was not run.

## 0.0.10 (no tag of its own: its methods are in `v0.0.11`; interface in `contracts` `6124495`, 2026-11-03)

Class A escrow of an exact amount of a fungible token (CT-090) and the tests of restricted tokens (CT-091). It is a new interface version because it adds a view, an event and three errors, so it could not share `0.0.9` with the tag `v0.0.9`.

**Added**
- `ft_on_transfer` takes a new action, `{"action":"escrow","grant_id":N}`, from any NEP-141 token **except** the USDT of the circle (the USDT of the circle is not an escrow asset). The grantor of a class A grant deposits the token with `ft_transfer_call`; the contract holds it until `complete_escrow` pays the buyer with `ft_transfer`, or `cancel_escrow` gives it back after `expires_at`.
- The scope of a class A grant for a token is `{"ft_contract": ..., "amount": ...}` (`amount` in the units of that token, decimal text). The deposit must be exactly this amount of exactly this token.
- View `get_ft_escrow(grant_id) -> {grant_id, ft_contract, amount, state, buyer} | null`; event `ft_escrow_held { grant_id, ft_contract, amount }` (34 events in total). The stored NFT escrow is unchanged (the new map has its own storage key).
- Errors: `ERR_ESCROW_FT_MISMATCH`, `ERR_ESCROW_FT_AMOUNT`, `ERR_ESCROW_USDT`.
- Behaviour of a failed delivery: when `ft_transfer` to the buyer fails, the registration of the buyer's voucher is taken back exactly (as for an NFT) and the escrow is `held` again; the grantor takes the tokens back by `cancel_escrow` after the grant expires. Tested with a restricted token (`probes/mock_rwa`: whitelist, frozen account, unregistered buyer).
- **Not supported:** tokens with a transfer fee (a deflationary token): the contract would hold less than the amount in the scope, so the deposit is refused and the tokens return to the grantor. The buyer must be registered at the token contract (`storage_deposit`), or the delivery fails and the payment is taken back.
- SDK: `get_ft_escrow` and `ft_escrow_held` in the pinned ABI, `ftEscrowGrantScope`, `buildFtEscrowDepositCall`, `assertBuyerRegisteredAtToken`.

**Breaking for callers:** none that the sources name; no existing method changes its signature.
**Migration:** not stated in the sources; the new map is under its own storage key, so the state layout of the escrow of NFTs does not change. An upgrade from `0.0.9` was not run.

## 0.0.9 (released 2026-11-03 as `v0.0.9`, tag on `b9236b1`, reproducible; `abi.json` has the version since `35dfca5`, final ABI at `4936e58`)

Residual payment through NEAR Intents (BE-034, spec section 18) and the decisions of ADR-41.

**Added in the code (`35dfca5`, `2c63ef5`)**
- Method `mt_on_transfer(sender_id, previous_owner_ids, token_ids, amounts, msg) -> PromiseOrValue<Vec<U128>>`: NEP-245 receiver. Only `intents_id` may call it, with exactly one token `nep141:<usdt_token_id>` and the `settle` action of `ft_on_transfer`; the unused part is returned as the result. Debtor is `previous_owner_ids[0]`.
- Method `withdraw_intents_balance() -> Promise`: permissionless; brings the USDT booked by `mt_on_transfer` from Intents to the NEP-141 account of the circle (`ft_withdraw`, 1 yocto, at least 130 Tgas prepaid, one withdrawal at a time). Callback `on_intents_withdrawn(amount) -> U128` (private, never panics). View `intents_balance() -> U128`.
- Event `intents_withdrawn { amount }`.
- Errors: `ERR_NOTHING_TO_WITHDRAW`. Reused for the new paths: `ERR_WRONG_TOKEN`, `ERR_BAD_MSG`, `ERR_ZERO_AMOUNT`, `ERR_GAS_TOO_LOW`, `ERR_WITHDRAW_IN_FLIGHT`.

**Added by ADR-41 (contracts `d19a786` and `4936e58`; from the second security review, [docs/security-review-3.md](docs/security-review-3.md))**
- `JOIN_STORAGE_DEPOSIT` rises from 0.01 NEAR to **0.32 NEAR**, which covers the worst storage of one member (31 282 bytes measured by the contract owner). The deposit is not returned when the member exits; only the part above it is returned.
- `remove_intent` emits `intent_removed { intent_hash, account_id }` (33 events in total).
- The intents of an `exited` member may be removed by anybody; `accept_grant` refuses an offer whose grantor is not `active` (`ERR_GRANT_NOT_ACTIVE_MEMBER`); `revoke_grant` with reason `defaulted` is allowed for a grantee that is `exited`.
- No method changes its signature: the ABI of `0.0.9` has the same 66 methods and views plus the event `intent_removed`. The SDK pinned it from `4936e58` (`abi-v0.0.9.json` of the release has the sha256 `ea01ea625262…`, the same as the pin) until it moved to 0.0.10.
- Released as `v0.0.9` with `x207-circle-v0.0.9.wasm`, `abi-v0.0.9.json` and `SHA256SUMS`, reproducible (see the table above).

**Breaking for callers:** a client that attaches less than 0.32 NEAR to `join` is refused once ADR-41 is in the contract. A contract before 0.0.9 accepts 0.32 NEAR and returns what is above 0.01 NEAR (the onboarding sandbox tests of the SDK and the agents pass with the new deposit against the local `0.0.9` build made before ADR-41, whose minimum is still 0.01 NEAR).
**Migration:** the credit booked at Intents is kept under its own storage key, so no change of the state layout was found in the code. An upgrade from `0.0.8` to `0.0.9` through `propose_upgrade` and `apply_upgrade` has not been run. The upgrade from `0.0.7` to `0.0.8` has (below).

## 0.0.8 (2026-11-03, `a34be26`; `prune_epoch` in `44c9df8`; release `v0.0.8`, not reproducible)

Hardening after the first security review (ADR-40, [contracts/docs/security-review.md](contracts/docs/security-review.md)).

**Added**
- Method `remove_intent(intent_hash)`: owner only (`ERR_NOT_INTENT_OWNER`, `ERR_UNKNOWN_INTENT`).
- Method `prune_epoch(epoch, max_items) -> u32`: permissionless; gives back the storage of a `finalized` epoch (pairs, edge index, participant totals, bundles with their reservations and counters) and keeps every D5 position, the epoch record and the clearing proposal, so `claim` still works. A bundle is not split (cost `2 + 3 * legs`), so one call can pass `max_items`; at most 200 items per call. Errors `ERR_NOT_FINALIZED`, `ERR_UNKNOWN_EPOCH`.
- Limits: `MAX_OPEN_INTENTS_PER_MEMBER` = 64 (`ERR_INTENT_LIMIT`); `MAX_BUNDLES_PER_MEMBER_PER_EPOCH` = 16 (`ERR_BUNDLE_LIMIT`); at most 64 legs in a bundle (`ERR_BAD_BUNDLE`).
- Errors: `ERR_ESCROW_NFT_MISMATCH`, `ERR_INTENT_LIMIT`, `ERR_BUNDLE_LIMIT`, `ERR_NOT_INTENT_OWNER`, `ERR_UNKNOWN_INTENT`.

**Changed (breaking for callers)**
- `grants_of(account_id, role)` becomes `grants_of(account_id, role, from_index, limit)`, paged, and lists only `offered` and `active` grants; `get_grant` still answers a grant that has ended.
- A class A offer must name its NFT in `limits.scope` as `{"nft_contract": ..., "token_id": ...}` (otherwise `ERR_BAD_GRANT`), and `nft_on_transfer` refuses any other contract or token.

**Migration:** tested from `0.0.7` (CT-083, `contracts/tests/ct083_upgrade_from_0_0_7.rs`): grants, escrow, intents, bundles and vouchers written before the upgrade read the same after it. A bundle committed before `0.0.8` has no epoch index and is not removed by `prune_epoch`.
**Known open points, reported in the second review:** see 0.0.9 above and `docs/security-review-3.md` (storage paid by the contract per intent, first-come intent hashes, no event on `remove_intent`, intents and grants left open by `exit`).

## 0.0.7 (2026-11-02, `7a48d4d`; release `v0.0.7`, not reproducible)

Class A escrow (F8, CT-075, spec section 16).
- Methods: `nft_on_transfer`, `complete_escrow`, `cancel_escrow`, callback `on_escrow_resolved`; view `get_escrow`.
- Events: `escrow_held`, `escrow_failed`.
- Errors: `ERR_ESCROW_EXISTS`, `ERR_ESCROW_UNKNOWN`, `ERR_ESCROW_NOT_HELD`, `ERR_ESCROW_NOT_EXPIRED`, `ERR_ESCROW_NOT_GRANTOR`, `ERR_ESCROW_TOO_LATE`, `ERR_ESCROW_PENDING`, `ERR_ESCROW_PRICE`, `ERR_ESCROW_VOUCHER`, `ERR_ESCROW_DEPOSITOR`, `ERR_ESCROW_NOT_CLASS_A`.
- Behaviour: for a class A grant `accept_grant` is refused (use `complete_escrow`); `revoke_grant` is refused while the escrow holds the asset; a voucher for a pair locked by an escrow is refused; `complete_escrow` is refused 120 s before the cutoff; a failed `nft_transfer` takes the registration back exactly (pair, debt, totals, edge). NEAR accounts through a locker contract are not built; the asset is an NFT.
- Migration: not stated in the sources for the step `0.0.6` to `0.0.7`.

## 0.0.6 (2026-11-02, from `0d177e9`; release `v0.0.6`, not reproducible)

Access assets (F8, spec section 15, ADR-27, ADR-28).
- Methods: `set_asset_class` (owner), `get_asset_class`, `list_asset_classes` (CT-069, registry D10); `offer_grant`, `accept_grant`, `get_grant`, `grants_of` (CT-070, D11; 16 open grants per grantor); `revoke_grant` (CT-071: by grantor, grantee or operator; `expired` by anybody after `expires_at`; `defaulted` by anybody once the grantee is suspended or has defaulted).
- Events: `asset_class_set`, `grant_offered`, `grant_activated`, `grant_revoked`.
- Errors: `ERR_ASSET_TYPE_UNKNOWN`, `ERR_ASSET_CLASS_FORBIDDEN`, `ERR_DELIVERY_NOT_ALLOWED`, `ERR_PROOF_KIND_NOT_ACCEPTED`, `ERR_BAD_ASSET_TYPE`, `ERR_BAD_GRANT`, `ERR_UNKNOWN_GRANT`, `ERR_GRANT_NOT_ACTIVE_MEMBER`, `ERR_GRANT_SELF`, `ERR_GRANT_NOT_OFFERED`, `ERR_GRANT_EXPIRED`, `ERR_GRANT_FINAL`, `ERR_GRANT_REVOKE_DENIED`.
- Migration: not stated in the sources.

## 0.0.5 (2026-11-02, `be1a569`; release `v0.0.5`, not reproducible)

Cap on the seeker leg of a bundle (CT-082, ADR-39).
- New parameter `max_search_share_bps` (default 500 = 5%, range 0 to 10000; JSON without the field takes the default). New optional field `BundleInput.search_leg`, which names the seeker leg in the signed terms. Error `ERR_SEARCH_SHARE_EXCEEDED`. The cap binds only a leg declared as `search_leg`; a bundle without one is not capped (the marketplace backend always declares it).
- **Migration needed.** The borsh layout of `Params` changes, so a circle deployed before needs a migration (spec, section 1).
- The ABI has no new method.

## 0.0.4 (2026-11-02, `eb95924`; release `v0.0.4`, not reproducible)

Barter bundles (F5, ADR-38).
- Methods: `post_intent(intent_hash)`, `commit_bundle(bundle, signatures)` (permissionless; the contract computes `terms_hash` itself from the circle, the epoch and the sorted legs, and needs the signature of every participant), `register_in_bundle(bundle_id, voucher, signature)`; views `get_intent`, `get_bundle`.
- Events: `intent_posted`, `bundle_committed`.
- Errors: `ERR_INTENT_EXISTS`, `ERR_BAD_BUNDLE`, `ERR_BUNDLE_EXISTS`, `ERR_BUNDLE_SIGNATURES`, `ERR_BUNDLE_HEADROOM`, `ERR_UNKNOWN_BUNDLE`, `ERR_BUNDLE_LEG`, `ERR_BUNDLE_LEG_EXCEEDED` (and `ERR_UNKNOWN_EPOCH`, `ERR_WRONG_PHASE`, `ERR_PAYER_NOT_ACTIVE` for the new calls).
- Migration: not stated in the sources.

## 0.0.3 (2026-11-02, `8e9de9e`; no release)

Upgrade by the owner behind a 24 hour timelock (CT-055).
- Methods: `propose_upgrade`, `apply_upgrade` (takes the raw wasm; the sha256 must equal the proposed one; calls `migrate`), `migrate`; view `get_upgrade`.
- Events: `upgrade_proposed`, `upgrade_applied`.
- Errors: `ERR_TIMELOCK_ACTIVE`, `ERR_CODE_HASH_MISMATCH`, `ERR_NO_UPGRADE`, `ERR_NO_STATE`.
- The pending upgrade lives under its own storage key, so the state layout does not change. `migrate` reads the existing state; a version with a new layout replaces its body with the conversion.

## 0.0.2 (2026-11-02, `ea62077`; no release)

Admission, reactivation and solver fees (P1 items that entered the ABI).
- Methods: `admit_member` (owner, for circles with `admission: "dao"`), `claim_solver_fee`, callback `on_solver_fee_resolved`; view `solver_fee_balance`.
- Events: `member_admitted`, `member_reactivated` (a suspended member comes back by staking, ADR-30; `settled_history` resets to 0), `solver_fee_claimed`, `solver_fee_claim_failed`.
- Errors: `ERR_NOT_ADMITTED`, `ERR_ALREADY_ADMITTED`, `ERR_ADMISSION_NOT_DAO` (and `ERR_NOTHING_TO_CLAIM` for `claim_solver_fee`).
- Migration: not stated in the sources.

## 0.0.1 (2026-11-01, `33f85b6`; no release)

The P0 interface, frozen as `abi.json` (CT-068): 34 methods and views.
- **Change methods:** `new`, `join`, `ft_on_transfer` (actions `stake` and `settle`), `register_cumulative`, `register_voucher`, `close_epoch`, `submit_clearing`, `commit_epoch`, `finalize_epoch`, `claim` with callback `on_claim_resolved`, `request_exit`, `withdraw_stake` with callback `on_withdraw_resolved`, `set_params`.
- **Views:** `interface_version`, `get_owner`, `get_circle`, `get_params`, `get_pending_params`, `get_epoch`, `get_pool`, `get_clearing_proposal`, `simulate_clearing`, `member`, `list_members`, `limit`, `headroom`, `outstanding_debt`, `last_seq`, `obligation`, `list_obligations`, `net_position`, `list_positions`.
- **Events:** `member_joined`, `stake_added`, `voucher_registered`, `epoch_cutoff`, `clearing_submitted`, `clearing_applied`, `epoch_committed`, `limits_updated`, `epoch_finalized`, `member_defaulted`, `residual_paid`, `residual_claimed`, `residual_claim_failed`, `exit_requested`, `stake_withdrawn`, `stake_withdraw_failed`.
- **Decisions in force:** ledger of credit is state of the contract, not a token (ADR-11); the contract never calls Intents itself (ADR-01, ADR-03); owner is a Sputnik DAO (ADR-13, ADR-20); exit and withdrawal of stake (ADR-29 to ADR-32): `request_exit` then `withdraw_stake` after the exit epoch is `finalized` and no debt remains; `claim` works after `exited`.
- Changes made to the design after the freeze but before the first `abi.json` release (ADR-32: signature of `withdraw_stake`, `ERR_ZERO_CLEARED`, `ERR_WITHDRAW_IN_FLIGHT`, the content of `epoch_committed.positions[]`, the default of `limit_decay`) are part of `0.0.1`.

---

## What this file does not claim
- It lists names that the sources give. Per-version error and event lists for `0.0.1` and `0.0.2` are the ones the spec and the commit messages tie to the version; a code that was written after the freeze and before the next bump can carry an error code not listed under the version where it appears in the history.
- "Migration: not stated" means that neither the spec nor the commit messages say it, not that none is needed. The upgrade path was tested from `0.0.7` to `0.0.8` only.
- The security status of each version is in [docs/security.md](docs/security.md); no version has an external audit.
