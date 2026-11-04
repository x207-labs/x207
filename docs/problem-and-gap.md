# The problem, the gap and the FAQ

_Moved from the first, longer README (its section 2) and edited since. Paths are relative to this folder. Start at the [README](../README.md)._

## 2. The problem

1. **Micro-payments are small and frequent.** Paying each call one by one repeats fees on every call, and some cross-chain routes have minimums far above the price of a call.
2. **Agents buy from each other in both directions.** A translator buys summaries and a summarizer buys translations. Money moves back and forth although most of it could cancel out.
3. **Existing solutions involve two parties.** They net or batch between one pair at a time, not across a chain of agents.
4. **Paying call by call locks cash and moves more value than needed.** An agent must hold the full price of each call before it buys, and every payment moves its whole amount even when the parties owe each other in both directions. x207 answers with clearing and a bounded limit, and it is honest about the price:
   - **What it saves.** The value that has to move: in epoch 8 of `x207-v013.testnet`, 7.75 of 41.35 credit of obligations (18.7%) became USDT payments, because 21.8 was cancelled by the clearing. The residual of several debtors can be paid in one NEAR Intents call, and a creditor can withdraw to another chain (run in `near-sandbox` only; see [what-has-run.md](what-has-run.md)). A member's limit grows from its cash settlement history, inside `limit ≤ stake`.
   - **What it does not save.** Gas on NEAR: 109.7 Tgas for the epoch (226.6 with the 24 vouchers registered) against 54.9 Tgas for 24 plain transfers ([gas-epoch8-vs-transfers.md](gas-epoch8-vs-transfers.md)).
   - **What it does not give.** Credit without cash. In the MVP the capital locked is at least 125% of the debt a member can run up (`limit ≤ stake`); in epoch 8 the stake was 1,499.10 against 41.35 of obligations. A limit above the stake is roadmap work, and nothing is borrowed from outside the circle.
   - **When it helps.** Only where debts go in cycles (see [where cycles come from](#where-cycles-come-from)).

### What exists and the gap

| System | Multi-party clearing | Mutual credit | Open solver | Chain reach |
| --- | --- | --- | --- | --- |
| x207 | Yes. Cycles across all members are removed in one transaction, and the contract checks the proposal in O(n). | Yes. The limit comes from stake and cash settlement history. In the hackathon version `limit ≤ stake`. | Yes. Any solver can submit, and the proposal with the largest cleared total is kept. | Residuals leave to other chains through NEAR Intents and 1Click. |
| 4Mica | Bilateral. Its docs mention aggregating many participants without detail. | No. Credit is backed by collateral. | Not documented. | Base mainnet and test networks when we checked. |
| x402 `batch-settlement` | No. One buyer to one seller. | No. The capital-backed model uses escrow or channels. | No. There is no clearing step. | Chains that have a binding. On NEAR, `fastnear/x402-facilitator` is live for `exact` (one payment per call); we found no `batch-settlement` binding for NEAR. |
| AgentPay Barter | No. A swap between two parties. | No. Both sides deposit first. | No. | Base only. |
| Central clearing (Sardex, human brokers) | Yes, run by the operator. | Yes. | No. The operator clears. | Not applicable. It is a closed ledger of one operator. |
| ACH (`NSEVEjk0/ach`, NEAR testnet) | Yes. Agents register debts in a contract, which computes the net positions of all open obligations and settles them in one atomic call. | A credit limit and a collateral ratio set by the owner; disputes are resolved by the owner. | No separate solver: the contract does the netting itself. | NEAR. |
| Loca (`redaicodes/loca`, NEAR) | No clearing. It is a credit line for agents: lenders fund offers against orders that a customer already paid into escrow. | Yes, lender-underwritten, with an on-chain score and an operator bond. | No. | NEAR, with 1Click for payment from other chains. |
| Other competitors locked to one network | None found in our research that clears many parties beyond ACH. | Varies: collateral, prepaid credit, or lender underwriting. | No. | One network each. |

The rows for ACH and Loca come from their public READMEs, read on 2026-11-04. We did not run their code. The difference to x207 is what each row says: x207 proves each debt with a signed voucher, lets any solver propose the clearing, checks the proposal in the contract, and grows a credit limit from cash settlement history inside the bound `limit ≤ stake`.
| Proprietary schemes (for example `4mica-credit`) | Not specified publicly. | Not specified publicly. | Not specified publicly. | Per vendor network. |

x207 is the binding of the official `batch-settlement` scheme on a new network, `x207:<circleId>`. It does not define a new scheme.

### x207 as an evolution of x402, not a replacement

x207 keeps the x402 flow (HTTP 402, a payment requirement, a signed payload, a facilitator) and registers a binding for the official `batch-settlement` scheme on a new network. Each row below names a limit of x402 as published, what x207 adds on top, and where the repository proves it. A row with no proof is not claimed.

What we checked on 2026-11-04 in the public x402 repository, now `x402-foundation/x402` (`specs/schemes`): the schemes `exact`, `upto`, `batch-settlement` and `auth-capture` exist. The `batch-settlement` spec has a general document and one document per network (`evm`, `svm`, `cloudflare`). The general document lets a network binding choose one of two trust models for backing the client's commitment:

- **Capital-backed.** The commitment is backed by onchain capital committed before or during the session (pre-funded escrow, a payment channel, or a delegated authorization against a wallet balance). The trust anchor is the client's own funds. The EVM channel is of this kind.
- **Credit-backed.** The commitment is backed by a verified identity tied to a billing account that a trusted network intermediary manages. No onchain capital is required from the client. The binding `cloudflare:402` is of this kind: Cloudflare authenticates the caller with HTTP Message Signatures and acts as merchant of record.

**Where x207 sits.** x207 is not credit-backed in the x402 sense: no intermediary underwrites a buyer, and the facilitator is a relayer without custody. Its credit comes from capital that members lock in the contract (`limit ≤ stake` in the MVP), so the trust anchor is the members' own stake and a reserve fund, with explicit loss allocation (ADR-18). That puts it nearest to capital-backed. The design notes call this model "hybrid" because the stake is shared across a circle rather than escrowed per seller; the x402 spec itself defines only the two models above, and we do not claim that it recognizes a third. What x207 adds to the capital-backed model is clearing across members, so a seller does not need an escrow channel per buyer. It does not remove the need for capital: the capital locked is at least 125% of the debt in the MVP. We have not proposed the x207 binding to the x402 Foundation yet; it is a roadmap item. The scheme documents we did not read in full may differ, and x402 changes, so recheck before relying on a row.

| x402 today (as checked) | What x207 adds | Proof in this repository |
| --- | --- | --- |
| Settlement per request on `exact`; `batch-settlement` batches claims but needs funds escrowed in a channel first | A cumulative voucher per payer and payee backed by a credit limit from stake, not an escrow per seller; the facilitator holds the latest voucher and registers one transaction per pair | `npm run demo:sandbox`: 120 paid calls became 12 registrations; verify tests in `sdk/packages/scheme/test/verify.test.ts` |
| One payer and one receiver per channel; no netting between several parties | Clearing across all members in one transaction; cycles of debt cancel and only the residual is paid | `tests/f3.sandbox.test.ts` and the F3 rows of the sandbox demo (cleared ratio read from the epoch metrics) |
| The scheme document covers EVM only | The same scheme name bound on NEAR as `x207:<circleId>` with a NEAR contract and facilitator | `agents/test/ring.sandbox.test.ts` (402 offers `batch-settlement@x207:agents-main` and `exact@near:mainnet`); testnet rehearsal in `demo/network.demo.ts` |
| The scheme documents we read describe payment in a token, not goods-for-goods | Barter bundles: several parties sign one `terms_hash`, the contract checks the signatures and a reserved headroom per leg, then the legs clear like any debt | `tests/barter.sandbox.test.ts` (three intents, solver ring, leg vouchers with a bundle id, zero residual) |
| Negotiating a price or a swap between agents is outside the payment scheme (we did not evaluate other x402 layers such as discovery) | An off-chain listing book, signed offers per round, discount barter, and a seeker that is paid a share as a leg of the same bundle | `tests/marketplace.sandbox.test.ts` and `npm run demo:marketplace` |
| Funds must be deposited into the channel before paying | A voucher over the free headroom is refused with `insufficient_credit` and the client falls back to the `exact` entry that stays in the same 402 | `sdk/packages/scheme/test/select.test.ts`, `verify.test.ts` |

Not claimed: that x402 lacks anything beyond what the table says (for example, discovery services around x402 were not evaluated), that x207 is audited, safer or cheaper in every case, or that it is used widely. Wide use is a goal, not a result. Goods are not judged by the protocol: a barter bundle fixes who pays whom, not whether the goods were good.

### Why this works: Sardex 2019

The mechanism has been measured outside agents. Fleischman, Dini and Littera (JRFM 2020) studied Sardex, a mutual credit circuit of 3,199 firms and 138,378 transactions in 2019.

| Measure | Result in the paper |
| --- | --- |
| Value removed by clearing alone, per monthly batch | About 23–25% (23.1% of value, range 18.6–26.3%) |
| Net internal debt removed by clearing and mutual credit together, in simulation | About 50% (about 25% with clearing alone) |

These are results of other researchers on human firms, not results of x207. The simulation forced 100% participation. Paper: [doi:10.3390/jrfm13120295](https://doi.org/10.3390/jrfm13120295).

### Where cycles come from

Clearing removes value only when debt goes round in a loop. A pays B, B pays C and C pays A leaves nothing to pay once the loop is cancelled; a buyer that only pays a seller leaves everything to pay. So the question for x207 is where loops appear in real agent trade. We name three places, and one place where they do not appear.

**Where they do not appear: star graphs.** Measured x402 traffic on Base is mostly of this shape. A population-scale study of 280 days of settlements ([arXiv:2607.12575](https://arxiv.org/abs/2607.12575), Ling et al., 14 Jul 2026, abstract read on 2026-11-04) resolves the manufacturable part of the count into "a coherent operator-driven economy, star-shaped, machine-timed, and gas-subsidized". A star has one hub and no cycle, so x207 gains nothing from it. The synthetic star graph in [relief-curve.md](relief-curve.md) shows the same: relief 0.00%, and 29 residual payments for 29 edges. If an agent only buys from services and never sells, x207 is the wrong tool. It adds a voucher and a stake, and gives nothing back.

**Where they can appear, and what we have and have not shown:**

1. **Subcontracting on NEAR Agent Market.** The documentation of the market says: "Agents can hire too. The same MCP surface an agent uses to do work also lets it hire other agents, so an agent can subcontract part of a job." ([docs.market.near.ai](https://docs.market.near.ai/), read on 2026-11-04.) When agent A hires B, B hires C for part of the job and C buys a service from A, a loop exists. We have no data on how often this happens on the market, and we did not integrate x207 with it. This is a place to look for loops, not a result.
2. **A swarm run by one operator.** One team that runs a set of specialised agents (a researcher, a summarizer, a translator, a fact checker) lets them buy from each other in both directions. This is the shape of problem 2 above. The demo `npm run demo:swarm` and epoch 8 of `x207-v013.testnet` (24 vouchers between 15 members, 21.8 of 41.35 credit cancelled) are of this kind, but they are built by us: the graph is dense on purpose (ADR-16), so they show that the mechanism works, not that outside traffic has this shape. An operator that controls every agent could also net its own books without a protocol; the gain appears when several operators' agents trade with each other.
3. **A B2B network of firms.** This is the setting where clearing was measured: the Sardex circuit above, with about 23–25% of value removed per monthly batch among 3,199 firms. Those are human firms and invoices, not agents. The `realworld` block of the demo (`npm run demo:realworld`) shows invoices as vouchers in a scenario; it is not a deployment with real businesses.

**How much x402 traffic there is, as reported.** Trackers disagree and their numbers must not be mixed. CoinDesk reported for the 30 days to mid-July 2026 about 75 million transactions and $24 million, an average of about $0.32, with about 94,000 buyers and 22,000 sellers ([CoinDesk](https://www.coindesk.com/tech/2026/07/15/visa-mastercard-and-ripple-join-the-standard-letting-ai-agents-pay-in-stablecoins), 2026-07-15). Artemis figures, quoted by [LetsDataScience](https://letsdatascience.com/news/x402-reveals-approval-gap-in-agentic-micropayments-761bf8e7) (2026-05-27), put adjusted monthly volume at $1.19 million in May 2026, down 77% from $5.15 million in November 2025, with an average of $0.52. American Banker reported daily volume falling from about $800,000 in January 2026 to about $40,000 in September; its headline says 93%, the body implies about 95%, and it does not name who measured ([American Banker](https://www.americanbanker.com/payments/news/agentic-payment-rail-shows-volume-decline), 2026-09-18). All pages read on 2026-11-04. So the volume is small and has fallen, payments are cents, and x207 does not create demand; it is for circles that already trade in both directions.

**What this means for adoption.** x207 is for circles whose members both buy and sell. It does not claim that today's x402 traffic is of that kind; the study above says it mostly is not. The relief depends on graph density and is low on sparse graphs (see [metrics-and-roadmap.md](metrics-and-roadmap.md#relief-against-graph-density)). A circle that finds no loops still gets the other parts (a signed voucher per debt, one registration per pair, a limit backed by stake, and cover for a debtor that does not pay), but it pays for them in gas and locked capital (see [gas-epoch8-vs-transfers.md](gas-epoch8-vs-transfers.md)).

### FAQ

**Why not just net positions?** Net positions tell each member its balance, but they are not a settlement. A balance sheet has no proof of each debt (here every debt is a cumulative voucher signed by the payer), no bound on how much a member can owe (here `limit ≤ stake`), and no rule for who pays whom or for a member that does not pay (here the residual settlement, the payment window and the stake cut at default). Clearing removes cycles and leaves every net position unchanged; the contract checks that on the proposal, and `edges_hash` binds the proposal to the obligations it cleared.

**How does x207 relate to the fastnear x402 facilitator?** fastnear settles each call on NEAR. x207 settles the whole circle. They fit together: a seller advertises the x207 entry next to an `exact` entry in the same 402 answer, and a buyer outside the circle pays with `exact` through any facilitator that supports NEAR, fastnear's included.

**Why not 4Mica?** 4Mica nets between two parties, and its credit is backed by collateral. x207 clears across many parties, and its limit grows from cash settlement history. 4Mica could add multi-party aggregation later. Its scheme `4mica-credit` has no public spec, while x207 follows the official `batch-settlement` scheme.

**Why does clearing not run directly in NEAR Intents?** The Intents Verifier contract (`intents.near`) does not support negative balances and cannot restrict where tokens move inside it. It has no native mint on mainnet. It also needs a fresh signature from every party in each round. Clearing therefore runs in the x207 contract, and Intents is used only for the residual payment and the creditor withdrawal (ADR-01, ADR-02).
