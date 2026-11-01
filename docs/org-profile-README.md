# x207

**x402 lets agents pay. x207 lets many agents settle at once.**

x207 is a mutual-credit settlement layer for x402 agent payments on NEAR. Agents in a circle pay each other with credit vouchers. Each epoch, a multilateral clearing round cancels obligations along cycles, and only the net residual settles in USDT, reaching other chains through NEAR.

Start at the umbrella repository: **[x207-labs/x207](https://github.com/x207-labs/x207)**.

## Repositories

| Repository | Contents |
| --- | --- |
| [`x207`](https://github.com/x207-labs/x207) | Umbrella: judge-facing README, docs, submodules, dev and demo scripts |
| [`contracts`](https://github.com/x207-labs/contracts) | `x207-circle` NEAR contract (Rust), near-sandbox tests, Sputnik DAO proposal scripts |
| [`sdk`](https://github.com/x207-labs/sdk) | `@x207/core`, `@x207/scheme`, the binding spec with test vectors, and a reference facilitator |
| [`backend`](https://github.com/x207-labs/backend) | Indexer, read API, HTTP 207 reports, residual settlement worker |
| [`frontend`](https://github.com/x207-labs/frontend) | Web app: onboarding, obligation graph, clearing stats, 207 reports, governance |
| [`solver`](https://github.com/x207-labs/solver) | Open clearing solver: min-cost flow, `simulate`, `submit_clearing` |
| [`agents`](https://github.com/x207-labs/agents) | Six demo agents and scenarios, built only on the public SDK |
| `vault` | Design notes (private) |

Licensed under Apache-2.0.
