# Enterprise needs and what x207 offers (research note)

Status: a research note. It maps needs to what exists, what is on the roadmap and what is not planned. It does not claim that x207 meets any legal requirement. Sources were read on 2026-11-02; "not verified" marks a claim from a secondary source.

## Needs and where x207 stands

| Need | What an enterprise asks | x207 today | Roadmap or not planned |
| --- | --- | --- | --- |
| Confidentiality of who pays whom | Competitors must not read a supplier graph | None. The ledger of obligations is public on-chain (README, risk table: public ledger, accepted for the MVP) | Roadmap (ADR-15): settlement with Confidential Intents, see below. Hiding the obligation graph inside the contract would need a different design, not planned |
| Confidentiality of amounts and goods | Prices and terms stay private | Voucher amounts are public once registered; listing text and negotiation sit in the backend book, readable by the operator | Not planned. A private book per operator is possible without a contract change |
| Identity of an agent | Know which legal person stands behind an agent | A member is a NEAR account with a stake; the owner signs `join`. Nothing ties the account to a legal person | Not planned in the contract. Admission can be set to `dao` (a council admits members), which gives a manual check by a council |
| Authorization and limits | An agent must not spend beyond a budget | Built: the credit limit never exceeds the stake; the owner's spend limit per call and per epoch is enforced by the agent before it signs (`business` block); the voucher key cannot move funds | Same |
| Audit trail | A record of every payment | Events (`voucher_registered`, `epoch_committed`, `member_defaulted`, and others) and the 207 report per epoch from the indexer | Same; the indexer is one operator's view, anyone can rebuild it from the chain |
| Compliance (anti money laundering, travel rule) | Know the parties of a transfer | Not handled. A circle is closed by admission; the residual moves in USDT between member accounts | Out of scope; see the note on FATF below |
| Dispute and refund | A route when goods are bad | None in the protocol ([reputation-and-disputes.md](reputation-and-disputes.md)) | Design only |
| Custody and key control | Who holds the keys | The voucher key signs vouchers only. A leaked voucher key can create vouchers up to the limit but cannot transfer funds (ADR-06) | A hardware or TEE-held key is not built |
| Service levels | Uptime of the operators | The facilitator, indexer, solver and keeper are operators; the solver is permissionless | Several facilitators are possible; not run |

## What the sources say about two of the needs

**Confidential Intents.** The documentation of the Aurora Intents site says it hides the origin wallet, the routing across chains and the link between source and destination, and keeps the destination transaction, asset, amount and recipient public. Confidential swaps are live on the Swap API, enabled by a flag on the quote endpoint; confidential deposits and DeFi actions are described as rolling out; routing runs on "a private shard of NEAR running the NEAR Intents engine", and the page does not say who operates it or whether it can be verified ([docs](https://docs.intents.aurora.dev/confidential-intents)). NEAR's agentic payments page says confidential settlement is not part of the x402 specification until the spec supports confidential transactions ([near.org](https://www.near.org/agentic-payments)). So for x207 it hides, at most, the route of a residual payment or a withdrawal; it does not hide the obligations in the contract.

**Travel rule.** In June 2025 the FATF agreed changes to its Recommendation 16 on payment transparency and classed stablecoins as virtual assets under its standards; it also reported that 73 percent of 117 jurisdictions had passed travel-rule laws, with limited enforcement ([FATF](https://www.fatf-gafi.org/en/publications/Fatfrecommendations/targeted-update-virtual-assets-vasps-2025), read through a search summary: the primary page itself was not read in full). Whether a closed credit circle paying a USDT residual falls under such rules depends on the jurisdiction and on who operates it. That is a question for a lawyer, not for this repository.

## Agent identity elsewhere

ERC-8004 proposes identity, reputation and validation registries for agents on EVM chains. Its status is reported differently by sources (draft in the standards repository, "under public review" in one vendor's docs), and a search result mentioned a study finding that few registrations are live (**not verified**, read through a summary). It is not on NEAR. On NEAR the closest existing thing is the account itself plus the stake. It is a reference, not a plan.

## Summary

x207 gives an enterprise limits, an audit trail and keys that cannot move funds. It gives no confidentiality of the obligation graph, no legal identity, no compliance tooling and no dispute route. The first two are partly on the roadmap; the others are not planned and some are not the job of a protocol.
