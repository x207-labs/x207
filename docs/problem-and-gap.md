# The problem, the gap and the FAQ

_Moved from the README section 2. The content is unchanged; paths are relative to this folder. Start at the [README](../README.md)._

## 2. The problem

1. **Micro-payments are small and frequent.** Paying each call one by one repeats fees on every call, and some cross-chain routes have minimums far above the price of a call.
2. **Agents buy from each other in both directions.** A translator buys summaries and a summarizer buys translations. Money moves back and forth although most of it could cancel out.
3. **Existing solutions involve two parties.** They net or batch between one pair at a time, not across a chain of agents.
4. **Agents cannot borrow safely.** There is no standard way to give an agent working capital without locking the full amount up front.

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

What we checked on 2026-11-02 in the public x402 repository (`coinbase/x402`, `specs/schemes`): the schemes `exact`, `upto`, `batch-settlement` and `auth-capture` exist. The `batch-settlement` document describes an EVM escrow channel with cumulative off-chain vouchers claimed in batches, one payer and one receiver per channel. It does not mention credit or netting between several parties, and it covers EVM only. We did not read the other scheme documents in detail and x402 changes, so recheck before relying on a row.

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

These are results of other researchers on human firms, not results of x207. The simulation forced 100% participation.

### FAQ

**Why not just net positions?** Net positions tell each member its balance, but they are not a settlement. A balance sheet has no proof of each debt (here every debt is a cumulative voucher signed by the payer), no bound on how much a member can owe (here `limit ≤ stake`), and no rule for who pays whom or for a member that does not pay (here the residual settlement, the payment window and the stake cut at default). Clearing removes cycles and leaves every net position unchanged; the contract checks that on the proposal, and `edges_hash` binds the proposal to the obligations it cleared.

**How does x207 relate to the fastnear x402 facilitator?** fastnear settles each call on NEAR. x207 settles the whole circle. They fit together: a seller advertises the x207 entry next to an `exact` entry in the same 402 answer, and a buyer outside the circle pays with `exact` through any facilitator that supports NEAR, fastnear's included.

**Why not 4Mica?** 4Mica nets between two parties, and its credit is backed by collateral. x207 clears across many parties, and its limit grows from cash settlement history. 4Mica could add multi-party aggregation later. Its scheme `4mica-credit` has no public spec, while x207 follows the official `batch-settlement` scheme.

**Why does clearing not run directly in NEAR Intents?** The Intents Verifier contract (`intents.near`) does not support negative balances and cannot restrict where tokens move inside it. It has no native mint on mainnet. It also needs a fresh signature from every party in each round. Clearing therefore runs in the x207 contract, and Intents is used only for the residual payment and the creditor withdrawal (ADR-01, ADR-02).
