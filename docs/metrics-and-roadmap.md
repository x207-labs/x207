# Metrics and roadmap

_Moved from the first, longer README (its sections 9 to 11) and edited since. Paths are relative to this folder. Start at the [README](../README.md)._

## 9. Metrics

x207 is measured by value, not by transaction count. A circle that clears a large value in few transactions scores well; a circle with many small transactions that clears little does not.

| Metric | Definition | API field |
| --- | --- | --- |
| Cleared ratio | Value removed by clearing ÷ total voucher value per epoch | `clearedRatio` |
| Transfer savings | Number of vouchers ÷ number of residual payments | `transferSavings` |
| Net debt reduction | Net internal debt before clearing vs after clearing (the approach of the Sardex research) | `debtReduction` |
| Default rate | Defaulted value ÷ total residual | `defaultRate` |
| Clearing time | Duration from `close_epoch` to `commit_epoch` | `clearingTimeSeconds` |

The read API serves these per epoch at `GET /x207/circles/<circleId>/epochs/<epoch>/metrics`.

Results from demo epochs: the sandbox demo ([sandbox-demo.md](sandbox-demo.md)) has the cleared ratio and transfer savings of two sandbox runs (for example 120 paid calls became 6 residual payments, cleared ratio 0.6333), and epoch 8 of `x207-v013.testnet` is the realistic testnet run (21.8 of 41.35 credit cleared, 7.75 USDT left to move; see [gas-epoch8-vs-transfers.md](gas-epoch8-vs-transfers.md)). No mainnet epoch has run, so there is no mainnet figure.

### Relief against graph density

How much value clearing removes depends on how many debt cycles the graph has. `scripts/relief-curve.mjs` runs the solver on synthetic graphs of increasing density and on a star graph, and writes the curve. See [docs/relief-curve.md](relief-curve.md).

```bash
npm run build -w @x207/solver
node scripts/relief-curve.mjs
```

Chart: [docs/relief-curve.svg](relief-curve.svg). Values of the run `node scripts/relief-curve.mjs --seed 207 --members 30` on 2026-11-02 (synthetic graphs, not a demo epoch):

| Graph | Members | Edges | Total obligation | Cleared | Relief | Residual payments |
| --- | --- | --- | --- | --- | --- | --- |
| random, p = 0.03 | 29 | 29 | 1407 | 51 | 3.62% | 18 |
| random, p = 0.06 | 30 | 44 | 1887 | 45 | 2.38% | 11 |
| random, p = 0.12 | 30 | 82 | 4251 | 1737 | 40.86% | 16 |
| random, p = 0.25 | 30 | 214 | 11010 | 8194 | 74.42% | 16 |
| random, p = 0.5 | 30 | 429 | 21888 | 18824 | 86.00% | 13 |
| random, p = 0.8 | 30 | 681 | 35158 | 32129 | 91.38% | 17 |
| star | 30 | 29 | 1613 | 0 | 0.00% | 29 |

Sparse random graphs relieve only a few percent and the star graph none; relief rises quickly once the graph is dense.

The chart marks the Sardex benchmark of 23% of value per monthly batch (Fleischman, Dini, Littera, JRFM 2020). A star graph, where every member owes one hub, has no cycle and shows no relief. The demo circle is dense on purpose (ADR-16). Two columns of the script are open: payable mass and cost per payment.

## 10. Roadmap

### Scope: MVP and roadmap

| MVP (1–14 Nov 2026) | Roadmap |
| --- | --- |
| F1–F4 in full, F6 core (default and limit), F7 `set_params`; F5 barter bundle and F9 marketplace in the sandbox (ADR-38) | F5 and F9 on mainnet and with real counterparties (a testnet rehearsal ran with five accounts of the team); asset classes A to C with real delivery; a book that more than one operator can run |
| One circle, six demo agents, on `near-sandbox` and on testnet (circle `x207-v013.testnet`, mock USDT); no mainnet transaction yet (see [what-has-run.md](what-has-run.md)) | Many circles, clearing across circles |
| Cumulative voucher per pair (ADR-17); per-request registration only as a demo mode | Registration of many pairs in one transaction |
| A net debtor pays the residual in USDT inside the `payment_window`; a debtor that does not pay defaults and its stake is cut. A net creditor calls `claim` | Settle the residual from the member's stake without a default, and pay creditors without a manual `claim`. Both change the contract, so they need contract 0.0.14 and stay out of the MVP: a contract change this close to the deadline would need a new deploy and new tests, and the loss order of ADR-18 would have to be decided again (KN-39) |
| Own facilitator | Proposal of the scheme spec to the x402 Foundation (`scheme_batch_settlement_x207.md`) |
| Public ledger | Confidential settlement with Confidential Intents |

### Access Asset Adapter (F8)

Principle: hand over access, not secrets. A circle member lends or swaps access to an account, a credential, or an on-chain asset. The buyer gets limited, metered, revocable access and never sees the secret. Usage is paid with ordinary credit vouchers, so it is cleared by F3 like any other payment. A `defaulted` buyer loses access.

| Class | What it covers | How access is handed over | Status |
| --- | --- | --- | --- |
| A | Assets that transfer natively: NFT, token, named NEAR account | Escrow in the circle contract. The owner deposits the asset (`nft_transfer_call`), the buyer calls `complete_escrow` with a signed voucher, and the asset moves when the voucher is registered. If the transfer fails the registration is taken back exactly. Final once moved. | NFT only. Built in the contract (interface 0.0.7) and run in `near-sandbox`, with a mock NFT contract. A token or a named NEAR account is not built. Not on testnet or mainnet. |
| B | Limited derived credentials | A NEAR function-call key restricted by contract, methods, and allowance, added after payment and deleted on expiry, non-payment, or default | Built and run in `near-sandbox` (`npm run demo:classb`). Not on testnet or mainnet, no TEE. |
| C | A single secret that cannot be split | A broker holds the secret and proxies calls. The buyer never receives it. In the target design the broker runs in a trusted execution environment (TEE). | Proxy built and run in `near-sandbox` against a local mock provider, with the secret in the environment of the broker. **No TEE, no attestation** (the prove step answers `no_attestation`), no real provider, not on testnet or mainnet. |
| D | Resources the member owns: a server, a GPU, storage | A paid x402 endpoint. This is F2 as it is. | MVP |

Every adapter implements five functions: `price`, `prove`, `deliver`, `meter`, and `revoke`. `meter` always produces an ordinary voucher.

**Asset class registry (D10).** The circle accepts only asset types that the provider's terms allow to be transferred or delegated. Sputnik DAO sets the registry through F7. A type marked class `X` is rejected by the contract.

**Limits set by providers.** Being technically able to share access is not permission to share it. Consumer plans that forbid sharing or resale are class `X`, and the broker is not used for them even though it could be.

**Lawful paths for subscription accounts.** A team seat that an admin assigns and revokes (class B). A member of an organization or workspace with a per-member spending limit (class B). An official OAuth app with limited scope and revocable tokens (class B). A broker (class C) only where the provider's terms allow managed or delegated access.

The F8 methods are in the contract (interface 0.0.7: `set_asset_class`, `offer_grant`, `accept_grant`, `revoke_grant`, the views `get_asset_class`, `get_grant`, `grants_of`, and for class A `nft_on_transfer`, `complete_escrow`, `cancel_escrow`, `on_escrow_resolved` and the view `get_escrow`; a class A grant is not accepted with `accept_grant`, the buyer uses `complete_escrow`). The broker for classes B and C is in `backend/broker/`; the adapter types, the key proof and the grant voucher format are in `sdk/` (`@x207/core` `access.ts` and `access-key.ts`, `EndpointAdapter` in `@x207/scheme`).

## 11. Team

To be written by the team.
