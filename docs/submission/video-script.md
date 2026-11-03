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
- A testnet epoch with a default or a DAO vote inside the network demo as one run: the default branch and the DAO vote ran as separate runs, see `docs/testnet-rehearsal.md`.
- A class C secret behind a TEE: there is no TEE. A class A NFT escrow ran in the sandbox and on testnet with a mock NFT only.
- Real model inference by the agents: they run in mock or rule mode.
- A real wallet in the dashboard: the pages run against fixtures and a mock wallet.
- Savings on star graphs: the README says clearing helps in dense circles.

## X post (draft)

Required by the rules of the hackathon: the post says that the project was built at NEAR HACKATHON and carries the video or a screenshot. The owner fills the two places in brackets and decides on tags.

```text
x207: mutual credit settlement for x402 agent payments on NEAR. Agents sign vouchers, one transaction clears the debt cycles, only the net is paid. One sandbox epoch: 120 paid calls became 6 transfers. Prototype, no mainnet yet. Built at NEAR HACKATHON.

[repository link]
```

The video is attached as media. The text above is 253 characters; with a link counted as 23 characters it stays under 280. A longer thread may add the testnet hashes of scene 9.
