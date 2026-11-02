# Reputation and disputes about the quality of goods (design)

Status: **a design on paper**. Nothing here is built, and nothing here changes the contract. It answers one question: barter bundles (F5) and the marketplace (F9) fix who pays whom, but they do not say whether the goods or services were any good. What could be added, what it would cost, and where it must stop.

## What the protocol does and does not do today

| It does | It does not |
| --- | --- |
| Binds every participant of a bundle to the same `terms_hash` with a signature, and checks the headroom of every payer (`commit_bundle`) | Check that the goods exist, arrive, or match the listing text |
| Turns each leg into an ordinary voucher, cleared by F3 and settled in cash as a residual (F4) | Link a payment to the quality of what was received |
| Cuts the stake of a member that does not pay its residual, then suspends it (F6) | Punish a member that delivers nothing or delivers badly |
| Grows a credit limit only from residual paid in cash (`settled_history`), never above the stake | Use any score of quality in the limit |
| Lets F8 `prove` show that an asset exists and fits a grant (for class B, that a function-call key has the agreed scope) | Show that the asset is useful |

The protocol judges money, not quality. This is a decision, not a gap to fix quietly: a contract that rules on quality would be an oracle with a power to move money, and that power would be the first thing attacked. Any design below keeps the contract as it is, or says exactly which contract change it needs.

## What already limits the loss

- **Pay per use.** Service legs are paid by ordinary x402 calls, each worth a few cents. A buyer that gets nothing stops paying; the seller loses at most the calls registered but not delivered. This is the main protection of the barter of services, and it exists today.
- **Cap per leg.** A leg is a voucher with a `max_amount`; the payer never owes more than the leg, and the headroom of the payer is reserved only for that amount.
- **Class A is atomic.** An asset that transfers natively moves when the voucher is registered; there is nothing to dispute afterwards (roadmap, not built).
- **Class B and C stop on default.** A lessee that does not pay loses the key (class B, built in the sandbox).

What is left: a seller that takes a voucher and then delivers nothing or something worse than listed, in a deal that is not pay per use (a whole batch delivered once, a one-time asset of class D).

## Threats

| Threat | Who does it | Today |
| --- | --- | --- |
| Non-delivery after the voucher is registered | seller | Loss up to the leg; no remedy |
| Delivery below the listed quality | seller | Same |
| Refusal to pay because "the goods were bad" when they were fine | buyer | The residual is due anyway; a refusal is a default and costs stake |
| False complaints to damage a competitor | any member | No complaint channel exists, so no abuse either |
| Fake reputation by trading with oneself | sybil, colluding members | Wash trading does not raise limits (ADR-08), but a reputation score could be raised the same way |
| Reputation bought or rented | any member | Not applicable yet |
| Retaliation: a member rates back whoever rated it badly | any member | Not applicable yet |

## Options, from least to most change

### 1. Signed receipts (no contract change)

The buyer signs a short message with its voucher key after delivery, for example `x207:receipt:<terms_hash>:<leg>:<ok|not_ok>`, in the same NEP-413 style as the other formats. The receipt is public data, kept in the listing book (D12) and in the indexer. It proves that the buyer said so, nothing more. Cost: one format and one vector in the SDK, one table in the backend, no contract change. It is the base for options 2 and 3, and it is useful alone: a seller shows receipts to new partners.

Limit: a buyer can lie either way, and a colluding pair can write each other perfect receipts. Receipts are claims, not facts.

### 2. Reputation from facts the contract already holds (no contract change)

A public score computed from the indexer only from things that cost money or stake:

- bundles completed: every leg registered up to `max_amount` and the residual paid;
- residual paid on time (`settled_history`) and defaults (`member_defaulted`);
- grants that ended `expired` against `revoked` with reason `defaulted` (F8);
- age of the membership and stake.

No subjective rating enters the score, so it cannot be bought with flattering reviews. It says "pays and finishes deals", not "delivers well". Cost: an indexer view and a dashboard column. Limit: it measures reliability of payment, which a seller of poor goods can have.

### 3. Receipts weighted by the cost of lying (no contract change, more design)

Combine 1 and 2: a receipt counts only when the signer has real history (option 2), and only once per pair per epoch. A colluding pair is limited by what its own settled history lets it count. This slows farming; it does not stop a patient attacker with real capital, and a small circle of known agents does not need it.

### 4. Arbiter named in the terms (contract change)

The signed terms name an `arbiter` account; a dispute raised inside a window holds a part of the payment (the leg is registered but the residual of the seller is held back) until the arbiter, for example a council proposal of the Sputnik DAO, rules. This is the only option that can move money because of quality. It needs a new field in the canonical terms (the `search_leg` change of interface 0.0.5 is the precedent), a hold on a residual position, and a ruling method. Cost: high, and the arbiter becomes a trusted party. Not recommended for the hackathon version or the first circles; keep it as the design for a circle of strangers.

## Recommendation

Do 1 and 2 when there is time after the submission; do 3 only if reputation gaming shows up. Leave 4 on the roadmap with the confidential settlement and the credit above stake, because all three change who can lose money and need an audit. Until then the answer to "was it good" is: pay per use, the cap of the leg, and the receipts of the other members, nothing more.

## Limits of this note

- It is a design, not a measurement. There is no data on disputes because no circle with real traffic exists (the README says the same about demand).
- It does not cover legal liability, consumer rules, or goods that are illegal. The registry of asset classes (D10) already refuses class `X`, and a provider's terms decide what may be shared (F8).
- The small circle of the demo (six agents) shows the mechanism; reputation matters for a circle of strangers, which the hackathon version does not have.
