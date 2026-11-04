# X post draft (UM-052)

Status: a draft. **Nothing was posted.** The human publishes the post, attaches the video or screenshots, and copies the post URL into `demoUrl` of the form ([form-draft.md](form-draft.md)). The hackathon asks the post to say that the project was built at NEAR HACKATHON and to show a demo video or screenshots.

## Post (one tweet, 268 characters with the link counted as 23; check the count in the composer)

```
We built x207 at NEAR HACKATHON: mutual credit + clearing for x402 agent payments on NEAR.

Testnet epoch: 24 vouchers (41.35), one clearing cancels 21.8; the 19.55 left nets to 7.75 USDT (5 paid 7.2, 0.55 from a stake). Read-only MCP included:
https://github.com/x207-labs/x207
```

Attach: the video ([video-script.md](video-script.md)), or three screenshots: the dashboard on epoch 8 (`/stats?epoch=8`), the output of `npm run demo:quick` ending with `120 payments became 6`, and Claude answering through the hosted MCP server.

## Thread, optional (replies under the post)

1. `Problem: x402 settles every call on its own. 1,000 small payments = 1,000 transfers, and an agent with no cash cannot buy. x207 adds credit (limit from stake) and a clearing step at the end of each epoch.`
2. `How: agents pay with signed credit vouchers, served at once. An open solver finds the debt cycles, ONE on-chain transaction cancels them, and only the net is paid in USDT. A default is covered from the stake.`
3. `Hosted, read-only, no key: dashboard https://x207-dashboard.vercel.app · MCP https://x207-mcp-production.up.railway.app/mcp · local with no account: npm run demo:quick, npm run demo:mcp`
4. `Honest limits: testnet only, no mainnet transaction; NEAR Intents ran only in near-sandbox; no TEE broker yet. Every claim has a test or a transaction: CLAIMS.md in the repo.`

## Rules for the text

- Say "built at NEAR HACKATHON"; name no partner as a sponsor of the project and tag nobody without the owner's choice.
- Quote the three numbers together (21.8 cancelled, 19.55 left, 7.75 USDT net due; five debtors paid 7.2 and 0.55 came from a stake), never "half of the credit never moves".
- Do not claim mainnet, NEAR Intents on testnet, a real wallet flow, or third-party users.
- The repository and the three URLs must answer before the post goes out: `curl -s -o /dev/null -w "%{http_code}" <url>`.
