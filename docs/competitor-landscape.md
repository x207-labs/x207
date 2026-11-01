# Competitors and funded neighbours (UM-021)

What exists next to x207, and the gap x207 fills. Facts are taken from the project research report and the probes made during research. Adoption signals were checked in October 2026 and can have changed.

The gap: none of these clears across more than two parties with mutual credit. The multi-party gap is in the "Multi-party netting" column.

| Player | Model | Multi-party netting | Credit basis | Adoption signal | Source |
| --- | --- | --- | --- | --- | --- |
| 4Mica | Scheme `4mica-credit`, cycle clearing | No. Bilateral. Its docs say it "may also aggregate positions across many participants", without detail. | Collateral (Aave) | `/supported` lists Base mainnet (v1, v2), Sepolia, Base Sepolia. Core repo has 2 stars. | [4Mica docs](https://docs.4mica.io/core-concepts/bilateral-netting-cycles.md), [GitHub](https://github.com/4mica-Network) |
| AgentPay Barter | Escrow swap between two parties | No | None | Base only, 0 stars | [AgentPay](https://x402-agent-pay.com/x402-barter) |
| x402 `batch-settlement`, MPP sessions, Circle Gateway | Payment aggregation | No. One buyer to one seller. | Deposit or escrow | Backed by large companies | [x402.org](https://www.x402.org/writing/x402-batch-settlement), [Circle](https://developers.circle.com/agent-stack/agent-nanopayments) |
| x402 PR #2612 | Binding for prepaid fiat credit | No | Prepaid through a payment service provider | Discussion draft, open | [PR #2612](https://github.com/x402-foundation/x402/pull/2612) |
| Natural | Working-capital credit from lenders | No | Central underwriting. Series A of $30 million and a $100 million facility. The credit product was not live; the target was Q4 2026. | n/a | [FinTech Futures](https://www.fintechfutures.com/venture-capital-funding/natural-100m-credit-facility-upper90) |
| Catena Labs | Policy tooling, planned agent bank | No | About $48 million raised. The OCC charter application was "accepted for filing". | n/a | [The Block](https://theblock.co/post/402029/catena-labs-lands-30-million-series-a-files-for-national-trust-bank-charter-to-underpin-agentic-finance) |

No public facilitator checked in research supports NEAR or mutual credit. x402.org supports `exact`, `upto`, and `batch-settlement` on several chains but not NEAR. PayAI supports `exact` and `batch-settlement`.

The fastest threats are 4Mica turning on multi-party aggregation, x402 maintainers adding a credit binding, and Natural adding netting to its credit product.

Kite is named in the backlog item. The research report has no sourced entry for it, so it is not in the table. Add it when a source is found.
