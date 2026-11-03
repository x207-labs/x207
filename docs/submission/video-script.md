# Demo video script and X post (draft for the owner to record)

Status: a draft. Nothing here was recorded or posted. The owner records the video and posts it. Every scene below uses a command or a file that was run in this repository on 2026-11-02 or 2026-11-03; what has not run is listed at the end and must not be said or shown.

Rules for the owner: keep the label `NEAR-SANDBOX` or `TESTNET` in a corner of the screen for every scene so that a sandbox run is not taken for a network run; read the numbers from the terminal, do not type them; jump-cut the waiting, with the UTC clock visible. The text on screen is in English; part of the terminal output of the demo scripts is in Indonesian (`selesai dalam`, `laporan 207`, `pembayaran berbayar`). Either read it as it is or translate those few labels in `demo/sandbox.demo.ts` before recording.

Before recording (once): follow the setup block of section 4 of the README, then `npm run demo:sandbox` once to see that it works. The first run of each demo prints its own transaction hashes; the numbers below come from the runs of 2026-11-02 and 2026-11-03 and will differ a little on another machine (the graph is the same, the hashes are not).

## Scenes

Target: about 3 minutes. Narration at about 2.4 words a second.

| No | Time | Label | On screen | Narration (EN) | Source of the proof |
| --- | --- | --- | --- | --- | --- |
| 1 | 0:00 to 0:10 | none | Title card "x207" and the tagline of the README | "x402 lets agents pay. x207 lets many agents settle at once. It is a mutual credit layer for x402 payments on NEAR." | README title and section 1 |
| 2 | 0:10 to 0:28 | none | The mermaid diagram of README section 3, then six nodes with arrows both ways | "Agents pay each other in both directions, in tiny amounts. Instead of one transfer per call, they sign credit vouchers. At the end of an epoch, one transaction removes the debt cycles and only the net difference is paid in USDT." | README section 3 |
| 3 | 0:28 to 0:50 | NEAR-SANDBOX | Terminal: `npm run demo:sandbox`. Show the F1 block (six `join` and `ft_transfer_call` with hashes), then the line `402 accepts: batch-settlement@x207:agents-main + exact@near:mainnet`, then `120 panggilan berbayar (medium), 12 pasangan` | "Six agents join the circle and stake USDT. Their credit limit comes from the stake, so credit never exceeds collateral. A call without payment gets HTTP 402 with two options: a voucher in the circle, or a plain exact payment. The agents then make 120 paid calls and the facilitator registers 12 pairs on chain." | Output of `npm run demo:sandbox` (run on 2026-11-02: 120 calls, 12 pairs) |
| 4 | 0:50 to 1:15 | NEAR-SANDBOX | Terminal, F3 block: `keeper.close_epoch`, `solver: proposal dikirim`, `keeper.commit_epoch`, then the HTTP 207 report with six lines (`status=402` or `202` and `net=`) | "At the cutoff a keeper closes the epoch. Any solver can find the cycles and send one clearing proposal; the contract checks it and applies it. The result is an HTTP 207 report: one status per member, and the net positions add up to zero." | Same run: `cleared=1520000`, six members, net positions |
| 5 | 1:15 to 1:35 | NEAR-SANDBOX | Terminal, F4 block and the metrics block: three `settle`, `finalize_epoch`, three `claim`, then `120 pembayaran jadi 6`, `cleared ratio: 0.6333`, `transaksi kliring: 1` | "Debtors pay only what is left. Creditors claim. In this run 120 payments became 6 transfers, with one clearing transaction. Clearing helped because the demo circle is dense; on a star graph it clears almost nothing, and the README says so." | Same run; `docs/relief-curve.svg` for the star graph (`node scripts/relief-curve.mjs`) |
| 6 | 1:35 to 1:50 | NEAR-SANDBOX | Terminal: `DEMO_DEFAULT=scraper npm run demo:sandbox`, the lines about `member_defaulted`, `suspended`, and `/verify voucher scraper setelah suspended: ... member_not_active` | "One agent is scripted not to pay. Its stake is cut by the amount due, it is suspended, its limit drops to zero, and a new voucher from it is refused. Creditors are still paid in full." | Output of the default run (run on 2026-11-02, README row F6) |
| 7 | 1:50 to 2:08 | NEAR-SANDBOX | Terminal: `npm run demo:marketplace`. Show `bid 0.17 -> countered 0.19 -> countered 0.18 -> accepted`, the ring of three agents, `Cleared 1.74` | "The same mechanism covers goods and services. Agents list what they offer and want, negotiate in rounds, and a seeker earns a share for bringing in a counterparty. Three agents that each need what the next one offers sign one barter bundle, and the legs are cleared like any other debt. The protocol does not judge quality; it only fixes who pays whom." | README marketplace block; `tests/marketplace.sandbox.test.ts` asserts the same figures |
| 8 | 2:08 to 2:20 | NEAR-SANDBOX | Terminal: `npm run demo:classb`. Show the key installed on the lease account, the refused call to `get_epoch`, and the key deleted after `member_defaulted` | "An agent can also rent access instead of a secret: a NEAR function-call key limited to one contract, one method and an allowance, deleted when the renter defaults." | README access-asset block |
| 9 | 2:20 to 2:44 | TESTNET | Browser: a NEAR testnet explorer (open it before recording and check that it shows the hash) with three hashes from `docs/testnet-demo.json`: the `exact` payment `JBtEAUQ78P1gQSqk4TjkjN2Lax8HVSU2KHv8TmcB7RS3`, `solver.submit_clearing` `4BDM9DAheae1DypSE1ebyUzeQh7XseVSh7xnJEcH9zJU`, and one `relayer.register(gas key)` | "The same contract runs on NEAR testnet, with a mock USDT. Here is a clearing transaction from a real epoch, a payment from an agent outside the circle that paid no gas because a relayer sponsored it, and voucher registrations sent in parallel from one gas key." | `docs/testnet-demo.json` (the explorer page itself was not opened while writing this script) |
| 10 | 2:44 to 3:00 | none | A card with what is not done, then the repository link | "This is a prototype. No mainnet transaction has been sent, NEAR Intents has not run, agents run in mock mode, and real payment graphs are mostly stars. Built at NEAR HACKATHON." | README section 4, "What has and has not run" |

Total: 180 seconds.

## Scenes added on 2026-11-03 (optional; the owner decides which to keep)

The first ten scenes make 180 seconds. These four were proven after the first draft; together they are about 70 seconds more. If the video must stay near 3 minutes, cut scene 2 to 10 seconds, shorten scenes 4 and 5, and keep these as four short cuts of 12 to 15 seconds. Every one of them is a sandbox or a file; none runs on mainnet.

| No | Time | Label | On screen | Narration (EN) | Source of the proof | State |
| --- | --- | --- | --- | --- | --- | --- |
| 11 | about 15 s | NEAR-SANDBOX | Terminal: `X207_SANDBOX=1 npx vitest run tests/asset-catalog.sandbox.test.ts`, then the table of `docs/asset-catalog.md` | "Barter has to be as random as real life. The catalog lists 90 kinds of things agents can trade: tokens, access, secrets, services, and digital goods of ordinary people. 94 entries go into the contract's registry; nine kinds are registered as refused, and an offer of one fails." | `scripts/register-asset-classes.mjs`, `tests/asset-catalog.sandbox.test.ts` (2 tests passed; 94 written, 94 read back, a second run writes nothing, `securities:equity` fails with `ERR_ASSET_CLASS_FORBIDDEN`) | Ran in the sandbox. The 94 = 85 assets of classes A to D (rows 1 to 55 and 61 to 90; the 5 debts of class E are not assets of the registry) plus 9 refused kinds. |
| 12 | about 20 s | NEAR-SANDBOX | Terminal in `agents`: `X207_SANDBOX=1 npx vitest run test/classes.sandbox.test.ts`. Show the eleven lines `AG-022 ...`: the buyer outside the whitelist fails with `ERR_NOT_WHITELISTED` and is paid back, the whitelisted buyer holds 1000, then B, C, D reach `active` and class X is refused | "A real-world-asset token can refuse a transfer. The contract holds the exact amount, a buyer outside the whitelist fails and gets everything back, and a whitelisted buyer receives the tokens. One asset of each class works the same way, and a refused kind is refused." | `agents/test/classes.sandbox.test.ts` (AG-022, run 3 passed), contract tests `ct090_ft_escrow` and the restricted-token tests of CT-091 in `contracts` | Ran in the sandbox with a mock token (`probes/mock_rwa`). Classes B to D show the offer and the acceptance, not the delivery of the access. No real RWA token, no transfer-fee token (not supported). |
| 13 | about 15 s | none | `backend/docs/delivery.md`, then the terminal: `npx vitest run test/marketplace/delivery.test.ts` in `backend` (11 tests) | "Goods that are not on-chain cannot move in one atomic step. The seller marks the delivery, the buyer confirms with a signature, and if the buyer stays silent for the whole window the delivery is confirmed. Only then the bundle can be signed." | `backend/src/marketplace/delivery*.ts`, 11 tests passed on 2026-11-03 | Built in the backend and unit-tested. Not run on a network and not shown in the dashboard. The contract holds no payment for it: `CT-093` is a design note only. |
| 14 | about 20 s | none | Terminal in `contracts`: `scripts/verify-release.sh v0.0.9` (prints `x207-circle-v0.0.9.wasm: OK`, the sha256 in hex and in base58), then `docs/security.md` | "The contract you read is the contract that runs. Release v0.0.9 is built twice in a pinned container and gives the same bytes, so its hash can be compared with the code on chain. We reviewed our own code as attackers, twice for the contract, and fixed what we found with tests that failed before. This is not an external audit." | `contracts/scripts/verify-release.sh`, `contracts/docs/verify-release.md`, `docs/security.md` (every finding with its level, status and the command that repeats the check; the numbers on screen are the ones in that file) | The release check ran on 2026-11-03 (`SHA256SUMS` passes; wasm sha256 `fa8309059a84…`). **Waiting:** comparing that hash with the `code_hash` of an account on chain depends on the rehearsal v11 of the contract owner, which is running; do not say it was matched until its record has the `code_hash`. |

Commands of these scenes, one at a time (each starts its own `near-sandbox`):

```bash
X207_SANDBOX=1 npx vitest run tests/asset-catalog.sandbox.test.ts    # scene 11 (about 3 minutes; jump-cut)
(cd agents && X207_SANDBOX=1 npx vitest run test/classes.sandbox.test.ts)   # scene 12 (about 5 minutes)
(cd backend && npx vitest run test/marketplace/delivery.test.ts)     # scene 13
(cd contracts && scripts/verify-release.sh v0.0.9)                   # scene 14
```

## Scenes added on 2026-11-03, second batch (optional; the owner decides which to keep)

Five more cuts, each 12 to 20 seconds, for the features built after the first draft. Every one is a near-sandbox run with the real contract and the real backend; the only mocks are named in the narration. If the video must stay near 3 minutes, take one or two of them and drop scenes 11 to 13.

| No | Time | Label | On screen | Narration (EN) | Source of the proof | State |
| --- | --- | --- | --- | --- | --- | --- |
| 15 | about 15 s | NEAR-SANDBOX | Terminal: `X207_SANDBOX=1 npx vitest run tests/invoice.sandbox.test.ts`, then the table of the README block "Invoice and installment block" | "An invoice is a claim outside x207. The debtor signs three installments at once, one per epoch, and they are cleared with everything else: here a ring of three invoices clears 90 credit and nothing is left to pay." | `tests/invoice.sandbox.test.ts` (UM-086), README block | passed on 2026-11-03, 149 s |
| 16 | about 20 s | NEAR-SANDBOX | Terminal: `X207_SANDBOX=1 npx vitest run tests/orders.sandbox.test.ts`. Show the milestone `paid`, the milestone `disputed` with the pair still at 10 credit, and the keeper order with one voucher for one `close_epoch` | "Work is paid after it is confirmed. A disputed milestone is not paid, and a keeper is paid per transaction that shows on the chain. A delegate can be paid per vote on a DAO, by the same rule; that part runs against a mock node." | `tests/orders.sandbox.test.ts` (UM-087), `agents/test/delegate.test.ts` (AG-029) | passed, 69 s; the delegate part is a mock node |
| 17 | about 15 s | NEAR-SANDBOX | Terminal: `X207_SANDBOX=1 npx vitest run tests/licenses.sandbox.test.ts`. Show the dataset `confirmed` with the pair at 50 credit, and the file with another hash `disputed` with the pair at 0 | "x207 does not hold the file. The seller sells a license: the file is encrypted, the payment waits, and a seller who sends the wrong file is caught by the buyer's own check, with no judge." | `tests/licenses.sandbox.test.ts` (UM-088) | passed, 58 s |
| 18 | about 20 s | NEAR-SANDBOX | Terminal: `X207_SANDBOX=1 npx vitest run tests/rent.sandbox.test.ts`. Show the SSH key in `authorized_keys` with its `expiry-time`, the line removed after `grant_revoked`, and the cloud role bill refused over the cap | "An access is rented by the day. The renter pays one day ahead and the next only if the access still works, so each side loses one day at most. The providers here are mocks and an SSH file." | `tests/rent.sandbox.test.ts` (UM-089) | passed, 316 s (jump-cut) |
| 19 | about 15 s | NEAR-SANDBOX | Terminal in `sdk`: `X207_SANDBOX=1 npx vitest run apps/facilitator/test/frozen.sandbox.test.ts`. Show `account_frozen` for the frozen member and `isValid: true` for another pair | "The DAO can freeze a member after a timelock of 24 hours. From then on the facilitator takes no new voucher from or to it. Bonds with an arbiter for swaps came in the same release." | `sdk/apps/facilitator/test/frozen.sandbox.test.ts` (SD-074); `contracts` tests `ct094_bond`, `ct095_freeze` | passed, 417 s (the sandbox moves the clock 24 hours; jump-cut) |

Commands of these scenes, one at a time:

```bash
X207_SANDBOX=1 npx vitest run tests/invoice.sandbox.test.ts          # scene 15 (about 2.5 minutes; jump-cut)
X207_SANDBOX=1 npx vitest run tests/orders.sandbox.test.ts           # scene 16 (about 1 minute)
X207_SANDBOX=1 npx vitest run tests/licenses.sandbox.test.ts         # scene 17 (about 1 minute)
X207_SANDBOX=1 npx vitest run tests/rent.sandbox.test.ts             # scene 18 (about 5 minutes; jump-cut)
(cd sdk && X207_SANDBOX=1 npx vitest run apps/facilitator/test/frozen.sandbox.test.ts)   # scene 19 (about 7 minutes; jump-cut)
```

## Commands in the order of the scenes

```bash
npm run demo:sandbox                                # scenes 3, 4, 5 (about 3 minutes; jump-cut)
DEMO_DEFAULT=scraper npm run demo:sandbox           # scene 6
npm run demo:marketplace                            # scene 7 (about 2.5 minutes)
npm run demo:classb                                 # scene 8 (about 2 minutes)
node scripts/relief-curve.mjs                       # the star-graph curve of scene 5
```

Run them one at a time: each starts its own `near-sandbox`, and two at once on a busy machine can time out.

## Numbers that may be said

Read each from the terminal of the take that is on screen. The runs of 2026-11-02 gave: 120 paid calls, 12 registered pairs, cleared 1.52 credit, ratio 0.6333, 1 clearing transaction, 6 residual payments, "120 payments became 6". Marketplace: pay path 0.42 = 0.4 to the seller and 0.02 to the seeker, cleared 1.74 credit. Do not say a number that the screen does not show.

## What must not be said or shown

- Anything on mainnet: no mainnet transaction has been sent.
- NEAR Intents or 1Click paying a residual or a withdrawal: not run (`intents.testnet` has no code).
- A mainnet or Intents-backed version of the testnet epoch: the testnet epoch of `docs/testnet-demo.json` (barter, gas key, clearing, a default, a DAO vote) used a mock USDT.
- A class C secret behind a TEE: there is no TEE. A class A NFT escrow ran in the sandbox and on testnet with a mock NFT only.
- Real model inference by the agents: they run in mock or rule mode.
- A real wallet in the dashboard: the pages run against fixtures and a mock wallet.
- Savings on star graphs: the README says clearing helps in dense circles.
- That the 90 kinds of the catalog can be traded end to end. The registry holds them; only NFTs and fungible tokens (class A), a NEAR access key (B), a mock provider behind the proxy (C) and x402 endpoints (D) have a delivery that ran. Rows marked roadmap in the catalog have no adapter.
- That a real RWA token, a token with a transfer fee, or a token that needs KYC works: only `probes/mock_rwa` ran. A token with a transfer fee is refused on purpose.
- The off-chain handover on a network, or a payment held by the contract until the receiver confirms: the flow is in the backend only.
- That release v0.0.9 was matched with an account on chain, until the record of the rehearsal v11 says so. The release itself is reproducible and its checksums pass.
- That a delegate voted in a real Sputnik DAO and was paid for it: the votes of the delegate scenario run against a mock node.
- That access to a real GitHub, Discord or AWS account was rented: the providers of scene 18 are mocks and an SSH file. The adapters for the real services are tested against a mocked `fetch`.
- That the dashboard works with a real wallet under its content security policy: the policy of the production build has not been tried with one.
- That the bond with an arbiter or the freeze ran on testnet or mainnet: they ran in tests and in near-sandbox only.
- "Audited": the reviews are our own.

## X post (draft)

Required by the rules of the hackathon: the post says that the project was built at NEAR HACKATHON and carries the video or a screenshot. The owner fills the two places in brackets and decides on tags.

```text
x207: mutual credit settlement for x402 agent payments on NEAR. Agents sign vouchers, one transaction clears the debt cycles, only the net is paid. One sandbox epoch: 120 paid calls became 6 transfers. Prototype, no mainnet yet. Built at NEAR HACKATHON.

[repository link]
```

The video is attached as media. The text above is 253 characters; with a link counted as 23 characters it stays under 280. A longer thread may add the testnet hashes of scene 9.
