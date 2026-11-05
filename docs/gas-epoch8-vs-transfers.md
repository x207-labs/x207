# Gas of epoch 8 against 24 plain token transfers (UM-125)

An honest comparison, with numbers from the chain. Epoch 8 of the circle `x207-v013.testnet` is the realistic epoch (UM-106, [testnet-0.0.13-realistic.json](testnet-0.0.13-realistic.json)): 24 vouchers between 15 members, 41.35 credit of obligations, multilateral netting leaves 7.75 USDT due from six debtors (separately, the solver cancelled 21.8 credit of the gross obligations, 19.55 left, which does not change what anyone pays) (five paid 7.2, one defaulted and 0.55 came from its stake). The comparison asks: what would it cost on NEAR to settle the same 24 payments with 24 plain `ft_transfer` calls, one per voucher, instead?

**Result in one line: x207 does not save gas. It burns more NEAR gas than 24 plain transfers; what it saves is the value that has to move.** Gas on testnet is cheap either way (a few thousandths of a NEAR); the point of clearing is the money, not the Tgas.

## Numbers
Gas is the gas burnt by the whole transaction, callbacks included; NEAR is `tokens_burnt`, the same definition as [contracts/docs/gas-and-cost.md](https://github.com/x207-labs/contracts/blob/main/docs/gas-and-cost.md), which has the full per-call table for epoch 2 and the method for the largest sizes. This page does not repeat that table; it adds epoch 8 and the baseline.

| | Calls | Gas, Tgas | NEAR burnt |
| --- | ---: | ---: | ---: |
| **A. x207, the four steps of the epoch** (`close_epoch` 3.03, `submit_clearing` 5.16, `commit_epoch` 23.54, `finalize_epoch` 15.36) | 4 | 47.09 | 0.00462 |
| A. residual paid in by the debtors (`ft_transfer_call` with the message `settle`, token transfer and callback included) | 5 | 38.52 | 0.00352 |
| A. creditors that claimed (`claim`, 3 of the 8 creditors claimed in the run) | 3 | 24.05 | 0.00220 |
| **A. subtotal, what the run did on chain, without vouchers** | 12 | **109.66** | **0.01034** |
| A. the 5 other creditors, if they had claimed too (*estimate*: 5 × the measured mean of 8.02 Tgas) | 5 | 40.1 | 0.0037 |
| A. registration of the 24 vouchers (`register_cumulative`, mean 4.87 Tgas) | 24 | 116.89 | 0.01115 |
| **A. total with the vouchers** | 36 | **226.55** | **0.02149** |
| **B. 24 plain `ft_transfer`** (one measured at 2.287 Tgas and 0.000206 NEAR, three times the same, × 24) | 24 | **54.90** | **0.00495** |

Read it this way: the four steps of the clearing alone (47.1 Tgas) are close to the cost of 24 transfers (54.9 Tgas); with the residual payments and claims x207 is about twice B, and with the vouchers registered on chain about four times. The vouchers are the largest part, and they are paid by whoever relays them, not by the keeper.

## What the gas does not show
| | A. x207 | B. 24 plain transfers |
| --- | --- | --- |
| Value that moves as tokens | **7.75 USDT** due (7.2 paid, 0.55 from stake) of 41.35 credit of obligations | **41.35** (the whole amount, 24 times) |
| Token transfers | 5 in from debtors, up to 8 out to creditors (3 claimed in the run) | 24 |
| Liquidity the payers need | only the net position, 7.75 in total after netting (the 21.8 credit the solver cancelled of the gross obligations does not change it) | the full amount of each payment, before the service is given |
| A payer that does not pay | its stake covers it (0.55 in the run); the other creditors are paid | that payee is not paid; nothing covers it |

So the claim that is supported: clearing moved 81% less value (7.75 of 41.35) in at most 13 token transfers instead of 24. The claim that is not supported: that it is cheaper in gas. It is not.

## When x207 starts to burn less gas, and what a cross-chain exit costs (UM-138)
Epoch 8 has one voucher per pair, which is the worst case for x207: each pair pays for a registration (4.87 Tgas) that replaces one 2.29 Tgas transfer. The cumulative voucher pays off when a pair trades many times in one epoch. [spikes/s2-gas-per-call-model.mjs](../spikes/s2-gas-per-call-model.mjs) takes the measured Tgas of this page (a transfer 2.29, a registration 4.87 on average, the four clearing steps 47.09) and counts only registrations plus the four steps:

| Calls in the epoch | Pairs | Calls per pair | Plain transfers | x207, registrations and four steps |
| ---: | ---: | ---: | ---: | ---: |
| 24 | 24 | 1 | 54.9 Tgas | more than the plain transfers (break-even at 2.99 calls per pair) |
| 120 | 12 | 10 | 274.5 Tgas | 105.5 Tgas |

The break-even is about 3 to 4 calls per pair (2.99 for 24 pairs, 3.84 for 12, 4.19 for 10). It is a lower bound: the residual payments and the claims (38.52 and 24.05 Tgas in epoch 8) are not counted, and the number is a model of measured units, not one run. So the claim "120 paid calls became 12 registrations" is true as a count of transactions, and it saves gas only above that threshold.

The exit to another chain has a fixed cost too. [spikes/s4-crosschain-minimums.mjs](../spikes/s4-crosschain-minimums.mjs) asks the 1Click API for dry quotes (no funds) of USDT held in Intents, run on 2026-11-04 at 15:35 UTC:

| Destination | 0.01 USDT | 0.1 USDT | 1 USDT | 5 USDT |
| --- | --- | --- | --- | --- |
| USDC on Base | 0.007583 arrives (24.2% lost) | 0.097469 (2.5%) | 0.996529 (0.3%) | 4.990736 (0.2%) |
| USDT on Tron | refused, minimum about 1.89 | refused | refused | 4.126108 (17.5% lost) |

A cross-chain payment of a few cents can lose a quarter of its value or be refused, and x207 sends only the net position, not each call. In epoch 8 that was 7.75 USDT for six debtors. Fees and minimums change from day to day, and paying several debtors in one `execute_intents` has run only in `near-sandbox`, not on testnet ([what-has-run.md](what-has-run.md)).

## Method
1. **A, from the chain.** The 36 transactions of epoch 8 are the steps of the realistic run recorded in `docs/testnet-0.0.13-realistic.json` (hashes and names only). Each was read with the RPC method `tx` (`wait_until: FINAL`) and its gas burnt and tokens burnt were summed over the transaction outcome and every receipt outcome. The result, with every hash, is [gas-epoch8.json](gas-epoch8.json). None of them failed. The `mint` calls that gave the debtors mock USDT are left out: they exist only because the token is a testnet mock.
2. **B, measured, not assumed.** `node scripts/gas-ft-transfer-testnet.mjs` sends `ft_transfer` of 1.0 unit (1,000,000 with 6 decimals) with 1 yoctoNEAR attached from one member account to three others on `usdt.x207-deployer.testnet`, and sums the same way. The three transactions burnt exactly the same, 2.287 Tgas and 0.000206 NEAR (3 outcomes each); the record is [gas-ft-transfer-testnet.json](gas-ft-transfer-testnet.json). 24 times that is the baseline.
3. The estimate row (5 more claims) is the only number here that was not sent on chain.

## Limits
- The token is a testnet mock. A `ft_transfer` of the real USDT on mainnet may burn more or less; the mock is a plain NEP-141 contract, and the same contract is the one the `ft_transfer_call` rows of A run through, so the two sides use the same token code. A mainnet figure is not claimed.
- B leaves out what the 24 vouchers are for: without x402 payments in credit there are no vouchers, but also no netting, no limit and no default cover. The comparison is the cost of moving the same payments, not of the same service.
- One epoch, one graph. The clearing steps grow with the number of edges (`commit_epoch` 69.4 Tgas for 210 edges in [gas-and-cost.md](https://github.com/x207-labs/contracts/blob/main/docs/gas-and-cost.md)), the plain transfers grow linearly with the number of payments; the cleared share, not the gas, decides where clearing pays off.
