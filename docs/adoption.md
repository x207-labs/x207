# Adoption path: where x207 can be listed, step by step (UM-070)

Status: **a checked list of targets. Nothing in it has been done by the team's tools: nothing was registered, posted, submitted or published.** Every step that goes outside the team is an action of the owner. Channels were read on 2026-11-04. **Checked** means the page with the steps was opened and read; **unchecked** means we only saw it in a search result or could not open it, so look again before acting. It replaces an earlier draft of 2026-11-02, written when the repositories and the npm packages were not public yet, which was deleted.

Measure the effect with `npm run metrics:adoption` (repositories, npm downloads, the issue below, members of the circle); the run of 2026-11-04 is [adoption-metrics-2026-11-04.json](adoption-metrics-2026-11-04.json): no stars, no forks, 19 views and 1,012 clones in 14 days (these include our own CI runs and clones), no npm downloads yet, issue open with 0 comments, 30 members of the testnet circle (26 active, 4 suspended).

## Done

| Step | State |
| --- | --- |
| Public repositories | the seven product repositories are public |
| npm packages | `@x207/mcp` 0.0.3, `@x207/core` 0.0.1, `@x207/scheme` 0.0.1 are on npm |
| Proposal to the x402 Foundation | issue [x402-foundation/x402#4131](https://github.com/x402-foundation/x402/issues/4131), open; draft in [x402-binding-issue.md](x402-binding-issue.md). The spec is in [`sdk/spec`](https://github.com/x207-labs/sdk/blob/main/spec/scheme_batch_settlement_x207.md); a spec-only pull request is planned after a maintainer answers |

## Targets

Order of effort, lowest first. "Owner" means the person who holds the GitHub, npm and wallet accounts.

| # | Channel | Does it take submissions? | Steps | Who | Blocked by |
| --- | --- | --- | --- | --- | --- |
| 1 | Official MCP Registry (registry.modelcontextprotocol.io), preview | Yes, free | **Done 2026-11-04:** `io.github.x207-labs/x207-mcp` 0.0.3 is `active` ([query](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.x207-labs/x207-mcp)), with the npm package `@x207/mcp` 0.0.3 and the hosted Streamable HTTP endpoint. Published by the workflow [publish-mcp-registry.yml](https://github.com/x207-labs/sdk/blob/main/.github/workflows/publish-mcp-registry.yml) with GitHub OIDC; the interactive `mcp-publisher login github` cannot publish under an organization namespace | Owner (dispatches the workflow for a new version) | none |
| 2 | PulseMCP | Submissions are paused; it says it will pick up Official Registry entries. Checked | Nothing to do beyond row 1 | none | row 1 |
| 3 | awesome-mcp-servers (`punkpeye/awesome-mcp-servers`) | Yes, a pull request. Checked (CONTRIBUTING) | **PR open since 2026-11-05:** [punkpeye/awesome-mcp-servers#18606](https://github.com/punkpeye/awesome-mcp-servers/pull/18606), one line under Finance & Fintech; text in [outreach/awesome-mcp-servers.md](outreach/awesome-mcp-servers.md) | Owner | a maintainer's review; fits `@x207/mcp` because it is a public repository |
| 4 | Glama (glama.ai/mcp/servers) | It indexes GitHub repositories; an "Add Server" button and a claim flow exist. Partly checked: the help text could not be read | Add or claim the server | Owner | none known |
| 5 | awesome-remote-mcp-servers (`punkpeye`) | Yes, a pull request, for a hosted URL. Checked (CONTRIBUTING) | Needs a Glama listing and badge first and a star on the repository; the endpoint must answer MCP `initialize`; one line with the endpoint `https://mcp.x207.boxd.sh/mcp`, a badge, a "no auth" marker and one sentence of at most 120 characters | Owner | row 4 |
| 6 | mcp.so | A submit form at mcp.so/submit. Only the home page was read; the form was not | Enter the repository URL, check the fetched name and tools | Owner | unchecked whether it needs a login |
| 7 | Smithery | Publishing a hosted URL is said to be possible (`smithery.ai/new` or `smithery mcp publish`). Unchecked: documentation did not load | Read the current documentation first | Owner | unchecked |
| 8 | NEAR AI Agent Market (market.near.ai) | Yes, in the web UI. Checked ([list your agent](https://docs.market.near.ai/list-your-agent.md)); we found no documented registration endpoint | Make an account and confirm the email; Building, Your agents, New agent (name, handle, tagline); hosting "self-hosted" with the webhook left empty; set a price per hire and a delivery SLA; create the agent API token and keep it out of the repository; set the listing to live | Owner | **What to sell is not decided.** The market lists *agents that do a job*, not a protocol. A sensible offer is a member agent of a circle that sells a deliverable (for example an epoch report or a clearing simulation) and is paid in USDC; it is the same member agent that would take part in a circle, and that circle is where subcontracting loops could appear ([problem-and-gap.md](problem-and-gap.md#where-cycles-come-from)). The platform keeps a fee (the percentage was not stated) |
| 9 | near/awesome-near | Yes, a pull request with a package name and a one-line description. Checked (README) | **PR open since 2026-11-05:** [near/awesome-near#90](https://github.com/near/awesome-near/pull/90), one row in CLI Tools; text in [outreach/awesome-near.md](outreach/awesome-near.md) | Owner | a maintainer's review |
| 10 | x402 Foundation community Slack ([slack.x402.org](http://slack.x402.org/)) | CONTRIBUTING says project showcases go to Slack, not to GitHub. Checked | Post the facilitator and the binding, with the issue link, and ask how the Developer Tools facilitator table is updated: it lists a NEAR facilitator and "Solvador" and does not state a process. Unchecked: where its source lives | Owner | row "Done", issue #4131 |

## Not a channel (checked, do not spend time)

| Channel | Why |
| --- | --- |
| x402 Bazaar | There is no registration. A resource is catalogued only when a facilitator processes a payment that carries the `bazaar` extension, so it would need our facilitator to implement it, and the free read-only MCP server is not a paid resource ([docs](https://docs.x402.org/extensions/bazaar.md)) |
| x402.org/ecosystem | Could not be read, and the repository has no data file for it. A search result said it is being phased out (unchecked, second hand) |
| `modelcontextprotocol/servers` | Its README says it holds only the reference servers and points to the Registry |
| ERC-8004 registries | EVM only. We found no NEAR equivalent and no agent directory that takes non-EVM agents |
| near.org form for gateways and platforms | Mentioned in the old draft, but no such form was found on 2026-11-04; ask the owner whether they have the link |

## Unchecked leads

x402eco (a community site that takes a JSON file per project by pull request, seen only in a search result), NEAR Catalog at `dev.near.org/applications` (the page did not load), x402scan and Agentic.Market (no listing steps visible).

## First pilot

A circle with real outside agents is still the missing proof: `x207-v013.testnet` has 30 members, and we have not checked that any of them is outside the team. The path is to invite two to six agents of one operator or one community to the testnet circle with the [join guide](join-the-circle.md), and to read the effect with `npm run metrics:adoption`. No outside adopter is known as of 2026-11-04.
