# Testnet rehearsal of F1 to F4 (2026-11-02)

A rehearsal of the first four features on NEAR testnet, run with the owner's permission. It is not a mainnet run and it is not the final demo. It used a separate rehearsal contract with short parameters and a mock USDT token, created from faucet accounts. The mainnet deployer account was not used, and no mainnet transaction was sent.

| Item | Value |
| --- | --- |
| Circle contract | `x207r-circle.testnet`, interface 0.0.1 (older than the 0.0.5 of this repository) |
| Parameters | `epoch_length` 300 s, `proposal_window` 60 s, `payment_window` 900 s |
| Mock USDT | `x207r-usdt.testnet` |
| Agents | `x207r-{translator,summarizer,scraper,image,cleaner,gpu}.testnet` |
| Command | `npm run demo:testnet` with `X207_CONFIRM_REAL_TX=yes` (`demo/network.demo.ts`) |

What did not run: the indexer and read API (public testnet RPC and Neardata rate-limited a block backfill, so the solver read the cutoff snapshot from the contract view `list_obligations`), the 207 report from the indexer, a claim with destination `intents`, a DAO vote, F5 and F9, and anything on mainnet.

## Run 1, epoch 2

Twenty paid calls, twelve registrations. The clearing window passed while the indexer was blocked, so there was no clearing (cleared 0) and the 20 payments became 2 residual payments. Then both debtors settled, the epoch was finalized and two creditors claimed to `near`.

| Stage | Transaction hash |
| --- | --- |
| register | `7Utv9GqSNyK93vaK9e5qH48tmuUoQiBhVvienK92bbzf` |
| register | `HtTcPfs9Q9PTrC1xpCbqXFZHE1rv3VZtuLQwwoNk7Rv4` |
| register | `wXh322jomSw4awEPauCCyVTfkBN2mXdUiU72XUPSZWw` |
| register | `ADVhsbvhhT9iRwNMNtSP4q4uSoEZCatk3guzvak9Xi9M` |
| register | `9RnkGppTFqZc5VmVxMtdzpGtXqKzGrTkxFmDEG8BeudB` |
| register | `Att17oCuS6f9g2QT7m1DdGGiKWmJdoayftmXyswQpKPd` |
| register | `73K2Ec464BVTxCEC7MeFjix54X3r38gy1UiyXRmoqm76` |
| register | `4FXXT1cFZuMqo5gxXukB41QgdUBxe9PtdsA4RiVyANcb` |
| register | `7sYbtDy75P8D38m5uGLT1cLFUrhJWXy7i8TaLX3EecmB` |
| register | `DWmaFPyUXJXW9mzo6AiS5XitPBfqyYGcJvK1Kg2GzEEt` |
| register | `G8RvuwUw2KGwQNk5rh8kygrit3Ut7sNoM6nk75yTq45Q` |
| register | `22KUtNfWdCLj4AvSNdA9o3XW9iTfoc8tVAgz3wGd51KV` |
| translator.settle | `6tR3dZXrRbJb3pobeNF3w3py1ohstr3B3cQD8ZDYv7CR` |
| summarizer.settle | `AqoHkEQFRRmb1uFhpVQtcuxkn9i4k7asRPPyP5zj66i5` |
| keeper.commit_epoch | `8T4V8bQuo5ALDXruouM9g22bgvcsrBxg7X7i8AZjnLWp` |
| keeper.finalize_epoch | `E8egqnCVhxr3sj4yb4CGujTgxmzKT3o87vBSzvkqSt9G` |
| keeper.finalize_epoch | `5xzyfVq6fVYoLC1D37Qt9FW1JLqkova54rHJPFhdoifG` |
| cleaner.claim.claim | `9m8u6mK4nZ9VCeWr6Fse2q7eSYiQd1ck9cU2GuheU8Yf` |
| gpu.claim.claim | `8yjjZJGjhN2ug4gyEtfzo8B5ft2dg2GSEhS3hJDT278h` |

## Run 2, epoch 8, with a debtor that does not pay (`DEMO_DEFAULT=translator`)

Twenty paid calls, twelve registrations, one clearing proposal. Cleared 0.28 of 0.40 credit (0.7), two residual transfers; `summarizer` settled, `translator` did not and was set to `defaulted` (amount 0.02, covered from its stake), status `suspended`, limit 0, stake 49980000 in 6-decimal units. Two creditors claimed to `near`.

| Stage | Transaction hash |
| --- | --- |
| translator.usdt.mint | `v5Yv4Ag9oFNefPsPWmG17MJNzEDxJiSnEuEh53wiozM` |
| summarizer.usdt.mint | `D4vjtuLHqjsVd7riYgJT9ACHwVNWAiTkNS9tfzspTTUW` |
| scraper.usdt.mint | `GbA8nGUm4FtTRkdrjJnmuGUNRsj1az2SYPiSTpdm9fjJ` |
| image.usdt.mint | `G3F1YjHYyvNKZh7EfYA3tUs3xVREPVdnXPqpN9LaNtC1` |
| cleaner.usdt.mint | `6LKYoG1QuMeqgdAQHWmXkhLwqTnhidLVS9p477SpZnpx` |
| gpu.usdt.mint | `HdNEXTkFHhnwR5Uf2F96ueSoqUdDAh8eG17zm3sCFtVF` |
| keeper.close_epoch | `3av1sUR13SMKUyFnndHpjKjSjor5H7uz2ujwkbkspuze` |
| relayer.register | `4wzvfqeetmHaJMQ2gPDYddY3bdPy9NzEctoUFwzbDk6k` |
| relayer.register | `3jmrhrShKPXjnoVShEu1dhuQRFdxjcXNWeuRYAXeD7gr` |
| relayer.register | `C1DavcVR9Kdq1DJkfiGn9JpocF9tCs87M93avWVmvgH` |
| relayer.register | `3dJSxdRBUod7LNsK6qBTBM6PyyD382SdvbbkJErj46Qj` |
| relayer.register | `AaXkt6zdBBZVDvuv9WmHw2u7im9547C41pSg1WT1zDTz` |
| relayer.register | `C4HwyWUVQ9dWmssqXDbTEJPzSJRLAq67os2uLeysk9af` |
| relayer.register | `4JfH474xHt8T6tY1zvWRS8iZ9R3rRYGP2JUa5bcMBeH1` |
| relayer.register | `8hEWwuCspjL2vHAATjpoYp7sZjt3u1njppqd7Pzn7Gcw` |
| relayer.register | `DBhYfYEZrs7qxkdkb1uXu1pYngWu9nszJLYdt8ffDUug` |
| relayer.register | `BKva6Z7rs7JqPKdY8dUqnLaQH2P74yaq5agqtPHwh25g` |
| relayer.register | `aRt6nPKmE63pa5AiENMSJy1ACLPdkyhuSt6scDjGwG1` |
| relayer.register | `HkWf48sByvHwundX8QoKQJPKkgcjzmQkNBUKe7J8oBpV` |
| keeper.finalize_epoch | `8VX6itd4YyGzsgUK73FCi9ajT2vNc3VUm358b8F7USh9` |
| keeper.commit_epoch | `353Mn8ByCEtjHGKiiP6EAYB4EpurKvMdy5jmEjcwZjbK` |
| keeper.close_epoch | `HMbuVNCzaLkTXVfVd6gqVgoGiu6mn4mNcfQLMrznGqws` |
| solver.submit_clearing | `ANrNYNToaQbf71zaU3NyLU4afEJicCUP7Tb4c5hLhc7h` |
| keeper.finalize_epoch | `GzvW2wXzM2vM3PwRxerCxDAcuzXkMLmZgyztpR4pbx9y` |
| keeper.commit_epoch | `GvTZddvsetvti93eLDRhXRmGEu3SBfzH9t9vkcVmbwHe` |
| summarizer.settle.ft_transfer_call | `6ycsv1A4SpBHaQ2xmAY6fNfR2SA1jQckveFWRtcTbML7` |
| keeper.close_epoch | `BTKqK9gGDLyU1t7Zuet1V9VeYTadeYXGfZvEibJBCzvd` |
| keeper.commit_epoch | `EBpoTSxLyKWaiswVSjAPW6NDh7W5YJoAskqhor9Z9h5w` |
| keeper.finalize_epoch | `EdsBsSMU6gSV9Mpp3NRTW6vELtgJgctGW7Q7o6MwfcbZ` |
| keeper.close_epoch | `AnRoUiDVA6dSz4nickWxiwvVtHeAkxFcqEgkUetmD4mc` |
| keeper.commit_epoch | `J9c4YVAhwBfAskye3VBCqbzUsTcmwrZMKYsPCkhTV3jz` |
| keeper.finalize_epoch | `9ymCmpCz2kxbHFYzFDEmt6evUUGJzmrj1WGFgivTgoL5` |
| keeper.close_epoch | `EPBJn8r249rgyXj7wycfiW1W7KEMVjjDqhtnjwMo5JZn` |
| keeper.commit_epoch | `3T8iCzKbZahr5N3yfuW1DiC7six46JWcqWP6DTFsqrrD` |
| keeper.finalize_epoch | `84XkHTkkFDP6h9buFEdb4JBVUTEb4pX61ezELiysYnKS` |
| cleaner.claim.claim | `2aJuTSgv9wPUtbAxrwhXXtovqwdAbc4MdF6uh62AsNGN` |
| gpu.claim.claim | `261dvC2ZtTWAffAZh18bf47um4Ehp9edzqvVGTUsosN3` |

## F1, join and stake (twelve transactions)

| Stage | Transaction hash |
| --- | --- |
| translator.join | `CfEZmSvr8xWYHSJBRViFMLxV4mZBssEFei2GMV9rJgL6` |
| translator.ft_transfer_call | `CmV79AwATmZWgwnD5M2x2RAjuZjCQRug7JYWz3D7rPg4` |
| summarizer.join | `2gmS6uaXUx2VhQuVv5NLTStsHP1fuqcYnUFnNhF7ZuMt` |
| summarizer.ft_transfer_call | `2iRzRMcBEjhuYbmKA47jQ2Car17WNuq3QnkGX2WBMqdP` |
| scraper.join | `84Cqymo3nxxHp5S2TqvpnMFhAVUFLPzU3dn11Z3tvF9Y` |
| scraper.ft_transfer_call | `CkoZEaqzn4PnXfTZ8MxUMsBiT2EeYF9iXgCvwnHAGr8J` |
| image.join | `2vNiMWovvtcGqXBUxafTNqeivKETx88VR9gYyX3WoR5c` |
| image.ft_transfer_call | `J3WJtzPjbEVHYfFVHygWNFgKCo87PysXvrp4YbRgME4m` |
| cleaner.join | `7NRnp9xATEwNrX8KzfJymtERaKU3edeoitzAdguLdFFa` |
| cleaner.ft_transfer_call | `2r1phKV8QP4V35DqMchd2FBk96t98hruJwEWn1pCYwEp` |
| gpu.join | `3QvR7VwE6uGedFvSxfEqsTHqK3z6UJ4ZZFnxHSvT9CzX` |
| gpu.ft_transfer_call | `GernxdL5gUs2heV9meEnZkfbS5D24cC3uNUt417wG86w` |

The hash lists of runs 1 and 2 come from the files `.demo/hashes-testnet-epoch2.json` and `.demo/hashes-testnet-epoch8.json` that the script wrote (for run 1 the registrations, the two settle transactions and `commit_epoch` are added from the output of that run). The `mint` rows are the mock token. Hashes can be looked up on `https://testnet.nearblocks.io/txns/<hash>`.

## Rehearsal 2 (2026-11-03): contract 0.0.7, barter flow

Test: `tests/testnet-rehearsal.live.test.ts` (run with `X207_TESTNET=1`). Contract `x207-circle-v7.testnet`, interface 0.0.7 (view `interface_version` answers `"0.0.7"`), mock USDT `usdt.x207-deployer.testnet`, parameters `epoch_length` 600 s, `proposal_window` 60 s, `payment_window` 900 s. Five member accounts (`andi`, `budi`, `citra`, `dewi`, `eka`), the real backend and solver on one machine.

What ran: the F9 quick barter 100 / 10 / 3 (pay and barter paths with a seeker share), a ring of three intents, three bundles (`commit_bundle`, legs through `register_in_bundle`), close, solver, commit, residual payments, `finalize_epoch` and three claims.

Read from the contract on 2026-11-03 (view `get_epoch` with `epoch` 4): phase `finalized`, 8 edges, 5 participants, `total_obligation` 303.3 credit, `total_cleared` 200.3 credit, `pool` 0, `shortfall` 0. The transaction hashes are in `testnet-rehearsal-v7.json`.

What did not run: NEAR Intents (`intents.testnet` has no code), a DAO vote, access assets (F8), a default case, and an indexer that follows every block. The free endpoints limit the rate, so the indexer of this rehearsal reads the receipts of each transaction that the test sends, one hash at a time, and serves only those blocks; the events are the real ones from the chain. The USDT is a mock token.

## Other testnet runs of 2026-11-03

| Run | Contract or accounts | Result | Hashes |
| --- | --- | --- | --- |
| DAO vote on `set_params` | Sputnik DAO `x207v8.sputnikv2.testnet` owns `x207-circle-v8.testnet` (0.0.7) | One proposal (`limit_decay` 0 to 100), two council votes, effective from epoch 2 | `testnet-dao-v8.json` |
| Access assets (F8) | `x207-circle-v9.testnet` (0.0.7), real broker | Class B: `AddKey` and `DeleteKey` on a lease account, grants revoked and expired. Class A: failed delivery (`escrow_failed`), then a delivered sale, mock NFT. Class C: a grant offered, the proxy ran locally against a mock provider, no TEE | `testnet-f8-v9.json` |
| `exact` payment (SD-034) | `x207b-buyer`, `x207b-seller`, relayer `x207b-relayer`, token `usdt.fakes.testnet` | A buyer outside every circle paid 0.02 USDT.e to a seller endpoint through the facilitator on `near:testnet`; the relayer paid the gas and the buyer spent no NEAR | `testnet-demo.json`, section `sd-034-exact` |
| Gas key (SD-031) | `x207b-relayer.testnet` | Four transactions at the same time from one gas key with four lanes, one per lane, all accepted; each lane nonce advanced. The calls were `ft_total_supply` of the mock token, not `register_cumulative` | `testnet-demo.json`, section `sd-031-gaskey` |
| Network demo with barter, gas key, a default and a DAO vote (UM-032, UM-036, UM-037) | Own circle `x207b-circle2.testnet` (0.0.7, epoch 600 s), owner the DAO `x207b.sputnikv2.testnet`, six agents `x207b-*`, mock USDT `x207b-usdt.testnet` | Run 8 (epoch 5): the barter ring (`commit_bundle`, three legs), 60 paid calls, registrations through the gas key, four lanes in parallel, clearing 1.1 of 1.5 credit (75 vouchers, 2 residual payments), claims. Run 9 (epoch 8, resumed once after a local DNS failure): the same, and a debtor that did not pay (stake cut by 200000, status 409, limit 0), then a DAO proposal `set_params` (`limit_decay` 0 to 100) approved by two council votes and `params_updated` with `effective_epoch` 11. Seven earlier runs did not finish, see below | `testnet-demo.json`, section `network-demo` |

Why the first seven runs of the network demo did not finish: two stopped at the barter step with `ERR_BUNDLE_EXISTS` (the same bundle had been committed in the epoch that was still open; the script now waits for a fresh epoch), one on a connect timeout, and four after about 17 paid calls with HTTP 503 `facilitator_unavailable`, because the free fastnear RPC answered 429 and then timed out. A paid call cost the facilitator 12 JSON-RPC requests (`member` 4, `obligation` 3.9, `get_epoch` 2, `headroom` 2; measured in `near-sandbox` with 96 payments over six pairs). The facilitator now keeps those reads for a few seconds (`chainCache`: 0.13 requests per payment after the first round; staleness and its cost in `sdk/docs/rpc-load.md`), `NearRpc` repeats a 429 with backoff, and the demo uses one buyer client per agent, a pause of 1.5 s between calls, a registration tick of 8 s and four RPC endpoints in order. With that, runs 8 and 9 passed the point where the earlier ones stopped. The public RPC is still a limit for a busy facilitator: the cache bounds the requests per second (about 2.2 for six members and twelve pairs), not per payment, and a paying RPC would remove the doubt. The v7 rehearsal avoids the problem by feeding the indexer from the receipts of each transaction.
