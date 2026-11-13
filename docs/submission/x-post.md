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

Each tweet is at most 280 characters with links counted as 23. In the ring demo one team script signs for all three agents.

1. `1/ Matching. Alice lists a Mapbox quota, Bob a JetBrains licence, Dan FastNEAR RPC access. No pair wants each other's asset, so they trade in a ring. The contract nets every position: of 81 credit traded, only 8 USDT moves. Testnet, epoch 184: https://x207.vercel.app/stats?epoch=184&circle=v018`
2. `2/ Pricing. An appraiser on NEAR AI Cloud (TEE) values the asset in credit. Signature checked locally; quote checked via third-party verifiers (Phala, NVIDIA NRAS). The value is advice, the contract does not read it. https://v018.x207.boxd.sh/x207/appraisals/apr_4d97a431de9635c442083c67`
3. `3/ Timing. Agents trade on mutual credit backed by a stake. A second 75-credit voucher over the limit is refused on chain: ERR_INSUFFICIENT_CREDIT. Testnet only, mainnet has not run. Docs: https://x207-docs.vercel.app Code: https://github.com/x207-labs/x207`
4. `4/ Honest limits: testnet only, mock USDT, one operator signed all three ring agents, only credit moved. NEAR Intents ran only in near-sandbox. Security reviews are internal, not an audit. Every claim has a test or a transaction: https://github.com/x207-labs/x207/blob/main/CLAIMS.md`

## Rules for the text

- Say "built at NEAR HACKATHON"; name no partner as a sponsor of the project and tag nobody without the owner's choice.
- Quote the numbers together (41.35 of obligations, 7.75 USDT net due from netting; five debtors paid 7.2 and 0.55 came from a stake; separately 21.8 of gross obligations cancelled by cycle clearing), never "half of the credit never moves" and never that clearing reduced the cash.
- Do not claim mainnet, NEAR Intents on testnet, a real wallet flow, or third-party users.
- The repository and the three URLs must answer before the post goes out: `curl -s -o /dev/null -w "%{http_code}" <url>`.
