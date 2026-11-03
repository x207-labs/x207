# Security of x207: what was reviewed, what was found, what is open

One page for the reviewers of the `security` track. It lists findings and points to the review documents; it does not repeat them. It says what was tested. It does not say that the system is safe, because that was not shown. Dates: 2026-11-03 unless stated; commits are those of the repositories named in the column.

## Threat model in short
- **Attackers.** (1) A circle member who signs vouchers it will not honour, or who colludes with another member. (2) Anybody who can call a public method or an HTTP endpoint (facilitator, broker, read API). (3) A lessee of a grant (class B key, class C proxy, class A buyer). (4) Whoever can put text into the chain or the book (listings, `asset_type`, `limits.scope`, memos). (5) A server that the browser talks to (read API).
- **What is protected.** The stake of each member and the invariant `limit <= stake` (ADR-18); the pool (D6) against the USDT balance of the circle; the NFT in an escrow; the secret of a class C grantor; the lease key; the gas of the relayer.
- **Assumptions that the findings below depend on.** One facilitator and one relayer per pair of members (two relayers can both register; the contract refuses the second, a seller can be served on a voucher that is then dropped); the free public RPC endpoints answer and are not hostile (the indexer halts on a mismatch with the chain, it does not fix it); the broker runs **without a TEE**, so a class C secret lives in its environment; the DAO that owns a circle acts through a 24 hour timelock and its council is honest; the keys of the facilitator, solver and keeper cannot attach a deposit (spec 9.3 item 2); deployed code is the code of a release (see the last section).
- **Out of scope here.** The NEAR protocol, the Sputnik DAO contract, `@x402/near`, Intents (`intents.near`), the wallet, the browser.

## Findings
Level is the one written in the review document. "Fixed" names the commit and the test that failed before it.

| Area | Id | Level | Status | Reference |
| --- | --- | --- | --- | --- |
| Contract | F1 `nft_on_transfer` trusted any caller (class A escrow slot) | high | fixed `a34be26`: scope names NFT contract and token, `ERR_ESCROW_NFT_MISMATCH` | `contracts/docs/security-review.md` |
| Contract | F2 unbounded storage by one member (intents, bundles) | high for liveness | fixed `a34be26` (64 intents, 16 bundles per epoch per participant) and `44c9df8` (`prune_epoch`, 64 legs per bundle) | same |
| Contract | F3 escrow callback read a long return value as failure | high | fixed `55809cd` | same |
| Contract | F4 `revoke_grant(defaulted)` open to anybody against a reactivated member | medium | fixed `e7ce1e9` | same |
| Contract | F5 `grants_of` unpaged, index only grew | medium | fixed `a34be26` (paged, open grants only) + broker reads the read API | same |
| Contract | F6 the cap `max_search_share_bps` binds only the declared `search_leg` | low | accepted: the marketplace always declares it | same |
| Contract | F7 a leg voucher names no bundle; F8 `post_intent` first come; F9 grant without grantee first come | low | accepted: no funds move | same |
| Contract | F10 an escrow in `completing` or `stuck` has no rescue path | medium | accepted: ADR-20 forbids the owner to move assets; README states the risk | same, README |
| Contract | wash trading with cash (two accounts of one actor): limit 80 to 100 of the stake in 3 epochs at gas cost | low | accepted (K-62): `limit <= stake` holds; cycles and bundle legs do not raise a limit (tested `e8d2b74`) | `contracts/docs/security-review.md` |
| Contract | `commit_bundle` over 240 legs failed on the 16384 byte log, not with a contract error | low | fixed `44c9df8` (`ERR_BAD_BUNDLE` over 64 legs); gas measured | same |
| Facilitator and SDK | R1 one voucher served n times by n parallel requests | high | fixed: `1eb2f57` (sdk, middleware) and `d279062` (broker) | `backend/docs/security-review-2.md` |
| Facilitator and SDK | C1 payer suspended inside the cache window still passes `/verify` | medium | fixed `6ed92b6` (TTL 10 s); worst case per event is the cached headroom | same |
| Facilitator and SDK | C2 a voucher registered by another relayer passes `/verify` for 10 s | low | accepted: documented, own registrations drop the cache | same |
| Facilitator and SDK | G1 the in-flight id is taken before `/verify`: a forged request blocks the real voucher | medium | fixed `58f4909` (`sdk`, SD-017): the id is taken after `/verify` answers valid; `TC-SR3-02` is a plain test now | same, "Cross review of the SDK" |
| Facilitator and SDK | G2 a hung handler keeps the id; L1 gas key lanes without timeout | low | fixed `58f4909` and `2286f1e`: the id is given back on abort and after `maxHoldMs` (2 min); `GasKeyLanes` times out a nonce read or a `work` (60 s). A replay after the early give-back may run the handler twice, the voucher still settles once | same |
| Facilitator and SDK | F1 stale `mock_intents` wasm and F2 stale `dist` in test setups | low | fixed `3f62634` and `8c8319b`: `deployCircle({ mockIntents: true })` checks the exports of the wasm and names the build command; the umbrella runs `tsc -b` in `sdk` before the tests (`tests/support/build-sdk.ts`) | same |
| Facilitator and SDK | `exact` (NEP-366): the relayer pays the gas of settlements that fail; no limit per sender | medium | reduced `7fd4097`: sponsored gas capped at 30 Tgas, a pause after 3 failed settlements per verified payer, a rate limit per client; the relayer balance is still the last limit (`sdk/docs/exact-limits.md`, tested TC-SR3-20 to 26) | same |
| Broker | B1 `..%2f` walks out of the scope prefix of the class C proxy | high | fixed `95fa0ac` | same |
| Broker | B2 method-override and forwarding headers reach the provider; B3 the provider echoes the secret to the lessee; B4 redirects carry the secret | medium | fixed `95fa0ac` | same |
| Broker | B5 the quota is passed by parallel requests; B6 two lease payments send `AddKey` twice; B7 one voucher pays twice | medium | fixed `95fa0ac`, `d279062` | same |
| Frontend | FE-1 the server decided what the voucher key signs | high | fixed (`frontend` `d0b5059`) | `frontend/docs/security-review.md` |
| Frontend | FE-2 no script and connection policy | low | partly fixed: object, base, form and referrer only | same |
| Release | the wasm of releases up to v0.0.7 cannot be traced to a tag | medium | fixed for later tags in the pipeline (`d651a65`, `06b72f8`): build in a pinned container, twice, compared; first run on a runner pending | `contracts/docs/verify-release.md` |
| Contract 0.0.9 | `mt_on_transfer`, `withdraw_intents_balance`, `prune_epoch`, `remove_intent`: reviewed by another session (Main B), not by the author | see rows I-1 to I-5 and the "not checked" list of the document | `docs/security-review-3.md` |
| Contract 0.0.9 | I-3 `post_intent` is not payable: the contract pays the storage of 64 intents (0.0659 NEAR, 6.5 times the join deposit) | medium | fixed `d19a786`: the join deposit is 0.32 NEAR, the measured worst case of one member (64 intents, 16 grants with a scope of 1024 bytes: 31282 bytes = 0.3128 NEAR; `contracts/tests/ct062_storage_per_member.rs`). The limits of scope and grants were not lowered (ADR-41) | `docs/security-review-3.md` |
| Contract 0.0.9 | I-2 `remove_intent` emitted no event | low | fixed `d19a786`, `4936e58`: `intent_removed { intent_hash, account_id }` | same |
| Contract 0.0.9 | I-4 intents of a member that `exited` stay in the contract | low | fixed `4936e58`: anybody removes the intents of an exited member (unit test `anybody_removes_the_intent_of_an_exited_member_and_of_nobody_else`) | same |
| Contract 0.0.9 | I-5 the offer of a grantor that left can be accepted; the grants of an exited grantee cannot be ended by a stranger | low to medium | fixed `4936e58`: `accept_grant` refuses (`ERR_GRANT_NOT_ACTIVE_MEMBER`), `revoke_grant(.., defaulted)` is open for an `exited` grantee (unit tests in `grant::tests`) | same |
| Contract 0.0.9 | I-1 the first member that posts an intent hash owns it | low | accepted (same class as F8) | same |
| Keeper | `prune_epoch` needs 70.2 Tgas for 196 items | low | fixed `2368bce` (umbrella): the keeper attaches 200 Tgas, a test pins it | `scripts/keeper.test.mjs` |
| Contract 0.0.9 | I-3 `post_intent` is not payable: a member with the minimum stake pins 64 intents = 0.065 NEAR of the contract balance (6.5 times its join deposit) for good | medium | open, reported to the contract owner; `it.fails` `TC-SR3-03` | `docs/security-review-3.md` |
| Contract 0.0.9 | I-1 an intent hash is first come (second poster gets `ERR_INTENT_EXISTS`); I-2 `remove_intent` emits no event | low | open; `it.fails` `TC-SR3-04`, `TC-SR3-05` | same |

## Repeat the checks
Every "fixed" row above has a test that failed before the fix. Run them from the folder of the repository named. A sandbox test needs `cargo near build non-reproducible-wasm` once (and Docker is not needed). Sandbox tests walk epochs and take about a minute each. Tests marked `it.fails` in the umbrella assert the safe behaviour and are green while the finding is open; they turn red when it is fixed.

| Finding | Folder | Command |
| --- | --- | --- |
| F1 | `contracts` | `cargo test --lib escrow::tests` and `cargo test --test ct070_grants a_class_a_offer_must_name_its_nft_and_token` |
| F2 | `contracts` | `cargo test --lib bundle::security_tests`, `cargo test --test ct065_bundle a_participant_is_in_at_most_16_bundles_per_epoch`, `cargo test --lib prune::tests`, `cargo test --test ct085_prune`, `cargo test --lib a_bundle_with_more_than_64_legs` |
| F3 | `contracts` | `cargo test --lib escrow::tests::a_nft_contract_that_returns_a_long_value_still_delivers` |
| F4 | `contracts` | `cargo test --lib grant::tests::a_reactivated_member_keeps_its_grants_against_a_stranger` |
| F5 | `contracts`, `backend/broker` | `cargo test --test ct070_grants grants_of_pages_and_drops_ended_grants`; `npm test` in `backend/broker` (`watcher.test.ts`, `grants-api.test.ts`) |
| F6 to F10, K-62 | `contracts` | `cargo test --test ct_security_review` and `cargo test --test ct084_bundle_economics` (what holds); the accepted ones are decisions, not code |
| Gas, legs, upgrade | `contracts` | `cargo test --test ct086_gas_limits -- --nocapture --test-threads=1 \| grep GAS`; the upgrade test needs the 0.0.7 wasm in `target/near/x207_circle.wasm` and `X207_NEW_WASM=<new wasm> cargo test --test ct083_upgrade_from_0_0_7` |
| I-2 to I-5 | `contracts` | `cargo test --lib bundle::security_tests grant::tests events`; `cargo test --test ct062_storage_per_member -- --nocapture \\| grep STORAGE` |
| Interface of 0.0.9 | `contracts` | `cargo test --test ct068_abi_freeze`, `cargo test --test be034_mt_on_transfer`, `cargo test --test be034_intents_withdraw` |
| R1, C1, C2 | repository root | `npx vitest run tests/security-review-facilitator.test.ts` (build `sdk` first: `npm run build` in `sdk`, because the tests import `dist/`) |
| B1 to B7 | `backend/broker` | `npx vitest run test/security-review.test.ts` |
| G1, G2, L1, F1, F2 (SDK) | repository root, `sdk` | `npx vitest run tests/security-review-sdk.test.ts tests/sdk-test-support.test.ts`; in `sdk`: `npx vitest run apps/facilitator/test/exact-limits.test.ts` |
| I-1, I-2, I-3 (contract 0.0.9) | repository root | `X207_SANDBOX=1 npx vitest run tests/security-review-contract3.sandbox.test.ts` (about 12 minutes; the `it.fails` tests are the open findings) |
| FE-1, FE-2 | `frontend` | `npx vitest run src/test/security.test.tsx src/components/Negotiation.test.tsx` |
| Clearing verifier (property tests) | `contracts` | `cargo test --test ct030_clearing_property` (1000 cases each; 2 to 30 members; the verifier against an independent statement of the rules, mutated and random proposals, the real `submit_clearing` and `commit_epoch` of every accepted one, the order of submissions); `cargo test --lib leg_properties` (partly registered bundle legs). A failing case prints its smallest input and proptest keeps the seed in `proptest-regressions/`. No violation was found. |
| Stateful sequences | `contracts` | `cargo test --lib stateful_tests`: 12 random sequences of calls (join, stake, vouchers, intents, grants, clearing, settle, finalize, claim, prune) with a **fixed seed (7)**, so that CI and a laptop run the same sequences. The test asserts that `Register`, `CloseEpoch`, `SubmitBest`, `CommitEpoch`, `Settle`, `Finalize`, `Claim`, `Prune`, `OfferGrant` and `AcceptGrant` were accepted at least once, so it cannot pass by refusing everything. More cases: `PROPTEST_CASES=100 cargo test --lib stateful_tests`; another seed: `X207_STATEFUL_SEED=3 cargo test --lib stateful_tests` (the coverage assertion can then fail for lack of coverage, and its message says so); what was accepted and refused, by kind: `X207_STATEFUL_STATS=/tmp/stats.txt`. A failing sequence is shrunk by proptest. No violation was found. |
| Release | `contracts` | `scripts/repro-build.sh HEAD /tmp/a && scripts/repro-build.sh HEAD /tmp/b` and compare the two sha256 lines (needs Docker) |
| Testnet runs | repository root | hashes in `docs/testnet-v10-*.json` and `docs/testnet-f8-v10.json`; look a hash up in the explorer of testnet |

## Not tested or not checked
- Anything on mainnet. The rehearsals ran on testnet with a mock USDT; Intents has no code on testnet, so `mt_on_transfer` and `withdraw_intents_balance` ran against a mock that plays `intents.near`. The real answer of `ft_withdraw` is assumed from the reference contract.
- A TEE: class C secrets are not sealed to an enclave key (BK-009, BK-010); the audit log of the broker is a plain file.
- Fuzzing of the contract beyond the property tests of the clearing verifier and of the bookkeeping of bundle legs (no random sequences of calls through the whole interface, no fuzzing of the vouchers), and an economic model beyond the cases in the review (clearing with fees above 0 together with bundles).
- Upgrade from 0.0.4 or older (the `Params` layout changed in 0.0.5); 0.0.7 to 0.0.9 was tested in near-sandbox.
- Several seller processes (the in-flight guard lives in the memory of one process), two facilitators on one pending store, and the behaviour of the free RPC endpoints under load beyond what the rehearsals met.
- A real wallet in the browser, and the dependencies of every package (`npm audit` not run).
- The correctness of `@x402/near`, the Sputnik DAO and the NEAR runtime.

## How to check that a deployed circle runs a release
Download the wasm of the tag, compare `shasum -a 256` with `SHA256SUMS`, convert it to base58 and compare it with the `code_hash` of the account over RPC; or build the tag again with `scripts/repro-build.sh`. The commands, and what the proof does and does not cover (a third-party verifier may compute another number while the repository is private), are in `contracts/docs/verify-release.md`. Deployments of rehearsals and of mainnet use the wasm of the release, and the `code_hash` goes next to the hash of the deploy transaction in the record of the run.
