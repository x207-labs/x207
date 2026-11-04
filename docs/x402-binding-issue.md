# Draft issue: batch-settlement binding for NEAR (x207)

**Status: draft, not posted (UM-136, audit KN-42).** The coordinator reviews it and the owner posts it to [`x402-foundation/x402`](https://github.com/x402-foundation/x402/issues) under the template "Feature". Nothing here has been sent.

The format follows the open binding issues for other networks, read on 2026-11-04: #4106 (XRPL on Checks), #4041 (Midnight), #3645 (Kaspa), #3620 (pooled escrow). Each has the sections "Problem or use case" and "Proposed solution", then a status and a plan. The text between the lines below is the issue.

Before posting, check again: the open NEAR issues (#2948 and #3370 are about `exact`, not `batch-settlement`), the trust-model wording of `specs/schemes/batch-settlement/scheme_batch_settlement.md`, and the numbers against [what-has-run.md](what-has-run.md).

---

**Title:** `[Feature]: batch-settlement binding for NEAR (x207): clearing across many parties`

### Problem or use case

`batch-settlement` today has bindings that settle one payer against one receiver: an escrow channel on EVM, and the proposals for other chains. A buyer's commitment is backed either by capital set aside for that seller (capital-backed) or by a network intermediary that bills the buyer (credit-backed, `cloudflare:402`).

Two gaps show up when agents buy from each other in both directions:

- **Opposite flows are never netted.** A summarizer buys translations and a translator buys summaries. Each pair settles its own gross amount, so value that could cancel is moved in full, and each seller needs a channel or an account per buyer.
- **No binding backs a commitment with a member's share of a pool.** A buyer that is not a customer of an intermediary, and has not locked funds for each seller, cannot be served on credit.

On NEAR, `exact` has live facilitators, but there is no `batch-settlement` binding. The open NEAR issues (#2948, #3370) concern `exact`.

### Proposed solution

A NEAR binding of `batch-settlement` on the network `x207:<circleId>` (for example `x207:agents-main`), in `specs/schemes/batch-settlement/scheme_batch_settlement_x207.md`. The spec is written and is the source of the numbers below: [scheme_batch_settlement_x207.md](https://github.com/x207-labs/sdk/blob/main/spec/scheme_batch_settlement_x207.md).

- **Commitment.** A cumulative voucher per payer and payee, signed with an `ed25519:` key, in `PAYMENT-SIGNATURE`. The facilitator is a relayer without custody and cannot forge a voucher. The flow is `authorization`.
- **Registration.** `register_cumulative` records the latest voucher of a pair in the circle contract; one transaction per pair, not one per call.
- **Redemption outside the request path.** At the end of an epoch any solver proposes a clearing; the contract checks the proposal and keeps the one with the largest cleared total. Debt cycles cancel, every net position stays the same, and only the residual is paid in USDT. Creditors then `claim`.
- **Trust model.** Each member locks a stake in the circle contract and the credit limit is bound by it (`limit <= stake` in the MVP). The loss of a member that does not pay is taken from its stake, then a reserve fund, then a haircut to its direct creditors. No intermediary underwrites a buyer. In the terms of the generic scheme this is nearest to capital-backed, because the trust anchor is the members' own funds, but the stake is pooled across a circle and not escrowed per seller, so we ask the maintainers how to classify it. We do not ask for a third model unless the maintainers want one.
- **Companion entry.** A seller advertises `exact` on `near:mainnet` in the same 402 response, so a buyer outside the circle can still pay.
- **What it does not do.** It does not save gas on NEAR: epoch 8 of the testnet circle burnt 109.7 Tgas for the clearing, residual payments and three claims (226.6 Tgas with the 24 vouchers registered) against 54.9 Tgas for 24 plain `ft_transfer` calls ([gas comparison](https://github.com/x207-labs/x207/blob/main/docs/gas-epoch8-vs-transfers.md)). What it reduces is the value that has to move: 7.75 of 41.35 credit. It needs capital locked of at least 125% of the debt in the MVP. Clearing helps only where debts go in cycles; a star graph, which describes most measured x402 traffic, gains nothing.

**Status:** a reference implementation (`@x207/core`, `@x207/scheme` with the client, server and facilitator roles, and a facilitator app) and a NEAR contract run on NEAR testnet as the circle `x207-v013.testnet`. Epoch 8 cleared 24 vouchers between 15 members, with one default covered from stake. Everything else ran in a local `near-sandbox`. The USDT used is a mock token. **No mainnet transaction has been sent.** Results and limits: [what-has-run.md](https://github.com/x207-labs/x207/blob/main/docs/what-has-run.md).

**Plan:** if the maintainers want it, a spec-only pull request adding the file above together with the byte format of the voucher and the test vectors. Feedback on the approach, and on how to classify the trust model, is welcome.

---

## Notes for the reviewer (not part of the issue)

- The SDK spec file says "credit-backed" in its summary, while the x402 spec now defines credit-backed as an intermediary that underwrites the buyer. The issue above uses the x402 definition. The summary in `sdk/spec/scheme_batch_settlement_x207.md` should be aligned before the pull request.
- The 7 requirements of a binding are answered in section 10 of the spec; the issue states only the trust model because that is where the generic scheme and x207 may disagree.
- The repository links point at `x207-labs` repositories that are public.
