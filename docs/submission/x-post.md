# X post draft (UM-052)

Status: a draft. **Nothing was posted.** The human publishes the post, attaches the video or screenshots, and copies the post URL into `demoUrl` of the form ([form-draft.md](form-draft.md)). The hackathon asks the post to say that the project was built at NEAR HACKATHON and to show a demo video or screenshots.

## Post (one tweet, 268 characters with the link counted as 23; check the count in the composer)

```
We built x207 at NEAR HACKATHON: multilateral clearing for x402 agent payments on NEAR.

Testnet epoch: 24 vouchers (41.35), one clearing cancels 21.8; 7.75 USDT had to move (5 paid 7.2, 0.55 from a stake). Not cheaper in gas, testnet only. Read-only MCP:
https://github.com/x207-labs/x207
```

Attach: the video ([video-script.md](video-script.md)), or three screenshots: the dashboard on epoch 8 (`/stats?epoch=8`), the output of `npm run demo:quick` ending with `120 payments became 6`, and Claude answering through the hosted MCP server.

## Thread, optional (replies under the post)

1. `Problem: x402 settles every call on its own. 1,000 small payments = 1,000 transfers, and a channel per seller needs a deposit per seller, sized in advance. x207 adds one stake per member (limit at most the stake) and a clearing step at the end of each epoch. It does not save NEAR gas; it cuts the value that has to move (7.75 of 41.35 in epoch 8).`
2. `How: agents pay with signed vouchers, served at once. An open solver finds the debt cycles, ONE on-chain transaction cancels them, and only the net is paid in USDT. A default is covered from the stake.`
3. `Hosted, read-only, no key: dashboard https://x207-dashboard.vercel.app · MCP https://mcp.x207.boxd.sh/mcp · local with no account: npm run demo:quick, npm run demo:mcp`
4. `Honest limits: testnet only, mock USDT, no mainnet transaction; NEAR Intents ran only in near-sandbox; our keeper moves epochs until 2026-11-18. Every claim has a test or a transaction: CLAIMS.md in the repo.`

## Rules for the text

- Say "built at NEAR HACKATHON"; name no partner as a sponsor of the project and tag nobody without the owner's choice.
- Quote the three numbers together (21.8 cancelled, 19.55 left, 7.75 USDT net due; five debtors paid 7.2 and 0.55 came from a stake), never "half of the credit never moves".
- Do not claim mainnet, NEAR Intents on testnet, a real wallet flow, or third-party users.
- The repository and the three URLs must answer before the post goes out: `curl -s -o /dev/null -w "%{http_code}" <url>`.
