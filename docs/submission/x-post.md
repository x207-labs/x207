# X post draft (UM-052)

Status: a draft. **Nothing was posted.** The human publishes the post, attaches the video or screenshots, and copies the post URL into `demoUrl` of the form ([form-draft.md](form-draft.md)). The hackathon asks the post to say that the project was built at NEAR HACKATHON and to show a demo video or screenshots.

## Post (one tweet, 239 characters with the link counted as 23; check the count in the composer)

```
Built at NEAR HACKATHON. Barter failed for three reasons: matching, pricing, timing. x207 fixes all three for AI agents on NEAR.

Testnet demo: a 3-agent ring traded 81 credit, 8 USDT moved (mock USDT, no mainnet).

https://x207.vercel.app
```

Attach: the video ([video-script.md](video-script.md)), or three screenshots: the epoch 184 ring on the dashboard (`/stats?epoch=184&circle=v018`), the appraiser badge on a listing in the marketplace (circle v018), and the overspend refusal (`ERR_INSUFFICIENT_CREDIT`).

## Thread, optional (replies under the post)

1. `Problem: x402 settles every call on its own. 1,000 small payments = 1,000 transfers, and a channel per seller needs a deposit per seller, sized in advance. x207 adds one stake per member (limit at most the stake) and a clearing step at the end of each epoch. It does not save NEAR gas; it cuts the value that has to move (7.75 of 41.35 in epoch 8).`
2. `How: agents pay with signed vouchers, served at once. The contract nets every member's position in ONE on-chain transaction and only the net is paid in USDT; an open solver also cancels debt cycles in the gross record (no change to who pays in the MVP). A default is covered from the stake.`
3. `Hosted, read-only, no key: dashboard https://x207.vercel.app/stats · MCP https://mcp.x207.boxd.sh/mcp · local with no account: npm run demo:quick, npm run demo:mcp`
4. `Honest limits: testnet only, mock USDT, no mainnet transaction; NEAR Intents ran only in near-sandbox; our keeper moves epochs until 2026-11-30. Every claim has a test or a transaction: CLAIMS.md in the repo.`

## Rules for the text

- Say "built at NEAR HACKATHON"; name no partner as a sponsor of the project and tag nobody without the owner's choice.
- Quote the numbers together (41.35 of obligations, 7.75 USDT net due from netting; five debtors paid 7.2 and 0.55 came from a stake; separately 21.8 of gross obligations cancelled by cycle clearing), never "half of the credit never moves" and never that clearing reduced the cash.
- Do not claim mainnet, NEAR Intents on testnet, a real wallet flow, or third-party users.
- The repository and the three URLs must answer before the post goes out: `curl -s -o /dev/null -w "%{http_code}" <url>`.
