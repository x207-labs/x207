# Changelog of the contract interface (`x207-circle`), 0.0.1 to 0.0.9

For reviewers and for users of the SDK. This file is the interface of the circle contract, version by version: methods, events, error codes, decisions, and whether a circle that already runs the previous version needs a migration. It is written from the Interface Spec of the contract (`vault/14 x207/04 Arsitektur/x207 - Spec Antarmuka Kontrak.md`, sections 1, 14 to 18), from the history of `abi.json` and from the commits of the repository `contracts`. Where the sources do not say something, this file says so; it does not fill the gap.

**How versions work (spec section 1, rules of the `0.0.x` freeze).** While the version is `0.0.x`, every change that an outside caller can see raises the patch number: the name or arguments of a method, the return type of a view, a field of an event, an error code, the `msg` schema, the byte format of a voucher. The view `interface_version()` returns the version, and the field `version` of every NEP-297 event (`standard: "x207"`) carries it. A consumer refuses an event with a higher minor than it knows and ignores fields it does not know. The first release tagged `v0.1.0` changes the rule: after it, a minor raises for a break and a patch for a compatible addition. The SDK pins the version it was generated from: `X207_CIRCLE_ABI_VERSION` in `sdk/packages/core/src/contract/types.generated.ts` (today `"0.0.9"`).

**Releases and reproducibility.** A release is a tag `vX.Y.Z` of the repository `contracts` with `x207-circle-vX.Y.Z.wasm`, `abi-vX.Y.Z.json` and `SHA256SUMS`. GitHub has the releases `v0.0.4` to `v0.0.8`. There is no tag for `0.0.1`, `0.0.2` and `0.0.3`: those are interface versions only.

| Release | Reproducible build | Basis |
| --- | --- | --- |
| `v0.0.4`, `v0.0.5`, `v0.0.6`, `v0.0.7`, `v0.0.8` | **No** | Built on a developer machine or by the earlier workflow, before the pinned container existed. `Cargo.toml` at each of these tags has no `reproducible_build` section (checked for `v0.0.7` and `v0.0.8`), and `contracts/docs/verify-release.md` says that versions up to `v0.0.7` are not reproducible. The `code_hash` of a deployment of these versions cannot be tied to the source of the tag. |
| `v0.0.9` (not tagged yet) | **Yes, once released** | Built twice in a pinned container (image by digest, `cargo near build non-reproducible-wasm --locked`, `Cargo.lock` committed); the release workflow publishes nothing if the two sha256 differ. Run 41575069378 of `reproducible.yml` on a GitHub runner built one commit twice with the same sha256 (`95515ee8f759…`), the same as two builds on a Mac (CT-087). How to check a `code_hash`: `contracts/docs/verify-release.md`. Limit: the repository is private, so a third-party verifier such as SourceScan may compute another number until it is public. |

A rehearsal or a mainnet deployment uses the wasm of a release and records its `code_hash` ([docs/mainnet-runbook.md](docs/mainnet-runbook.md)).

Dates are those of the commits (UTC+07:00). "Commit" is the commit of the repository `contracts` in which the version appears in `abi.json`.

---

## 0.0.9 (in progress; `abi.json` has the version since `35dfca5`, 2026-11-03; final ABI at `4936e58`)

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
- No method changes its signature: the ABI of `0.0.9` has the same 66 methods and views plus the event `intent_removed`. The SDK pins it (`abi/x207-circle.abi.json`, pinned from `4936e58`).
- The tag `v0.0.9` is not published yet, so this section stays "in progress" until it is.

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
