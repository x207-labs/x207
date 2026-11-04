# x402 Foundation Slack

Source of the rule: [CONTRIBUTING.md](https://github.com/x402-foundation/x402/blob/main/CONTRIBUTING.md) of `x402-foundation/x402`, read on 2026-11-05. It says GitHub issues are for bug reports and concrete feature proposals only, and that "questions, general discussion, and project showcases" go to the Slack community at <http://slack.x402.org/>.

**Channel: not verified.** CONTRIBUTING does not name a channel, and the workspace cannot be read without joining. A public search found only `#tsc-public` (the Technical Steering Committee) and the working groups. The owner looks at the channel list after joining and picks the one for project showcases (`#showcase` if it exists; otherwise the general or community channel). Do not post a showcase in `#tsc-public`.

Join first, read the channel for a day, and follow its rules and pinned posts.

## Message (about 80 words)

```text
Hi all, we're building x207, a mutual-credit settlement layer for x402 agent payments on NEAR. Agents pay each other with signed credit vouchers; once per epoch a solver nets the debt cycles and only the residual moves in USDT.

It is testnet only (mock USDT, no mainnet transaction yet), and we don't claim a gas saving. We'd like 2–6 agents from one operator or community to join the testnet circle as a pilot: https://github.com/x207-labs/x207/blob/main/docs/join-the-circle.md or `npx -y @x207/mcp`. Spec proposal: https://github.com/x402-foundation/x402/issues/4131. Feedback welcome.
```

Word count: 86 with the two links counted as one word each (about 80 if you cut "Feedback welcome."). It fits a Slack post of two short paragraphs.

## Follow-up question (post in a thread only if a maintainer answers)

[adoption.md](../adoption.md) row 10 also wants to know how the Developer Tools facilitator table is updated: it lists a NEAR facilitator and "Solvador" and states no process. Ask once, in the thread, not in the first message:

```text
Is there a process for the Developer Tools / facilitator table on x402.org? Happy to open a PR if you tell us where its source lives.
```

## Check before posting

- `https://github.com/x402-foundation/x402/issues/4131` is still open (adoption.md: open, 0 comments on 2026-11-04). If it was closed or answered, change the last sentence.
- The join guide link resolves on `main` after the coordinator has pushed this folder's neighbours. It is in the repository already; the link in the message is absolute for that reason.
- Do not name members of the circle or quote the adoption numbers: the circle has 30 members and nobody has checked whether any of them is outside the team ([adoption.md](../adoption.md), "First pilot").
