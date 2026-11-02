# Adoption path (draft)

Status: a **draft list of targets and steps**. Nothing in it has been sent, posted or published. Every step that goes outside the team is an action of the owner (see "Who acts"). The item that lists this path depends on the npm publish (SD-045), which is not done, so the path stays partial.

Sources were read on 2026-11-02. A fact marked "not verified" comes from a secondary source or from a page that did not load; check it before acting.

## What exists to adopt

| Piece | State on 2026-11-02 |
| --- | --- |
| Binding of the `batch-settlement` scheme on `x207:<circleId>`, spec draft | `sdk/spec/scheme_batch_settlement_x207.md` |
| Formats with test vectors and a conformance suite (54 cases), TypeScript and Python implementations | `sdk/conformance/`, `sdk/python/`; both pass |
| Contract, facilitator, indexer, solver, keeper, marketplace, broker for class B | run in `near-sandbox`; a testnet rehearsal of F1 to F4 only ([testnet-rehearsal.md](testnet-rehearsal.md)) |
| npm packages (`@x207/core`, `@x207/scheme`) | not published (SD-045) |
| Public repositories | not public yet (UM-051); drafts of the upstream issue and pull request exist locally in `sdk/docs/x402-foundation/` |

## Targets

| # | Target | What would be done | What was verified | Status | Needs |
| --- | --- | --- | --- | --- | --- |
| 1 | x402 Foundation, repository `x402-foundation/x402` | Open an issue and a pull request that propose the scheme spec for the network `x207:<circleId>` | The docs say the repository takes pull requests for the docs, and only with neutral content ([docs.x402.org](https://docs.x402.org/introduction)). Whether a scheme spec for a new network is accepted the same way is **not verified**: no contribution page for schemes was found. The earlier reading of the contribution rules (2026-11-02) is in `sdk/docs/x402-foundation/README.md` | Drafts ready, local only; the spec in the drafts is in Indonesian and needs translation (SD-046) | Owner reads, translates and sends; public repository first |
| 2 | x402 Foundation, community channel | Ask in the community Slack where schemes and ecosystem entries are handled | The docs link a community Slack ([slack.x402.org](http://slack.x402.org/)). No ecosystem or facilitator listing page was found on x402.org or in the docs index; there may be none | Not started | Owner (a person writes in the channel) |
| 3 | NEAR Intents as x402 settlement | Note that x207 and the NEAR Intents scheme are different things: x207 clears credit between agents, the Intents route settles a single payment across chains | The NEAR page says each payment goes to a 1Click deposit address in `payTo`, the x402 protocol is unchanged, and a native NEAR Intents scheme is "in review upstream" ([near.org](https://www.near.org/agentic-payments)). NEAR Foundation is described there as a member of the x402 Foundation | Not started | Nothing to send; useful context for target 1 |
| 4 | NEAR gateways and platforms | Contact NEAR about a shared integration (the page offers a form for gateways and platforms) | Form exists on the page ([near.org](https://www.near.org/agentic-payments)). What the team answers is unknown | Not started | Owner (form carries a name and an email) |
| 5 | NEAR AI Agent Market | Describe how a member of a credit circle can also bid there; no change to the market | Agents join through a skill file and are paid in NEAR through escrow ([blog](https://near.ai/blog/introducing-near-ai-agent-market)); see [agents/docs/agent-market.md](../agents/docs/agent-market.md) | Study written, no contact | Owner decides whether to contact |
| 6 | Agent directories | List the demo agents (`translator`, `summarizer`, and the others) in a public agent directory | No directory that fits was verified. The market above is a job market, not a directory of paid endpoints. ERC-8004 registries exist on EVM chains ([Polygon docs](https://docs.polygon.technology/payment-services/agentic-payments/erc8004)) and are not on NEAR | Not started; target not identified | Find a directory first |
| 7 | First pilot circle | Two to six real agents of one operator or one community, small amounts, a testnet contract at the current interface | Nothing runs on testnet at interface 0.0.6 yet | Not started | A testnet deployment (A2, owner approval), published packages (SD-045), a public repository (UM-051) |
| 8 | Other-language SDKs | Python exists in the repository; other languages follow the conformance suite | `sdk/python/` passes 54 of 54 cases | Done for Python, not published | Owner decides on PyPI (not done on purpose) |

## Order

1. Finish what is blocked on the owner: the public repository, the packages (SD-045), the Slack question (target 2).
2. Translate and send the issue of target 1, then the pull request after a maintainer answers. Do not open the pull request first.
3. Deploy the current contract on testnet for the pilot (target 7); only then contact gateways (target 4) with something to run.
4. Keep targets 5 and 6 as notes until a directory is found.

## Who acts

All of targets 1, 2, 4, 5 and 7 are actions outside the team and belong to the owner. This repository only prepares text, code and evidence. No message was sent and no account was created while writing this draft.
