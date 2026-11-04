# Appendices: judging criteria, glossary, traceability

_Moved from the README appendices. The content is unchanged; paths are relative to this folder. Start at the [README](../README.md)._

## Appendix A: judging criteria and tracks

Where this README answers each judging criterion. The evidence column lists only what exists today.

| Criterion | Where | Evidence now |
| --- | --- | --- |
| Technical implementation | Sections 3, 5 and 7; [`docs/traceability.md`](traceability.md) | Contract, SDK, facilitator, indexer, solver and agents run together in one sandbox epoch (`npm run demo:sandbox`); F5 barter bundles and the F9 marketplace run on the same stack (`npm run demo:marketplace`, `tests/barter.sandbox.test.ts`); sandbox tests in `tests/`. No mainnet run yet. A testnet rehearsal of F5 and F9 ran on 2026-11-03 with mock USDT; F8, NEAR Intents and the DAO vote have not run on testnet. |
| Design | Sections 3 and 4 | Frontend pages for onboarding, obligation graph, settlement, claim, withdrawal and the marketplace negotiation view run against fixtures and a mock wallet. Not shown with a real wallet yet. The listing, offer, bundle and referral formats have test vectors (`sdk/spec/`) and a conformance suite (`sdk/conformance`). |
| Impact | Sections 8 and 9 | The demo prints the number of paid calls and the residual payments it became (for example 120 became 6) from epoch data. Real agent volume is small and the README says so. |
| Originality | Section 2 and `docs/competitor-landscape.md` | Comparison table, and the table that sets x207 next to x402 as published. Barter bundles and a seeker paid inside the bundle are in the sandbox demo; we did not survey every x402 layer. |
| Sustainability | Section 8 | Fee flow and risk table. The seeker share and the cashback come out of the discount that the listing agent sets, so F9 needs no subsidy. No revenue data. |

Tracks. The 8 tracks below are the owner's choice (K-59); a track is claimed only for what is in the repository today. The hint tracks used and not used are stated so that no hint is claimed by accident.

| Track | Feature | Demo step | Evidence now | Not shown |
| --- | --- | --- | --- | --- |
| `swarms` | F2, F3, F5 | F2, F3 rows; [Barter bundle block](demo-blocks.md#barter-bundle-block-feature-f5) | Many agents paying and clearing in one epoch; a three-agent ring cleared to net zero (`tests/barter.sandbox.test.ts`) | A swarm of real model-driven agents; agents run in rule or mock mode |
| `agents` | F1, F2, F9 | F1, F2 rows; [Marketplace block](demo-blocks.md#marketplace-block-feature-f9) | Printed 402 with the x207 and `exact` entries; agents list, negotiate and settle by policy (`tests/marketplace.sandbox.test.ts`) | Live NEAR AI inference; any mainnet payment |
| `defi` | F3, F4 | F3, F4 rows | Multi-party clearing and residual settlement in USDT on a mock token in sandbox | NEAR Intents and 1Click payments: they need a mainnet run (UM-027, UM-035) that has not happened. This track is weak until it does. |
| `social` | F6, F7 | F6 and F7 rows | Default case: stake cut, member suspended, 409 in the 207 report (sandbox and testnet). A DAO vote on `set_params` with two council votes ran on testnet | Not on mainnet; the dashboard governance page was not shown with the real value |
| `business` | F2 | [Business and invoice blocks](demo-blocks.md#business-and-invoice-blocks-tracks-business-and-realworld) | The owner's limits are enforced before any voucher is signed (3 approved, 3 refused in the run) | A business that uses it outside the demo |
| `realworld` | F1, F4 | Same blocks, `npm run demo:realworld` | Three businesses, invoices as vouchers, netting, residual 40 of 240 | A demo scenario only. No real invoice, dispute or legal status; no 1Click payout |
| `security` | F6 | F2, F6 rows; section 8 "Reviews"; [docs/security.md](security.md) | Agent keys sign only vouchers and cannot move funds; credit limit capped by stake; our reviews of the contract (twice, the second by a reader who did not write it), the facilitator, the SDK and the frontend found and fixed a replay in parallel requests, a signing oracle in the frontend and a hold on a voucher by a forged request, with tests; the contract wasm is built reproducibly and a deployed `code_hash` is checked against the release (CT-087) | No external audit. Findings reported in the last review are open until the contract owner fixes them (see docs/security.md) |
| `open` | F5, F9 | [Marketplace block](demo-blocks.md#marketplace-block-feature-f9) | A layer on top of x402 with barter and an open listing format; the barter ring and the quick barter ran on testnet | Not on mainnet; testnet used a mock USDT |

Hints used: multi-agent systems, agent commerce, NEAR Intents (code in `backend/src/settlement/`, not run on a network), sub-accounts, Sputnik DAO, named accounts, stablecoins. Hints not used: Chain Signatures, trading, TEE attestation. The circle contract implements the receiver of NEP-245 multi-tokens (`mt_on_transfer`, for a residual paid through NEAR Intents) and that part has run only against a mock. Tracks not submitted: `privacy` (confidential settlement is roadmap, ADR-15), `thesis`, `games`, `nfts`, `memecoins`.

## Appendix B: glossary

| Term | Meaning in x207 |
| --- | --- |
| Credit circle | A group of agents that extend credit to each other. One `x207-circle` contract per circle; the network ID is `x207:<circleId>`. |
| Cumulative voucher | A payment commitment signed with ed25519 by the payer for each `(payer, payee, epoch)`. Each call raises `seq` and `cumulativeAmount`. Only the latest voucher is registered. |
| `seq` | A monotonic sequence number per pair per epoch. It prevents double-spend. |
| Headroom | `limit − registered obligations − accepted vouchers not yet registered`. A voucher is rejected if its increase in `cumulativeAmount` exceeds it. |
| Epoch | An accounting period: open, cutoff, clearing, commit, payment window, finality. |
| NID | Net internal debt: the total debt left after all cycles are removed. It is the minimum that must be paid in cash. |
| Residual | The net difference per member after clearing, paid or claimed in USDT. |
| 207 report | A `207 Multi-Status` response with one status per member: `200` zero, `402` must pay, `202` can claim, `409` default. |
| Haircut | A cut to the claims of the direct creditors of a defaulting debtor when stake and reserve do not cover the loss. It does not cascade. |
| Solver | Anyone who computes and submits a clearing proposal. A solver is paid a fee. |
| Facilitator | An x402 service that verifies and settles payments (`/verify`, `/settle`, `/supported`). In x207 it only relays. |

## Appendix C: traceability

- [docs/traceability.md](traceability.md): feature, code, tests and demo step for F1 to F9, and the spike probes repeated with product code.
- [docs/crud-matrix.md](crud-matrix.md): which process writes which store, checked against the contract source by a test.
- [docs/external-interfaces.md](external-interfaces.md): external interfaces E1 to E8.
- [docs/capital-provider-guide.md](capital-provider-guide.md): guide for capital providers.
- [docs/testnet-rehearsal.md](testnet-rehearsal.md): testnet rehearsal with transaction hashes.
