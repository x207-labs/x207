# Submission form draft (UM-054)

Status: a draft for the owner. **Nothing was sent and nothing was posted.** The fields are those of the form at <https://nearhackathon.com/#apply> and of `POST /api/applications` (vault: `07 Submission/Submission Form.md`, `Submission API.md`). Re-read <https://nearhackathon.com/HACKATHON.md> before sending: dates and rules may change. The window is 2026-11-01T00:00Z to 2026-11-14T23:59Z; outside it the API answers 403.

Numbers below are the ones of the README and of the hosted read API on 2026-11-04 (epoch 8 of the circle `agents-main` on `x207-v013.testnet`). Check them again the day you send.

## Fields

| Field | Value | Who fills it |
| --- | --- | --- |
| `projectName` | `x207` (2 to 80 characters, unique across the hackathon; if it is taken, the owner picks another name, we do not work around a 409) | owner confirms |
| `leadName` | FILL | owner |
| `email` | FILL (unique, max 160 characters) | owner |
| `size` | FILL, exactly one of `1`, `2 - 4`, `4 - 6`, `6 - 8`, `8+` | owner |
| `tracks` | `["swarms", "realworld", "social", "agents", "business", "defi"]`, in this order, `swarms` the main one; the owner locked them on 2026-11-04 (see "Tracks" below) | owner decided |
| `nearAddress` | FILL: the prize account; the hackathon rules ask for a NEAR **mainnet** account (`name.near` or a 64-character implicit account) that the team makes in any wallet. Not `x207-v013.testnet`, not an account of the project keys | owner |
| `projectUrl` | `https://github.com/x207-labs/x207` (the umbrella repository; the six product repositories are its submodules and are public too: `contracts`, `sdk`, `backend`, `frontend`, `solver`, `agents`) | ready |
| `demoUrl` | FILL: the public post on X that the owner publishes (draft in [x-post.md](x-post.md)) | owner |
| `idea` | the text of [idea.txt](idea.txt), 1,980 characters (limit 20 to 2,000) | ready |
| `consent` | `true` only after the owner has read the notice: "I agree that the organizers may use these details to review our submission and contact us about this hackathon." | owner |
| `website` | **never send it** (spam trap: any value rejects the submission) | |

`human-fields.example.json` lists the fields that only the human can fill. Do not commit the filled payload: it holds personal data.

## Where to try it (for the form and the post)

| What | URL |
| --- | --- |
| Repository | <https://github.com/x207-labs/x207> |
| Dashboard (opens on epoch 8) | <https://x207-dashboard.vercel.app> |
| Read API | `https://x207-backend-production.up.railway.app/x207/circles/agents-main/epochs/8/metrics` |
| Remote MCP server (read-only, Streamable HTTP) | `https://x207-mcp-production.up.railway.app/mcp` |
| Local, no account | `npm run demo:quick` (about 5 minutes), `npm run demo:mcp` (about 2 minutes) |
| Contract | release v0.0.13, `https://github.com/x207-labs/contracts/releases/tag/v0.0.13` |

## The numbers that may be quoted (epoch 8, API and README agree)

| Statement | Value | Source |
| --- | --- | --- |
| Vouchers in the epoch | 24, worth 41.35 credit, among 15 participants | `/epochs/8/metrics`: `voucherCount`, `totalVoucherValue`, `graph.participants` |
| Cancelled by the clearing | 21.8 credit (ratio 0.527) | `cleared`, `clearedRatio` |
| Left as residual obligations | 19.55 credit | `debtAfter` |
| What those residuals net to | 7.75 USDT due from six debtors: five paid 7.2 USDT, and the 0.55 of `m06`, which did not pay, was taken from its stake | `netDebt`; `docs/testnet-0.0.13-realistic.json` (`positions.debtors`, `finalize.defaulted`) |
| `residualTransfers` | 14 = six members paying in and eight claiming out (members with a net position), not 14 payments | `residualTransfers` |
| Load test | epoch 2: a complete graph of 210 obligations among 15 participants, cleared in four transactions (`close_epoch`, `submit_clearing`, `commit_epoch`, `finalize_epoch`) | `contracts/docs/gas-and-cost.md` |
| Local `demo:quick` | 120 payments became 6, cleared ratio 0.6333, one clearing transaction (sandbox, not testnet) | output of `npm run demo:quick` on a clean clone, 2026-11-04 |

Say "21.8 cancelled, 19.55 left, netting to 7.75 USDT due, of which five debtors paid 7.2 and 0.55 came from the stake of the one that defaulted". Do not say "half of the credit never moves": 7.75 of 41.35 credit is due as USDT (18.7%), 7.2 of it was paid by debtors, and 21.8 is the part cancelled.

What has not run, and must not be implied: any mainnet transaction, NEAR Intents on testnet (`intents.testnet` has no code; the residual batch ran against the real Intents wasm in `near-sandbox`), a real wallet through NEAR Connect on the dashboard, the TEE broker, a proof by a third party outside the team.

## Story of the submission (UM-139)

Background, then problem, then x207, then limits, in this order in the video, the post and the idea text. The word is **clearing**, not credit: a member locks one stake, the limit is at most that stake, and the clearing cancels debt cycles so that only the residual moves. Evidence of the problem is in the spikes of [spikes/README.md](../../spikes/README.md) (run on 2026-11-04) and in sources read on that day: arXiv:2607.12575 (21.20% fictitious, 63.78% internal, star-shaped), American Banker 2026-09-18 (daily volume about 800 thousand to about 40 thousand dollars), [problem-and-gap.md](../problem-and-gap.md). Not claimed anywhere: saving gas, credit without cash, mainnet, outside users.

## Tracks

The owner locked six tracks on 2026-11-04: `swarms` (the main one), `realworld`, `social`, `agents`, `business`, `defi`, in this order. The hints of a track are "hints and wishes, not requirements". Every claim below links to what shows it and must stay true in each track's reading; the same table with the demo steps is Appendix A of [appendices.md](../appendices.md). Gas is not claimed in any track: x207 burns more gas than 24 plain transfers and saves the value that has to move ([gas-epoch8-vs-transfers.md](../gas-epoch8-vs-transfers.md)).

| Track (`id`) | The short case | Evidence | What weakens it |
| --- | --- | --- | --- |
| AI Swarms (`swarms`), main | Many agents in one circle settled together: the clearing is a coordination market in which a solver finds the cycles and the contract checks the proposal. Hint "Multi-Agent Systems" fits | Epoch 8 on testnet: 15 members, 24 vouchers worth 41.35 credit, 21.8 cleared ([testnet-0.0.13-realistic.json](../testnet-0.0.13-realistic.json)); 210 obligations cleared in the load test ([testnet-0.0.13.json](../testnet-0.0.13.json)); six named agents on a separate testnet circle (`x207-swarm.x207r-deploy.testnet`, not the circle of epoch 8) ran and settled one epoch: 15 vouchers, residuals paid by three debtors, claims by three creditors ([testnet-swarm.md](../testnet-swarm.md), [testnet-swarm.json](../testnet-swarm.json)); `npm run demo:swarm`, six agents for four epochs in the sandbox; eight attacks on the live circle refused by the contract ([attacks-on-testnet.md](../attacks-on-testnet.md)) | The agents run in rule or mock mode, not a real LLM swarm; hint "Sub-Accounts" is used only for lease accounts |
| Real-World Money (`realworld`) | Invoices in installments, USDT settlement, credit limits from stake: "something a company could use tomorrow" is the pitch of the netting | `npm run demo:realworld`, residual 40 of 240 (sandbox); epoch 8 residual paid in USDT by five of six debtors (7.2 of 7.75), the sixth covered from its stake; the residual batch through the real Intents contract in `near-sandbox` ([residual-batch.md](https://github.com/x207-labs/backend/blob/main/docs/residual-batch.md)); a 1Click quote with `dry: true` ([residual-test-procedure.md](https://github.com/x207-labs/backend/blob/main/docs/residual-test-procedure.md)) | Testnet with a mock token; no mainnet; no real company user; no 1Click payout. Hint "Meta Transactions" is not a focus |
| Social (`social`) | Members guard a shared circle: a default is paid from the stake of the debtor, and the circle is owned by a Sputnik DAO that votes its parameters | Epoch 8: one default, 0.55 credit from its stake, creditors paid; the DAO `x207v8.sputnikv2.testnet` owns `x207-v013.testnet`, and a `set_params` vote with two council votes ran on testnet ([testnet-dao-v8.json](../testnet-dao-v8.json), [testnet-0.0.13-dao-classes.json](../testnet-0.0.13-dao-classes.json)) | The live proposal ran on 2026-11-04 with its hashes in [governance-live.md](../governance-live.md). Not on mainnet; no real wallet on the governance page |
| Agent Economy (`agents`) | The product is how agents pay, hire and settle with each other: vouchers over x402, an MCP server so an AI agent joins, pays and reads the clearing, marketplace and barter between agents. Hint "Agent Commerce" is the whole project | The hosted read-only MCP server (`@x207/mcp` 0.0.2, six tools, [mcp.md](../mcp.md)); printed 402 with the x207 and `exact` entries and agents that list, negotiate and settle by policy (`tests/marketplace.sandbox.test.ts`) | No live NEAR AI inference; no mainnet payment; the hint "NEAR Intents" is met only in the sandbox |
| Autonomous Business (`business`) | Agents that sell services (x402 seller example) and pay suppliers; the owner's limits are enforced before a voucher is signed | 3 payments approved and 3 refused by the limits in the demo run ([business and invoice blocks](../demo-blocks.md#business-and-invoice-blocks-tracks-business-and-realworld)) | No treasury or revenue-sharing product; no business that uses it outside the demo |
| Unstoppable DeFi (`defi`) | A clearing protocol with stake as collateral and default handling, no custodian | Epoch 8: 19.55 credit left after 21.8 was cancelled, 7.75 due and settled in the mock USDT; default handling from the stake; the real Intents contract in `near-sandbox`; a 1Click dry quote | **The weakest track.** NEAR Intents on testnet and a 1Click payment have not run (`intents.testnet` has no code; a payment needs a mainnet run, UM-027 and UM-035). Hint "Chain Signatures" is not used. It is not an exchange or lending product in the usual sense |

Not ticked: `security` and `open` (the owner left them out), `privacy`, `thesis`, `games`, `nfts`, `memecoins`. Ticking six tracks does not make a claim stronger; the rows above are the claims.

## Order of the steps (owner)

1. Make the owner's choices: tracks, size, mainnet prize account, email.
2. Record the video ([video-script.md](video-script.md)) and publish the post ([x-post.md](x-post.md)); copy the post URL into `demoUrl`.
3. Check that the repository is public, the hosted URLs answer (`/healthz` of the API and the MCP, the dashboard), and the numbers above still match the API.
4. Print the full JSON payload, read it, and only then send (`uuidgen | tr A-Z a-z` for `requestId`, reused on a retry). One attempt per team.
