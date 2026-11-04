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
| `tracks` | see "Tracks" below | owner decides |
| `nearAddress` | FILL: the prize account; the hackathon rules ask for a NEAR **mainnet** account (`name.near` or a 64-character implicit account) that the team makes in any wallet. Not `x207-v013.testnet`, not an account of the project keys | owner |
| `projectUrl` | `https://github.com/x207-labs/x207` (the umbrella repository; the six product repositories are its submodules and are public too: `contracts`, `sdk`, `backend`, `frontend`, `solver`, `agents`) | ready |
| `demoUrl` | FILL: the public post on X that the owner publishes (draft in [x-post.md](x-post.md)) | owner |
| `idea` | the text of [idea.txt](idea.txt), 1,580 characters (limit 20 to 2,000) | ready |
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

## Tracks

The form takes one or more. The hints of a track are "hints and wishes, not requirements". The owner decides; this is the case for each candidate and what weakens it.

| Track (`id`) | Why it fits | What weakens it |
| --- | --- | --- |
| Agent Economy (`agents`) | **Best fit.** The product is how agents pay, hire and settle with each other: vouchers over x402, an MCP server so an AI agent joins, pays and reads the clearing, marketplace and barter between agents. Hint "Agent Commerce" is the whole project | The hint "NEAR Intents" is met only in the sandbox |
| AI Swarms (`swarms`) | Many agents in one circle settled together; the demo is six agents and the testnet epoch has 15 participants; the clearing is a coordination market (solver competition). Hint "Multi-Agent Systems" fits | The agents of the demos run in rule or mock mode, not a real LLM swarm; hint "Sub-Accounts" is only used for lease accounts |
| Real-World Money (`realworld`) | Invoices in installments, stablecoin (USDT) settlement, credit limits from stake: "something a company could use tomorrow" is the pitch of the netting | Testnet with a mock token; no mainnet; no real company user. Hint "Meta Transactions" is not a focus |
| Unstoppable DeFi (`defi`) | A credit and clearing protocol with collateral and default handling, no custodian | The hint "NEAR Intents" and "Chain Signatures" are not demonstrated on a network; it is not an exchange or lending product in the usual sense |
| Autonomous Business (`business`) | Agents that sell services (x402 seller example) and pay suppliers; revenue from calls | No treasury or revenue-sharing product; weaker than the first two |
| Open Innovation (`open`) | The safe fallback: a credit-clearing layer does not fit one category | Adds little if `agents` is already ticked |

Suggested set to put to the owner: `agents`, `swarms`, `realworld`. Add `defi` only if the owner accepts that the Intents hint is shown in the sandbox only. Ticking many tracks does not make a claim stronger; every claim above must stay true in each track's reading.

## Order of the steps (owner)

1. Make the owner's choices: tracks, size, mainnet prize account, email.
2. Record the video ([video-script.md](video-script.md)) and publish the post ([x-post.md](x-post.md)); copy the post URL into `demoUrl`.
3. Check that the repository is public, the hosted URLs answer (`/healthz` of the API and the MCP, the dashboard), and the numbers above still match the API.
4. Print the full JSON payload, read it, and only then send (`uuidgen | tr A-Z a-z` for `requestId`, reused on a retry). One attempt per team.
