# Architecture, NEAR and the mechanism

_Moved from the README sections 5 to 7. The content is unchanged; paths are relative to this folder. Start at the [README](../README.md)._

## 5. Architecture and repositories

### Seven layers

| Layer | Contents | Modules |
| --- | --- | --- |
| Agent interaction | HTTP and x402 v2 (`PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`) | M7, M2 |
| Commitment | Credit voucher as a `batch-settlement` commitment on `x207:<circleId>` | M2, M3 |
| Accounting | Obligation ledger, limits, and epochs in the `x207-circle` contract | M1 |
| Clearing | Open solver, O(n) verification on-chain | M4, M1 |
| Settlement | USDT NEP-141, NEAR Intents, 1Click | M5, M1 |
| Risk and governance | Stake, reserve, haircut; Sputnik DAO | M1, M9 |
| Observability | Indexer, dashboard, 207 report | M6, M8 |

### Modules

| ID | Module | Stack |
| --- | --- | --- |
| M1 | `x207-circle` contract | Rust, `near-sdk` 5.29.1 |
| M2 | `@x207/scheme`, the x402 binding | TypeScript |
| M3 | Facilitator | TypeScript |
| M4 | Clearing solver | TypeScript |
| M5 | Settlement worker | TypeScript |
| M6 | Indexer | TypeScript |
| M7 | Six demo agents | TypeScript |
| M8 | Dashboard | React, Vite |
| M9 | Governance | Sputnik DAO |
| M11 | Marketplace: listing book, negotiation rounds, bundle proposals, referral inbox (`backend/src/marketplace/`) | TypeScript |
| M12 | Barter solver and seeker: two-party matches, rings, seeker offers (`solver/src/barter/`) | TypeScript |

### Repositories

| Repo | Modules | Features | Contents |
| --- | --- | --- | --- |
| `x207` | | | This umbrella repo: README, docs, scripts |
| `contracts` | M1, M9 | F1–F8 | `x207-circle` contract (Rust, interface 0.0.7: barter (`commit_bundle`, `register_in_bundle`, `post_intent`), access grants and class A escrow), near-sandbox tests, Sputnik DAO proposal scripts |
| `sdk` | M2, M3 | F2, F4, F5, F9 | `@x207/core`, `@x207/scheme`, binding spec, formats for listings, offers, bundles and referrals, test vectors, conformance suite, reference facilitator, a minimal Python SDK (`sdk/python/`, passes the suite, not published) |
| `backend` | M5, M6, M11 | F1–F7, F9, P8 | Indexer, read API, HTTP 207 report, 1Click settlement worker, marketplace book, broker for access grants (`backend/broker/`, classes B and C) |
| `frontend` | M8 | F1, F3, F4, F6, F7, F9 | Dashboard, marketplace page with negotiation view |
| `solver` | M4, M12 | F3, F5, F9 | Open clearing solver (min-cost flow), barter matching and rings, seeker |
| `agents` | M7 | F2, F5, F9 | Six demo agents and scenarios, including barter, business, invoice and marketplace scenarios |
| `.github` | | | Organization profile, templates, reusable CI |
| `vault` | | | Design notes. Private, not a submodule, not linked from here |

External interfaces E1–E8 and their fourteen data flows are in [docs/external-interfaces.md](external-interfaces.md).

The product repos are git submodules of this repo, each pinned at one commit. Clone with `git clone --recurse-submodules https://github.com/x207-labs/x207.git`; if you cloned without the flag, run `git submodule update --init` in the clone.

## 6. How x207 uses NEAR

| NEAR resource | Feature | Code | Demo step |
| --- | --- | --- | --- |
| USDT NEP-141 (`ft_transfer_call`) | F1 stake and F4 residual payment | `contracts/x207-circle/src/stake.rs`, `contracts/x207-circle/src/settlement.rs`; client builders in `sdk/packages/core/src/contract/` | [Run the sandbox demo](sandbox-demo.md#run-the-sandbox-demo): F1 and F4 rows. In sandbox the token is a NEP-141 mock. |
| x402 `exact` on NEAR (`@x402/near`) | Fallback payment for non-members, advertised next to the x207 entry | `sdk/apps/facilitator/src/service.ts`, `sdk/examples/seller` | F2 row: the 402 lists `exact@near:mainnet`. A real `exact` payment ran on `near:testnet` on 2026-11-03 (`X207_TESTNET=1 npx vitest run apps/facilitator/test/exact-testnet.live.test.ts` in `sdk`; hash in [docs/testnet-demo.json](testnet-demo.json)); it is not a step of the demo script, and mainnet has not run. |
| NEAR Intents and 1Click | Pay a residual from another asset (`mt_on_transfer`, `withdraw_intents_balance`, interface 0.0.9), withdraw a claim to another chain | `backend/src/settlement/`, `contracts/x207-circle/src/settlement.rs`, `frontend/src/components/DepositBranch.tsx` | Not in the demo script. The contract methods run in the sandbox against a mock Intents contract; the real `intents.near` and 1Click need a mainnet run ([docs/mainnet-runbook.md](mainnet-runbook.md), UM-035), not done. |
| Sputnik DAO | `set_params` through a proposal | `contracts/dao/`, `contracts/x207-circle/src/params.rs` | The sandbox demo calls `set_params` from the owner account. The network demo runs a DAO proposal and council vote (`DEMO_DAO_ACCOUNT`) when the DAO owns the circle contract; it ran on testnet on 2026-11-03 (F7 row of section 4). Mainnet has not run. |
| `x207-circle` bundle methods (`commit_bundle`, `register_in_bundle`, `post_intent`, `get_bundle`) | F5 barter bundles and the F9 deals that become bundles | `contracts/x207-circle/src/bundle.rs`, `contracts/x207-circle/src/voucher.rs`, `sdk/packages/scheme/`, `backend/src/marketplace/bundles.ts` | [Barter bundle block](demo-blocks.md#barter-bundle-block-feature-f5) and [Marketplace block](demo-blocks.md#marketplace-block-feature-f9). Sandbox only; the interface 0.0.4 testnet address is pending. |
| x207 vouchers with a `resource`, and `commit_bundle` for a budget (P5, metered resources) | A resource that is paid per unit of use: a CPU job in chunks, a data feed per call, with a ceiling per request and a budget locked as a bundle | `sdk/packages/scheme/server/metered-endpoint.ts`, `metering.ts`, `job-escrow.ts`, `sdk/packages/scheme/client/buyer-meter.ts`, `sdk/packages/core/src/metered-presets.ts` | [Metered resource block](demo-blocks.md#metered-resource-block-pipeline-p5-class-d); test `agents/test/metered.test.ts`, `sdk/packages/scheme/test/buyer-meter.test.ts`. No chain call of its own: the contract is unchanged. |
| x207 vouchers with `resource = x207:invoice:<hash>` (P8, invoices and installments) | An invoice is a claim outside x207; the debtor signs one voucher per installment, each as `seq` 1 of its pair in its own epoch, and the ledger clears them with everything else | `sdk/packages/core/src/invoice.ts`, `backend/src/marketplace/invoices.ts`, `agents/scenario/invoice-book.ts`, `frontend/src/pages/Invoices.tsx` | [Invoice and installment block](demo-blocks.md#invoice-and-installment-block-pipeline-p8); `X207_SANDBOX=1 npx vitest run tests/invoice.sandbox.test.ts` (real contract, indexer, solver and keeper) |
| x207 vouchers with `resource = x207:order:<hash>`, `commit_bundle` for the budget, and the RPC `tx` of the node (P6, service orders and delegate) | Work paid per milestone, per accepted result or per transaction seen on the chain; a delegate is paid per vote on a public mandate, and each vote is a call to a Sputnik DAO that the backend checks through the RPC | `sdk/packages/core/src/order.ts`, `backend/src/marketplace/orders.ts`, `order-claims.ts`, `order-proofs.ts`, `frontend/src/pages/Orders.tsx`, `agents/scenario/services.ts` | [Service orders block](demo-blocks.md#service-orders-block-pipeline-p6); `X207_SANDBOX=1 npx vitest run tests/orders.sandbox.test.ts`; `agents/test/services.test.ts`, `agents/test/delegate.test.ts`. The delegate runs against a mock node: a real Sputnik DAO vote has **not** run. |
| x207 vouchers with `resource = x207:license:<hash>` (P7, licenses with encryption) | The seller sells a license, not a file: the file is encrypted (XChaCha20-Poly1305 per 4 MiB chunk), the voucher is held by the backend until the buyer checks the hash, and a wrong file is proved by the buyer alone | `sdk/packages/core/src/license.ts`, `backend/src/marketplace/purchases.ts`, `frontend/src/pages/Licenses.tsx`, `agents/scenario/license.ts` | [Content license block](demo-blocks.md#content-license-block-pipeline-p7); `X207_SANDBOX=1 npx vitest run tests/licenses.sandbox.test.ts` |
| `offer_grant`, `accept_grant`, `revoke_grant` (class B grants) and the access broker (P2, access rent) | An SSH key, a repository collaborator or a cloud role is rented by the day; the lessee signs the next day only if the access still works, and the broker closes it at the provider when the grant ends | `backend/broker/src/provider/`, `sdk/packages/core/src/rent-check.ts`, `grantee-proof.ts`, `sdk/packages/scheme/client/daily-rent.ts`, `frontend/src/pages/Rent.tsx`, `agents/scenario/rent.ts` | [Access rent block](demo-blocks.md#access-rent-block-pipeline-p2); `X207_SANDBOX=1 npx vitest run tests/rent.sandbox.test.ts`. The providers are mocks and an SSH `authorized_keys`; no real GitHub, Discord or AWS account ran. |
| Contract 0.0.12: `commit_bundle` with `arbiter`, `confirm_deal`, `dispute_deal`, `rule_deal`, `settle_deal`; `propose_freeze`, `apply_freeze`, `unfreeze_member`; `set_asset_contracts` | A bond of both sides with an arbiter for a swap of two, the freeze of a member after a timelock of 24 hours, and the official contracts per asset type; the facilitator refuses vouchers from or to a frozen account (`account_frozen`) | `contracts/x207-circle/src/deal.rs`, `freeze.rs`, `asset_contracts.rs`, `sdk/packages/core/src/contract/deal.ts`, `sdk/packages/scheme/facilitator/verify.ts` | Not in the demo script. `cargo test --test ct094_bond --test ct095_freeze --test ct096_asset_contracts` in `contracts`; `X207_SANDBOX=1 npx vitest run apps/facilitator/test/frozen.sandbox.test.ts` in `sdk`. Not run on testnet or mainnet. |
| NEAR AI Cloud | Inference for the six demo agents, including the negotiation policy of F9 when it runs in model mode | `agents/shared/nearai.ts`, `agents/shared/barter-policy.ts` | The demo runs the agents in rule or mock mode (ADR-33); the negotiation in the marketplace block is rule-based. Live inference waits for the account top-up. |

The NEAR pages on [agentic payments](https://www.near.org/agentic-payments) and [NEAR AI](https://www.near.org/ai), and [NEAR Intents](https://near-intents.org) with its [documentation](https://docs.near-intents.org) and the [1Click API](https://docs.near-intents.org/integration/distribution-channels/1click-api/about-1click-api), are the references for these rows (the links answered on 2026-11-03). A near.org page called "currency of agents", which the task asked for, was searched for and not found, so it is not linked.

## 7. Mechanism and invariants

Every claim below links to the test in the `contracts` repo that checks it. The tests were written and run locally, and the repositories run them in GitHub CI; this README cites no run number, so check the Actions tab of each repository.

| Claim | What the contract does | Test |
| --- | --- | --- |
| **Clearing is O(n) in the number of obligations.** | The contract never searches for cycles. A solver submits a cleared amount per edge, and one pass over the edges checks that each `cleared` is at most its obligation and that every member's cleared inflow equals its cleared outflow (`ERR_CLEARED_EXCEEDS_OBLIGATION`, `ERR_UNBALANCED_MEMBER`). Net positions do not change, so the residual to settle is the same before and after clearing. | [`ct030_clearing_property.rs`](https://github.com/x207-labs/contracts/blob/main/tests/ct030_clearing_property.rs) (random cycle graphs), [`ct029_clearing_flow.rs`](https://github.com/x207-labs/contracts/blob/main/tests/ct029_clearing_flow.rs) (competing solvers) |
| **Default model.** | A debtor that has not paid when `finalize_epoch` runs defaults: the shortfall is taken from that debtor's own stake first, then from the reserve. Creditors of the epoch are claimable in full. A defaulted member is `suspended`. | [`ct037_default_flow.rs`](https://github.com/x207-labs/contracts/blob/main/tests/ct037_default_flow.rs) |
| **Limits come from cash settlement.** | A member's credit limit grows only from residual paid in cash (`settled_history`), through `limit_growth`, and never above the stake. | [`ct034_limits.rs`](https://github.com/x207-labs/contracts/blob/main/tests/ct034_limits.rs) |
| **Cycle clearing is not history (ADR-08).** | A cycle that clears completely leaves no settlement record, `settled_history` stays 0, and the limit does not move. Clearing cannot be used to raise limits. | [`ct038_wash_trading.rs`](https://github.com/x207-labs/contracts/blob/main/tests/ct038_wash_trading.rs) (`cycle_clearing_does_not_raise_limits`) |
| **A barter bundle commits only with every participant's signature (F5, ADR-38).** | `commit_bundle` recomputes `terms_hash` from the legs, requires exactly one valid ed25519 signature per participant over it (`ERR_BUNDLE_SIGNATURES`), rejects a bundle with one leg or a leg that pays itself (`ERR_BAD_BUNDLE`), and rejects a payer whose legs exceed its free headroom (`ERR_BUNDLE_HEADROOM`). Nothing is written until the last check passes. | [`ct065_bundle.rs`](https://github.com/x207-labs/contracts/blob/main/tests/ct065_bundle.rs) (`commit_refusals_change_nothing`), [`ct063_bundle_vector.rs`](https://github.com/x207-labs/contracts/blob/main/tests/ct063_bundle_vector.rs) |
| **Bundle legs are ordinary debt (F5).** | A voucher that carries `bundleId` is registered with `register_in_bundle` against the reserved amount of its leg; after that the leg is an obligation like any other and is cleared by F3. A ring leaves a net of zero. | [`ct065_bundle.rs`](https://github.com/x207-labs/contracts/blob/main/tests/ct065_bundle.rs) (`bundle_legs_register_clear_and_leave_the_difference_as_residual`), [`tests/barter.sandbox.test.ts`](../tests/barter.sandbox.test.ts) |
| **Anti-sybil: stake is required.** | A member with no stake can be neither payer nor payee, and the growth term is clamped to the stake, so extra accounts without capital add no credit. | [`ct038_wash_trading.rs`](https://github.com/x207-labs/contracts/blob/main/tests/ct038_wash_trading.rs) (`member_without_stake_cannot_register`) |
