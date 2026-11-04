# What is x207

_Moved from the first, longer README (its section 1) and edited since. Paths are relative to this folder. Start at the [README](../README.md)._

## 1. What is x207

**Pitch:** x207 lets agents in a credit circle pay each other with signed vouchers, clears debt cycles across all of them in one on-chain transaction, and settles only the net difference in USDT.

x207 is built as a binding of the x402 `batch-settlement` scheme on the network `x207:<circleId>`. Agents that are not in a circle can still pay with the `exact` scheme on NEAR.

| Step | What happens | Feature |
| --- | --- | --- |
| 1 | The agent owner joins a circle and locks a stake in USDT. The stake bounds what the agent can owe (the credit limit, at most 80% of the stake). | F1 |
| 2 | An endpoint answers `402`. The agent pays with a signed credit voucher, the resource is served at once, and the debt is recorded in the contract. | F2 |
| 3 | At the end of the epoch any solver computes the cycles to clear. The contract verifies and removes them in one transaction. A 207 report gives one status per member. | F3 |
| 4 | Only the net difference is paid in USDT. Creditors claim, and can withdraw to other chains through NEAR Intents and 1Click. | F4 |
| 5 | Agents agree a barter, alone or in a ring, and every participant signs the same `terms_hash`. The contract checks the signatures and reserves headroom per leg. The legs then clear like any other debt. | F5 (sandbox) |
| 6 | A default is covered from the stake, then the reserve, then a haircut. The limit grows only from cash settlement. | F6 |
| 7 | Circle parameters are set by Sputnik DAO proposals. | F7 |
| 8 | Agents list what they offer and want, negotiate in rounds, and a seeker earns a share for bringing in a counterparty. A deal becomes a step-5 bundle. | F9 (sandbox) |

### What it means for each audience

| Audience | Message |
| --- | --- |
| Agent developers | Keep using the x402 SDK and register the x207 binding next to it. Calls are paid with vouchers, with no transfer per call. |
| API providers | Add a `batch-settlement` entry to the `accepts` list of the 402 response. The facilitator verifies each voucher. The seller carries a delay risk until the voucher is registered. |
| Investors and capital providers | The stake backs what each member can owe (at least 125% of the debt) in the hackathon version. [docs/security-and-limits.md](security-and-limits.md) and [docs/metrics-and-roadmap.md](metrics-and-roadmap.md) state what is and is not proven. |
| Ecosystem and standards | x207 follows the x402 scheme structure so that it can be proposed as a scheme spec. The proposal is planned, not made. |
