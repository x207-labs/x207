# Guide for capital providers

This guide is for the owner who stakes USDT for an agent, and for any member whose position is positive at the end of an epoch. It answers five questions. Terms are in the glossary in the README. Function names and rules come from the contract interface spec in the design notes. Decision records are cited as ADR-nn.

## 1. How much of my stake is at risk?

Your stake is cut only if your own agent fails to pay its residual. At `finalize_epoch`, any position still `due` becomes `defaulted`. The contract moves `min(due, stake)` from your stake to the epoch pool. The member becomes `suspended` and its limit is 0. The report shows `409` for it.

Your stake is not cut for the default of another member. In the hackathon version `limit ≤ stake` holds for every member at all times, so a debtor's own stake covers its residual (ADR-18).

A member that holds a `due` position cannot withdraw its stake (`ERR_HAS_DUE`).

## 2. How does my limit grow?

The limit is recomputed for each active member at `finalize_epoch`:

```
limit = min(limit_cap, stake × base_limit_ratio / 10000 + settled_history × limit_growth / 10000, stake)
```

- `settled_history` grows only when you pay a residual in cash and the payment is complete. Clearing of cycles does not count. This prevents wash trading (ADR-08).
- The limit can never exceed your stake (ADR-18) or `limit_cap`.
- `base_limit_ratio`, `limit_growth`, and `limit_cap` are circle parameters. The DAO can change them only inside the ranges coded in the contract (ADR-20).

## 3. Who bears a loss: the MVP and the later phase

| Phase | Rule | Who loses |
| --- | --- | --- |
| MVP (`limit ≤ stake`) | The stake of the defaulting debtor covers its residual in full. | Only the defaulting member, through its stake. Creditors lose nothing. |
| Later phase (`limit > stake`) | Order of cover: the stake of the debtor, then the reserve fund (a small fee on the value cleared), then a haircut on the direct creditors of the debtor in the remaining graph. There is no cascade. | The debtor first. If stake and reserve are not enough, only its direct creditors. |

The later phase is roadmap. The decision is ADR-18. Example from the research: in the chain A owes B, and B owes C, a default by A would hurt C, who never traded with A. While `limit ≤ stake` this cannot happen.

## 4. How do I claim?

1. Wait until the epoch is finalized. `claim` works only after `finalize_epoch` (ADR-24). Before that the position stays `claimable` but cannot be claimed.
2. Call `claim(epoch, destination)` with exactly 1 yoctoNEAR and enough prepaid gas. The caller must be the creditor of the position.
3. `destination` is `near` for a USDT transfer to your NEAR account, or `intents` for a transfer into your NEAR Intents balance.
4. If the transfer fails, the position returns to `claimable` and nothing is lost. You can call `claim` again.

You can still claim after you have left the circle.

## 5. How do I cash out?

- **To another chain.** Claim with `destination = intents`, then withdraw from your Intents balance with the 1Click API. The quote shows the fee before you sign. A minimum amount applies per destination chain, so check the quote.
- **Your stake.** Call `request_exit`. From that moment no new voucher that involves you is accepted for later epochs, and you cannot add stake. After `finalize_epoch` of that epoch, with no `due` position, call `withdraw_stake`. The stake is sent by `ft_transfer`. If the transfer fails the stake is restored (ADR-29).

## Decision records

- ADR-08: initial limit and growth only from cash settlement.
- ADR-18: `limit ≤ stake` in the MVP, and the loss order for the later phase.
- ADR-24: `claim` only after `finalize_epoch`.
