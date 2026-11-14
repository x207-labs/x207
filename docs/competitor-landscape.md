# Competitors and funded neighbours (UM-021)

_Kept in step with the [README](../README.md) by UM-120. Start there._

What exists next to x207, and the gap x207 fills. Facts are taken from the project research report and the probes made during research. Adoption signals were checked in October 2026 and can have changed; the rows were not re-checked on 2026-11-04.

The gap, as far as this table shows: one player, ACH, nets across more than two parties on NEAR, but over invoices that every participant approves and that each net debtor funds in advance, with no credit and no barter of assets. No row combines signed vouchers that the seller serves at once, an open solver whose proposal the contract checks, and a default covered from the debtor's stake. That combination is what x207 builds, and the "Multi-party netting" column shows who clears across more than two parties.

| Player | Model | Multi-party netting | Credit basis | Adoption signal | Source |
| --- | --- | --- | --- | --- | --- |
| 4Mica | Scheme `4mica-credit`, cycle clearing | No. Bilateral. Its docs say it "may also aggregate positions across many participants", without detail. | Collateral (Aave) | `/supported` lists Base mainnet (v1, v2), Sepolia, Base Sepolia. Core repo has 2 stars. | [4Mica docs](https://docs.4mica.io/core-concepts/bilateral-netting-cycles.md), [GitHub](https://github.com/4mica-Network) |
| AgentPay Barter | Escrow swap between two parties | No | None | Base only, 0 stars | [AgentPay](https://x402-agent-pay.com/x402-barter) |
| x402 `batch-settlement`, MPP sessions, Circle Gateway | Payment aggregation | No. One buyer to one seller. | Deposit or escrow | Backed by large companies | [x402.org](https://www.x402.org/writing/x402-batch-settlement), [Circle](https://developers.circle.com/agent-stack/agent-nanopayments) |
| ACH v4 (`NSEVEjk0/ACH`) | Clearing house for agent invoices: multilateral netting in a Rust vault on NEAR testnet, every participant approves, each net debtor reserves its funds; private netting through OutLayer and Intents payouts (preview) per its README | Yes | Funds reserved by the net debtor, no credit | NEAR testnet; repository recreated 2026-11-10, hosted demo | [github.com/NSEVEjk0/ACH](https://github.com/NSEVEjk0/ACH) (checked 2026-11-14; the 2026-11-13 check found the old repository gone) |
| Loca (`redaicodes/loca`) | Credit line for agents: lenders fund offers against paid orders in escrow | No | Lender underwriting, on-chain score, operator bond | NEAR with 1Click | [github.com/redaicodes/loca](https://github.com/redaicodes/loca) |
| x402 PR #2612 | Binding for prepaid fiat credit | No | Prepaid through a payment service provider | Discussion draft, open | [PR #2612](https://github.com/x402-foundation/x402/pull/2612) |
| Natural | Working-capital credit from lenders | No | Central underwriting. Series A of $30 million and a $100 million facility. The credit product was not live; the target was Q4 2026. | n/a | [FinTech Futures](https://www.fintechfutures.com/venture-capital-funding/natural-100m-credit-facility-upper90) |
| Catena Labs | Policy tooling, planned agent bank | No | About $48 million raised. The OCC charter application was "accepted for filing". | n/a | [The Block](https://theblock.co/post/402029/catena-labs-lands-30-million-series-a-files-for-national-trust-bank-charter-to-underpin-agentic-finance) |

One facilitator for NEAR exists: `fastnear/x402-facilitator`, live for the `exact` scheme on `near:mainnet` (one payment per call, no credit, no batch-settlement). No public facilitator checked in research supports mutual credit. x402.org supports `exact`, `upto`, and `batch-settlement` on several chains but not NEAR. PayAI supports `exact` and `batch-settlement`. fastnear settles each call on NEAR; x207 settles the whole circle, and keeps an `exact` entry next to its own for buyers outside the circle.

The fastest threats are 4Mica turning on multi-party aggregation, x402 maintainers adding a credit binding, and Natural adding netting to its credit product.

Kite is named in the backlog item. The research report has no sourced entry for it, so it is not in the table. Add it when a source is found.

## Where x207 stands

The contract (release v0.0.13) runs on NEAR testnet as the circle `x207-v013.testnet`. Epoch 8 there cleared 21.8 of 41.35 credit and left 7.75 USDT to move, paid in a mock USDT (testnet, `usdt.x207-deployer.testnet`); the figures and the commands that check them are in the [README](../README.md#what-epoch-8-showed) and in [what-has-run](what-has-run.md). The 1Click path that Loca also uses was only quoted (`dry: true`, BE-090), and NEAR Intents has not run on testnet. No mainnet transaction has been sent, so none of this is a claim of adoption.
