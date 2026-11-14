# X post draft (UM-052, narrative v2 UM-211)

Status: a draft. **Nothing was posted.** The human publishes the post, attaches the demo video, and copies the URL of tweet 1 into `demoUrl` of the form ([form-draft.md](form-draft.md)). The hackathon asks the post to say that the project was built at NEAR HACKATHON, to tag @NEARProtocol and #NEARHackathon (@NearLegion and @NearBuilders are optional), to lead with the user problem, to say concretely what NEAR enables, and to attach a demo video or screenshots.

## Thread (each tweet at most 280 characters, links counted as 23)

1. Attach the demo video ([video-script.md](video-script.md)).

   ```
   AI agents can now hold wallets and buy anything, instantly.

   That's also how you burn cash at machine speed.

   x207 lets agents pay with what they already own. On NEAR testnet, 81 credit of trade settled with 8 in cash.

   Built at #NEARHackathon @NEARProtocol

   Watch 👇
   ```

2. ```
   How it works: agents barter digital assets (API quota, licences, access) on credit backed by a stake. An appraiser in a TEE prices them. At the end of each epoch a NEAR contract cancels the loops, and every agent settles one net payment.
   ```

3. ```
   Why NEAR: named accounts with a voucher key that cannot move funds, a contract that verifies every multi-party clearing, and NEAR AI Cloud private inference for attested prices.
   ```

4. Attach a picture of the ring of epoch 245.

   ```
   Proof, epoch 245 on x207-v018.testnet: three NFTs moved to their buyers through contract escrow, and the loop cancelled 72 of 81 credit. Check the owners on chain yourself: https://github.com/x207-labs/x207#try-it-in-2-minutes Dashboard: https://x207.vercel.app/stats?epoch=245&circle=v018
   ```

5. ```
   Honest limits: testnet, mock NFTs and mock USDT, one operator ran all three agents, prices set by the operator. Code: https://github.com/x207-labs/x207

   Agent builders: what would your agent trade away first?

   @NearLegion @NearBuilders
   ```

## Rules for the text

- Say "built at NEAR HACKATHON" and tag @NEARProtocol and #NEARHackathon; name no partner as a sponsor of the project.
- "81 credit of trade settled with 8 in cash" is the ring of epoch 245: 81 owed, 72 cancelled in the loop, 9 left, netted to 8 mock USDT. Say "cash", not "cost": x207 does not save gas.
- Do not claim mainnet, NEAR Intents on testnet, a real wallet flow, third-party users, or unlimited spending (credit is capped by the stake).
- The repository and the URLs must answer before the post goes out: `curl -s -o /dev/null -w "%{http_code}" <url>`.
