# X post draft (UM-052)

Status: a draft. **Nothing was posted.** The human publishes the post, attaches the video or screenshots, and copies the post URL into `demoUrl` of the form ([form-draft.md](form-draft.md)). The hackathon asks the post to say that the project was built at NEAR HACKATHON and to show a demo video or screenshots.

## Post (one tweet, 271 characters with the link counted as 23; check the count in the composer)

```
We built x207 at NEAR HACKATHON: multilateral clearing for x402 agent payments on NEAR.

Testnet epoch: netting settled 24 vouchers (41.35) with 7.75 USDT moving; the solver cancelled 21.8 of gross. Not cheaper in gas, testnet only. Read-only MCP:
https://github.com/x207-labs/x207
```

Attach: the video ([video-script.md](video-script.md)), or three screenshots: the dashboard on epoch 8 (`/stats?epoch=8`), the output of `npm run demo:quick` ending with `120 payments became 6`, and Claude answering through the hosted MCP server.

## Thread, optional (replies under the post)

1. `Problem: x402 settles every call on its own. 1,000 small payments = 1,000 transfers, and a channel per seller needs a deposit per seller, sized in advance. x207 adds one stake per member (limit at most the stake) and a clearing step at the end of each epoch. It does not save NEAR gas; it cuts the value that has to move (7.75 of 41.35 in epoch 8).`
2. `How: agents pay with signed vouchers, served at once. The contract nets every member's position in ONE on-chain transaction and only the net is paid in USDT; an open solver also cancels debt cycles in the gross record (no change to who pays in the MVP). A default is covered from the stake.`
3. `Hosted, read-only, no key: dashboard https://x207-dashboard.vercel.app · MCP https://mcp.x207.boxd.sh/mcp · local with no account: npm run demo:quick, npm run demo:mcp`
4. `Honest limits: testnet only, mock USDT, no mainnet transaction; NEAR Intents ran only in near-sandbox; our keeper moves epochs until 2026-11-18. Every claim has a test or a transaction: CLAIMS.md in the repo.`

## Rules for the text

- Say "built at NEAR HACKATHON"; name no partner as a sponsor of the project and tag nobody without the owner's choice.
- Quote the numbers together (41.35 of obligations, 7.75 USDT net due from netting; five debtors paid 7.2 and 0.55 came from a stake; separately 21.8 of gross obligations cancelled by cycle clearing), never "half of the credit never moves" and never that clearing reduced the cash.
- Do not claim mainnet, NEAR Intents on testnet, a real wallet flow, or third-party users.
- The repository and the three URLs must answer before the post goes out: `curl -s -o /dev/null -w "%{http_code}" <url>`.
