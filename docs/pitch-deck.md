---
marp: true
title: x207 pitch
paginate: true
---

# x207

x402 lets agents pay. x207 lets many agents settle at once.

Multilateral clearing for agent payments on NEAR, with a stake-bound limit. Hackathon prototype, 1 to 14 Nov 2026.

<!-- Every number in this deck names its source on the same slide. Figures from our own runs are from the NEAR sandbox, not from a market. -->

---

## The problem

- Agents buy from each other in both directions. A translator buys summaries and a summarizer buys translations, yet each call is paid one by one.
- Existing schemes net or batch **between one pair** at a time, and capital must be deposited first (x402 `batch-settlement`: escrow channel, one payer and one receiver, EVM document; `coinbase/x402` specs, read 2026-11-02).
- Paying call by call moves the whole value of every payment. The usual fix, a channel per seller, needs a deposit per seller, sized before the sellers are known: either the whole budget is locked at each one or a new deposit is sent each time a channel runs dry. x207 locks one stake, at 125% of the budget, so it does not lock less than a well forecast channel.

---

## The solution

- Agents in a **circle** lock one stake each and pay with signed vouchers over the normal x402 flow. A voucher is a cumulative promise per pair and epoch, so 120 calls become 12 on-chain registrations, not 120 transactions. That saves gas only when a pair trades about 3 to 4 times or more per epoch (docs/gas-epoch8-vs-transfers.md).
- At the end of each epoch the contract **nets** every member's position in one on-chain step, and only net positions are settled in USDT; that is where the cash saving comes from. An open **solver** also removes debt cycles from the gross obligations. In the MVP that does not change who pays what (net positions do not change when a cycle is removed); it shrinks the record of gross obligations and is the basis for loss allocation on a default and for clearing across circles (roadmap).
- **For a swarm of agents:** many agents settle in one netting step per epoch, and one stake per member covers sellers it has not met yet (spike S1, see docs/problem-and-gap.md). The epoch steps and the solver are open to anyone. The solver's cycle clearing is an honest record of gross obligations and the base for loss allocation on a default (roadmap); it does not move cash.
- The limit comes from stake (at most the stake), so it is not credit without cash. A default is covered from the stake of the defaulter.

Source for the registration count: our sandbox run `npm run demo:sandbox`, 120 paid calls, `medium` density (docs/sandbox-demo.md).

---

## What is different

| | Multi-party clearing | Mutual credit | Open solver |
| --- | --- | --- | --- |
| x207 | Yes, all members, one transaction | Yes, limit from stake | Yes, best proposal wins |
| x402 `batch-settlement` | No, one buyer to one seller | No, escrow channel | No |
| 4Mica | Bilateral | No, collateral backed | Not documented |
| AgentPay Barter | No, swap of two | No, both sides deposit | No |

Sources: x402 spec directory `coinbase/x402/specs/schemes`; [4Mica docs](https://docs.4mica.io/core-concepts/bilateral-netting-cycles.md); [AgentPay](https://x402-agent-pay.com/x402-barter); all checked in `docs/competitor-landscape.md`, Oct 2026. These can change.

x207 is an **evolution** of x402, not a replacement: it keeps the 402 flow and adds multilateral clearing on a stake-bound limit, barter and a marketplace (docs/problem-and-gap.md, with a proof for each row).

---

## What is new

1. A multi-party x402 `batch-settlement` binding on NEAR, as far as we found: [x402-foundation/x402#4131](https://github.com/x402-foundation/x402/issues/4131), proposed and not yet accepted.
2. Cumulative vouchers netted once per epoch across many buyers and sellers.
3. One stake for sellers that are not known in advance (spike S1: with an exact forecast a channel locks less).
4. An EVM agent signing EIP-712 can join: `join_evm` ran on testnet, transaction `GD92fvfjRMjmdRfDW3d8PqCft7GzPyiAGX6hLTjJ3E8A` on `x207-v014.testnet`, signed with the public Hardhat test key #1: a technical proof, not a demo agent (the demo follows with a new key). The rest is in progress, not deployed.

---

## Does netting really save anything?

| Evidence | Result | Source |
| --- | --- | --- |
| Value removed by clearing in a real mutual credit circuit (Sardex, 3,199 firms, 138,378 transactions in 2019) | about 23% of value per monthly batch | Fleischman, Dini, Littera, JRFM 2020 (other researchers, human firms) |
| Our sandbox, 6 agents, `medium` density, 120 calls | cleared ratio 0.6333, 6 residual payments, 1 clearing transaction | `npm run demo:sandbox`, 2026-11-02 |
| Our sandbox, `low` density, 60 calls | cleared ratio 0.5, 5 residual payments | same |
| Star-shaped payment graph (everyone pays one hub) | 0, no cycle | `docs/relief-curve.md` (synthetic graphs) |

The cash saving is the netting of positions and does not need the solver: in epoch 16 of the testnet circle five vouchers of 8 credit went round one cycle, `cleared` was 0, every net position was 0 and nobody paid. Cycle clearing (21.8 of the gross obligations in epoch 8) does not change what anyone pays in the MVP. The sandbox circle is dense on purpose (ADR-16). These are properties of the mechanism on those graphs, not an estimate of any market.

---

## Market reality, stated plainly

- Agent payment volume is small. Chainalysis counted more than 100 million agentic transactions on Base up to Q1 2026 and concluded that mass adoption remains distant; analyses that filter wash trading (a16z, TRM Labs) reduce the headline figures sharply. Source: the project research report, summarized in README section 8; the figures are quoted from those reports, not measured by us.
- Real payment graphs are star-shaped with few cycles, so netting and clearing help little there.
- x207 does not create demand. It lowers the cost of small payments between agents that already trade with each other, and it adds barter where money is not the natural unit.

---

## What exists today

- Contract `x207-circle` (stake, vouchers, clearing, residual settlement, default, DAO `set_params`, barter bundles) with tests in near-sandbox.
- Binding `x207:<circleId>` for x402, a reference facilitator, a solver, a keeper and an indexer with the 207 report.
- Six demo agents, a dashboard, a marketplace of listings and negotiation, a seeker that earns a share, business and invoice demos.
- Tests: contract and sandbox suites run locally; the repositories run them in GitHub CI (see the Actions tab of each repository).

---

## Roadmap

| Next | Why |
| --- | --- |
| Run on testnet and then mainnet with small amounts | Sandbox results are not network results; mainnet needs the owner's approval |
| Publish `@x207/core` and `@x207/scheme` | Others can integrate without cloning (SD-045, pending) |
| Propose the scheme spec to the x402 Foundation | Move from a binding to a shared standard |
| Many circles and clearing across circles | One circle is a prototype |
| Delivery adapters for assets other than services (access, TEE broker) | Barter beyond service calls. Class B (function-call keys) runs in sandbox; class A (NFT escrow) and the class C proxy (mock provider, no TEE) run in sandbox only; the TEE and real providers are roadmap |
| Confidential settlement | The public ledger shows who owes whom |

---

## Try it

```bash
npm install
npm run demo:sandbox        # one epoch end to end
npm run demo:marketplace    # listings, negotiation, seeker, bundles
```

README: what x207 is, the problem, how it works, and a "do X, see Y" table for every demo.
