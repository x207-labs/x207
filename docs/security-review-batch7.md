# Security review, batch 7 (UM-063): the one-time code book and the secret proxy of the backend

Scope, read only: BE-069 (the code book: listing check of a code, `POST/GET /listings/{hash}/code-check`, `code_seen`, the dispute and complaint rule, the one hour window) and BE-070 (the class C secret proxy of the broker and the `openrouter-subkey` adapter), both written by Main C, read at backend `e7f46d9` (the earlier review of the SDK, frontend and agents side of the same flow is `backend/docs/security-review-batch6.md`; its findings are not repeated unless a fix opened something new). Nothing in any repository was changed by the review.

Levels as in batch 2 and batch 4: High = money or a proof can be forged by the other party with no cooperation; Medium = a documented guarantee does not hold under a plausible setup, or a party can gain with it; Low = hardening; Info = a limit to write down. Ids: `B7-C` for the code book, `B7-P` for the proxy. Every finding was reproduced with a throwaway test unless its text says "read, not run". The tests run against the real backend and broker code with mock issuers, providers and facilitator; nothing ran against OpenRouter, a real issuer, a real facilitator or the contract. Two readers worked on the two halves in parallel and the author of this document re-ran both sets of throwaway tests before publishing: the code book set passes 15 of 15 (each test prints the lines that the findings quote), the proxy set passes 22 of 23 (the one that fails is the timeout of the test of B7-P5, which prints its result before the vitest timeout of 5 seconds).

**What this review says about the product.** Three findings of the code book are High because they leave money with the wrong party without any cooperation: a buyer can take a sale down after the key is out and keep a working code (B7-C1), a seller can be paid for a code that was never delivered (B7-C2), and two codes can be bought with one voucher (B7-C3). Two findings of the proxy are High: a member who is not the owner of the broker can offer a grant that is served with the owner's key (B7-P1), and two paid first requests of an OpenRouter rent make a key that lives on after the rent (B7-P2). None of them is on the list of batch 6 or of the earlier reviews. All of them are in code that has tests that pass; the tests did not try these cases.

## Summary
| # | Level | Where | Finding |
| --- | --- | --- | --- |
| B7-C1 | **High** | `purchases.ts:659-687` (takedown) | Any active member, the buyer included, can take down a listing after `key_released`. The purchase is cancelled and the voucher never moves. The buyer keeps a working code and the seller is not paid |
| B7-C2 | **High** | `purchases.ts:536-562`, `580`, `625-647` | The key is released without looking at the ciphertext. If the source serves other bytes or is gone, the buyer cannot prove anything. A complaint holds no money. The seller is paid after 1 hour for nothing. This is a hole left by the B6-F1 fix |
| B7-C3 | **High** | `purchases.ts:485-489` | Held vouchers of one pair are not added up. A buyer gets N codes for the price of one (the contract drops the delta of the stale voucher) |
| B7-C4 | Medium | `purchases.ts:290-300`, `283`, `301-306` | The verdict belongs to the listing, not the purchase. The seller can spend the code after the check, or sell it a second time inside the 600 s window. "Check before release" does not hold against the seller |
| B7-C5 | Medium | `purchases.ts:45`, `410-412`, `493` | `refuted` is not in `ACTIVE`. After a refuted purchase the same listing and the same code are sold again |
| B7-C6 | Low | `purchases.ts:406-417` | `code_seen` is an oracle ("is this guessed code in an open or sold listing?"). It can be poisoned by anybody who knows the code. The issuer name inside the HMAC allows aliasing |
| B7-C7 | Low | `purchases.ts:406-425`, `main.ts:136` | `code_seen` is checked before the issuer call and written after it, so a race defeats it. The MAC is written before the verdict is validated. The key has no minimum length |
| B7-C8 | Low | `purchases.ts:418-426`, `code-issuers.ts` | Issuer adapter: no timeout, a wrong answer gives 500, errors are swallowed and never logged |
| B7-C9 | Low | `purchases.ts:559`, `384-388` | The 1 hour window starts at the seller's `at` (3000 to 4200 s in practice). The signed check notice is replayable for 10 minutes. It is not bound to the code or the salt |
| B7-C10 | Info | `main.ts:136-137`, `purchases.ts:631`, `reputation.ts:183-203` | Limits to write down: production registers no issuer, so the check and `code_seen` are dead code there. A sold listing stays `open`. How complaints behave |
| B7-P1 | High | `proxy/handler.ts:76-87`, `proxy/providers.ts:7-18` | The key is not tied to its owner: any member who offers a class C grant of a configured asset type is served with the broker owner's key and is paid for it |
| B7-P2 | High | `provider/manager.ts:178,223,238`, `openrouter-subkey.ts:80` | Two paid first requests at the same time make two OpenRouter keys; both go to the lessee, only one is remembered, so the other lives on after the rent |
| B7-P3 | Medium | `proxy/handler.ts:172-173` | A provider answer of `204` or `205` throws inside the handler after the call was counted: no settle, a `500`, and the same voucher can be used again |
| B7-P4 | Medium | `proxy/handler.ts:139,172`, `middleware.ts:263-271` | The provider call and the quota slot happen before `/settle`; when settle fails the call was made for free and is still counted, and `usage` says it was billed |
| B7-P5 | Medium | `server.ts:134-147` | An unauthenticated request line `TRACE`, or a `Host` such as `a b`, `[` or `a@x`, makes `new Request` throw outside the `try`: an unhandled rejection that stops the broker |
| B7-P6 | Medium | `proxy/handler.ts:123`, `server.ts:140,149`, `handler.ts:43-61` | The body of an unpaid call is read whole before any payment check (300 MB sent, 1.08 GB of RSS); the proxy and usage routes have no rate limit; `usage` needs no authentication |
| B7-P7 | Medium | `openrouter-subkey.ts:73-87`, `middleware.ts:263-271` | The sub-key is shown only in the response of the paid request; if that response is replaced (settle failed) or lost, the lessee never gets it and a renewal returns `key: null` |
| B7-P8 | Low | `proxy/providers.ts:101-108`, `handler.ts:170,173` | Redaction replaces the exact string in the body only: an encoded echo, an echo in `content-type`, or a compressed body passes; a body with binary bytes is corrupted when it matches |
| B7-P9 | Low | `proxy/providers.ts:129-132,141`, `broker.ts:66-68` | `mock: true` is a label the operator writes: `hosted` starts with a real URL and a real key under that label; nothing checks the target |
| B7-P10 | Low | `openrouter-subkey.ts:80`, `routes.ts:64`, `broker.ts:36,85` | The limit is per reset, not per paid day; `lastError` is shown unredacted in an open view; the adapter cannot be switched on from `main.ts` |

## B7-C1 (High): a takedown after the key is out leaves the buyer with the code and the seller unpaid
Code: `POST …/listings/{hash}/takedown` (`purchases.ts:659-687`) takes the claimant to be "the active member whose voucher key signed" (`671-673`). The only refusal is for the seller (`674`). `claim` is any text and `evidence_hash` may be empty (`666-667`). The route then cancels the listing and every purchase in `paid_held`, `cipher_posted`, `key_released` or `disputed` (`680`). A cancelled purchase never shows its voucher (`releasable`, `220`). The buyer is a member, so he qualifies.
Test (run, `Q1a`): the seller lists, the buyer buys, the seller posts, checks and releases the key (201). The buyer, who can now open the code, signs `{circle, listing_hash, claim:"x", evidence_hash:""}` with his own key. Result: `201 {claimant: buyer, cancelledPurchases: 1}`, purchase `cancelled`, no `voucher`, and still no voucher 3 hours later.
Impact: a code is used once, so the buyer redeems it and takes the sale down. He pays nothing and needs no cooperation. `docs/code-book.md` says the 1 hour window and the held voucher are the protection of the seller, and the complaint rule was chosen so that "a buyer who holds a working code could not keep it unpaid". Takedown reopens exactly that gap. The same route exists for files (BE-056), but a code works only once, so the loss is total.
Fix: for `kind = 'code'` a takedown must not cancel a `key_released` purchase. Alternatives: refuse a claimant who is the buyer of an open purchase of that listing, or require `evidence_hash` plus a vote of the DAO or the operator before cancelling anything that has `released_at`. A claim of identity or copyright can wait for the end of the window. Owner: Main C.

## B7-C2 (High): the seller is paid when the buyer never got the ciphertext
Code: `cipher_posted` only sends a HEAD request to the source (`checkAvailable`, `312-315`, called at `580`). `key_released` (`536-562`) compares the hashes written in the signed release with the purchase, but it never downloads the ciphertext. The B6-F1 fix turned `other` into a complaint with no hold (`625-634`). A dispute `content_mismatch` needs a proof, and the backend rebuilds the proof from the live source (`withCiphertext`, `322-343`). If the source serves other bytes the answer is 400 `proof_invalid` (`343`). If it is gone the answer is 409 `purchase_bad_state` (`339`).
Test (run, `Q1c`): after `cipher_posted` the source is changed to serve 7-filled bytes of the same length. The check and the release go through (201). The buyer sends `content_mismatch` with the signed release and his real box key and gets `400 proof_invalid`. After the source is deleted he gets `409 purchase_bad_state`. `other` gives `201 complaint:true`, the status stays `key_released`, and after 61 minutes the purchase is `confirmed` with the voucher shown to the seller.
Impact: a seller with no code at all, or one who never serves the file to the buyer (for example by IP), is paid up to 100 credit per sale. The buyer's only recourse is a counted complaint. Before B6-F1 this case froze the voucher through `other`. The fix for the opposite case, where a buyer keeps a code unpaid, removed this protection.
Fix: for a code, a ciphertext that the source does not serve with the signed `cipher_hash` and `cipher_size` at dispute time is proof of non-delivery, because the seller signed those two fields. A `content_mismatch` or `other` complaint in that case should end in `disputed`, and the backend can decide it itself because it already does the download. Also download and verify the ciphertext once at `key_released` for codes. A code is at most 1120 bytes, so this is cheap. Owner: Main C.

## B7-C3 (High): two code purchases from one seller can be paid with one voucher
Code: the purchase compares the voucher only with `obligations` (`485-489`), never with the held vouchers of the same pair that are not yet registered. `voucher.rs:164-173` requires `seq` to increase and computes `delta = cumulative - pair.cumulative`. A second voucher with the same `cumulativeAmount` has delta 0.
Test (run, `Q1d`): the buyer buys two different code listings of the same seller with voucher `seq 1, cumulative 10 credit` and voucher `seq 2, cumulative 10 credit`. Both are accepted: `[201, 201]`.
Test (read, not run): once the seller registers the `seq 2` voucher, the contract rejects `seq 1` with `ERR_SEQ_NOT_INCREASING`. The seller gets 10 credit for two codes. The attacker is the buyer alone. The case also exists for BE-056 licenses, but a code is consumed at once, so the buyer cannot be made to give it back.
Fix: at purchase, compute the baseline as `max(registered cumulative, cumulative of the held vouchers of the same payer, payee and epoch)`. Require `seq` above the highest held `seq` and `cumulative >= baseline + price`. Optionally refuse a second open purchase of the same pair until the first is closed. Owner: Main C.

## B7-C4 (Medium): the verdict is bound to the listing, not to the purchase, and the seller can spend the code after the check
Code: `code_checks` has the key `(circle_id, listing_hash)` and holds one row. `assertCodeGood` (`290-300`) accepts any `valid` row younger than `checkTtlMs` (600 s, `283`). The check route does not ask who holds the key. `cancelCodeSale` (`301-306`) acts only on `paid_held` and `cipher_posted`. Only the seller can run the check (`388`).
Test (run, `Q1b`): check says `valid`, the seller spends the code at the issuer, the release is still 201. The buyer's `other` becomes `complaint:true`, and 61 minutes later the seller is paid.
Test (run, `Q3b`): purchase 1 reaches `key_released`, the seller cancels it (allowed from `key_released`, `610`), and the code is spent. Buyer 2 buys the same listing and the release is 201 with no new check, although the issuer now says `used`.
Impact: the check protects a buyer against a seller who was careless, not one who is dishonest or has an accomplice. An accomplice who holds the key can redeem the code and let the seller cancel. The next buyer then pays for a spent code inside the TTL. The guarantee in the doc ("`code_used`, the purchase is cancelled and nothing moves") holds only until the verdict is 10 minutes old.
Fix: (a) say it plainly in `code-book.md`; (b) shorten the TTL to one minute or less; (c) bind the check notice to the purchase (`purchase_id` in the notice, one verdict per purchase), so the cancel-and-resell route needs a second check; (d) also cancel `key_released` purchases when a later check says `used` and the key is under 1 hour old, otherwise nothing follows from a `used` verdict after the release. Owner: Main C.

## B7-C5 (Medium): a refuted code is sold again
Code: `ACTIVE = ('paid_held','cipher_posted','key_released','confirmed')` (`45`) is used for the one-purchase-per-commitment clash (`491-496`) and for `code_seen` (`412`). `refuted` (the seller is paid, `220`) is missing from it. A refuted purchase does not close the listing.
Test (run, `Q1e`): the buyer disputes `content_mismatch` with a real box key for a correct file. The result is `201 refuted`. A second buyer then buys the same listing and gets `201 paid_held`.
Impact: the first sale is paid, and the same listing and the same code can be sold again. A seller with an accomplice can arrange it: the accomplice sends a bad proof, gets `refuted`, holds the code, and the seller sells again, with the verdict from B7-C4 reused inside the TTL. An honest buyer who clicks "dispute" by mistake opens the same hole.
Fix: add `refuted` to the exclusive set (a separate list for the clash, since `ACTIVE` also feeds `GET exclusive-licenses`), or close the listing (`status = 'matched'`) when a code purchase is `confirmed` or `refuted`. Owner: Main C.

## B7-C6 (Low): `code_seen` is an oracle and can be poisoned
Code: the duplicate query (`410-414`) runs before the issuer call and answers `409 code_duplicate` with `otherListing`.
Test (run, `Q2a`): the victim lists a code and checks it. The attacker (another member) lists a commitment to her guess. A right guess gives `409 code_duplicate {otherListing: <victim's hash>}` with 0 issuer calls. A wrong guess gives 200 `unknown` after 1 issuer call. So the attacker learns that a guessed code sits in an open or sold listing. A cheap guess costs one listing, one check and one cancel, within the write limit of the account.
Poisoning: an attacker who knows the code checks her own listing first. The honest owner then gets `409 code_duplicate` as long as hers is open or sold (`poisoner check first` → `honest owner` 409).
Alias: the HMAC covers `issuer || code`. With two issuer names that map to the same adapter, the same code under the second name is not a duplicate (200 `valid`).
Impact: the oracle gives nothing the issuer would not give directly, except that it hides the attacker behind the operator's credentials. The code must be known or guessed. The route is also a rate-free proxy to the issuer for any member's guess. So Low.
Fix: a limit on checks per account and per hour. In the duplicate answer, drop `otherListing`, or answer the same way as a normal conflict. Compute the MAC over the code only, or over a canonical issuer id of the adapter and not its registered name. Owner: Main C.

## B7-C7 (Low): `code_seen` races, orders its writes wrongly, and takes any key
Code: the duplicate check (`407-417`) is separate from the MAC write (`424`), with the `await` of the issuer between them (`420`). The MAC is written before the verdict is stored (`425`). `main.ts:136` only warns when the key is empty.
Test (run, `Q2b`): two listings with the same code, a slow issuer (150 ms), and `Promise.all` of both checks. Both answer 200 `valid`, and `code_seen` holds 2 rows. The duplicate is not detected, and a scripted seller can do this every time.
Test (run, `Q5b`): the adapter returns `"VALID"`, `undefined`, `{v:1}`, `"maybe"` or `null`. Each gives 500 `internal_error`. After each of them `code_seen` has 1 row and `code_checks` has 0 rows, so the listing is marked "seen" with no verdict.
Test (run, `Q2c`): the key `"a"` is accepted, and the stored MAC equals `HMAC-SHA256("a", "acme\0" + code)`. Someone who gets the table can find the key from his own purchase (he knows the code and the listing hash). With a 1-character or short key this takes seconds, and he then tries the whole low-entropy dictionary against the table.
Fix: reserve the MAC with `INSERT` and a unique index on `(circle_id, mac)` for live listings before the issuer call, in a transaction, and drop it on failure. Validate the answer against the three words before any write. Refuse a key under 32 bytes at start. Owner: Main C.

## B7-C8 (Low): the issuer adapter has no timeout and its errors are lost
Code: `await issuer.checkCode(code)` (`420`) has no timeout. A thrown error becomes 503 with no log (`421-423`).
Test (run, `Q5a`): an adapter whose promise never resolves leaves the request pending for more than 5 s with no end in sight. The handler holds no database lock. Each hung request holds a socket and an issuer slot, and the same seller can send many.
Test (run, `Q5b`): a synchronous throw with the code in its message gives 503 `code_issuer_unavailable`, and the body does not contain the code (good). Nothing is logged, so the operator cannot see which issuer failed.
Impact: no secret leaks. The risks are hung requests and a blind operator. A concurrent check of one listing is harmless (the upsert on `(circle_id, listing_hash)` keeps one row).
Fix: `Promise.race` with a timeout (10 s), a limit of in-flight checks per issuer, and a log line `issuer error` with the issuer name only, never the message. Owner: Main C.

## B7-C9 (Low): the window starts at the seller's `at`, and the check notice replays
Code: `dispute_until = at + codeWindow` with `at = r.at` from the seller (`559`), accepted within ±600 s of the server clock. The check notice (`384-388`) has no nonce and does not sign the code or the salt. Nothing records it, unlike `purchase_notices`.
Test (run, `Q3`): a release with `at = now - 600` gives `disputeUntil - now = 3000`, so the seller can cut the window by 10 minutes. The same signed check body sent 5 minutes later gives 200 again. At 11 minutes it gives 400.
Impact: a buyer who tests the code at minute 55 is already confirmed. A replay needs the code, the salt and the notice, so only the operator or a proxy in the path can do it. It refreshes a fresh `valid` verdict and changes nothing else.
Fix: `dispute_until = now_s + window` from the server clock. Put the hash of the body (code and salt hashed) in the check notice, or add a nonce and record it. Owner: Main C.

## B7-C10 (Info): limits to write down
1. `main.ts:137` passes `codeSeenKey` but no `codeIssuers`. In the shipped binary every listing with `verifiable: true` is refused with `code_issuer_unknown` (`172`). So the check route, `code_seen`, `code_used` and `code_not_checked` only run in tests and in the agents fixture. Real codes are `verifiable: false`, at most 20 credit, with no release check at all. B7-C2 is then the full protection. Say so in `code-book.md`, and do not log the warning at `main.ts:136` as if a detector existed.
2. The listing stays `open` after a confirmed code sale. `GET /listings?status=open` still lists it (run, `Q6`), and a second buyer gets `exclusive_taken`. Close it with the sale.
3. Complaints: one per purchase (`already_exists`), a proof with `other` is 400 (`TC-BE-069-14`). `complaints.counterparties` counts distinct buyers who have paid somebody (`reputation.ts:184-186`). Farming therefore needs one member account per count, and each sybil pays the full price to the seller. A seller cannot delete a complaint. He can shorten the window (B7-C9) or take B7-C2. Completed code sales (`codeSales`) count every distinct confirmed buyer, with no "has paid somebody" test, so a seller with sybil members can inflate completions at the cost of the prices.
4. `identity_bound` is a flag the seller states himself and is not in `code_doc`, so a seller can lie about it. This is known from the design.
5. A seller can set `verifiable: false` for a code whose issuer exists, to skip the check, up to 20 credit. The buyer sees the flag in the listing.

## B7-P1 (High): the key has no owner
`createProxyHandler` reads the grant (`handler.ts:78`), takes the provider by `grant.asset_type` (`:86`), and then checks only the scope, the quota, the payer (`:127`) and the secret variable. `ProviderConfig` has no field that says whose key it is (`providers.ts:7-18`). `grant.grantor` and `grant.operator` are never compared with anything. `payTo` is `grant.grantor` (`:119`). The contract lets any member offer a grant with `operator: null` (`contracts/x207-circle/src/grant.rs:98,379`; `stateful_tests.rs:291` does it).

Test (run): `proxy.test.ts`, "a grant by any other member". A grant with `grantor: mallory.x207-circle.near` and `operator: null` for the configured asset type gets `200` from the proxy. The provider receives `Bearer <the broker's key>`, and the 402 asks for `payTo: mallory.x207-circle.near`.

Impact: any circle member M can offer a class C grant of an asset type that a broker serves, and a second account of M (or any friend) accepts it. Every call is then made with the key of the broker's owner and paid to M. Between two accounts of the same person the credit nets to zero, so the key is used for free. It needs no cooperation from the owner. Class B may have the same shape: `Dispatcher.open` has no owner check either (`dispatcher.ts:46-53`). That was not looked at.

Fix: add `grantor` (the account that owns this key) to `ProviderConfig` / `BROKER_PROVIDERS`. Refuse with `403 grant_not_served` before the 402 unless `grant.grantor === provider.grantor` and `grant.operator === brokerAccount`. Do the same check for class B and for the P2 adapters. Owner: Main C (broker). Main A2 may add a contract rule so that a class C offer must name the broker as operator.

## B7-P2 (High): parallel first requests make a permanent orphan key
`grantAccess` reads `existing` (`manager.ts:178`), awaits `adapter.grant` (`:223`) and saves at the end (`:238`). The OpenRouter adapter has no challenge, so `#proving` does not apply. Each request with its own voucher passes `guardVoucher` and calls `POST /keys` (`openrouter-subkey.ts:80`). Each paid response carries its own key. The second `#save` replaces the handle, and `revoke` deletes the handle that is stored. B4-F10 named this race as "costs the lessee two days". For a key that spends the grantor's USD, it is a leak.

Test (run): `or.test.ts`, "two parallel paid first requests". `Promise.all` of two `grantAccess` gives the lessee `sk-or-v1-LESSEE-hash…01` and `…02`. The stored handle is `or:1:hash…02`. After `revokeAccess` the calls are `POST, POST, DELETE hash…02`, and key `hash…01` is still alive at the provider.

Impact: the lessee pays N vouchers and holds N-1 keys that nobody deletes. Each key has its `limit` per reset (up to `maxLimitUsd`, default 50) with no end date, until the grantor finds it in the OpenRouter dashboard. The gain is unbounded when the rent in credit is less than the limit in USD. The lessee needs no cooperation.

Fix: serialise `grantAccess` per grant (a `#granting` set like `#proving`; the second request gets `access_conflict`). In the adapter, write the handle to the store before the key is shown, or keep a table `provider_keys (grant_id, hash)` with a row for every key made, so `revoke` deletes all of them. Owner: Main C.

## B7-P3 (Medium): a `204` is counted and never settled
After the call the handler counts it (`:172`, or the quota slot was taken at `:139`) and then builds `new Response(text, { status: upstream.status })` (`:173`). For `204` and `205` the constructor throws on a non-null body (`ArrayBuffer`). The exception passes the middleware (it is not `FacilitatorUnavailable`, `middleware.ts:276-278`), so `/settle` is never called. In `serve()` it becomes `500 internal`. `release()` is not called.

Test (run): `proxy.test.ts`, "204 from the provider". Two calls with the same voucher (`DELETE`, no quota): both give `TypeError: Response constructor: Invalid response status code 204`, the provider was called 2 times, settles 0, counted 2. `GET /usage` answers `calls: 2, billed: "40000"` although nothing was paid. With quota 2: `[599, 599, 429]` (599 is my marker for a thrown error), counted 2, settles 0.

Impact: a scope with a method that the provider answers `204` (a `DELETE`, many `PUT`s) gives the lessee free calls at the grantor's cost. The voucher is not settled, so it can be sent again, and without a quota this has no limit. The README says "the count and the bill are the same number" (`README.md`, the bill-per-call bullet); it is not.

Fix: build the response with `body: null` for 204/205 (and for `HEAD`), and wrap the construction so that any throw calls `release()` and answers `502`. Count the call only after the response object exists. Owner: Main C.

## B7-P4 (Medium): the call is made before the money moves
By design the provider is called after `/verify` and before `/settle` (`middleware.ts:263`). The slot is taken at `handler.ts:139` or `:172`. A failed settle returns `paymentRequiredResponse` (`middleware.ts:271`), and the handler never learns of it. `release` is not called.

Test (run): `proxy.test.ts`, "settle fails after the provider call". The facilitator answers `/settle` `{success:false, errorReason:"insufficient_credit"}`: the lessee gets `402`, the provider was called once, counted 1, `usage` shows `calls: 1, billed: "20000"`. A second try: `402`, then `429` (quota 2 used up). With `/settle` answering `503`: the status is `503`, provider called 1, counted 1.

Impact: the lessee does not need to be honest at settle time. For example, a voucher that passes `/verify`, while another voucher of the same payer to another payee settles first and uses up the limit. The call has then been made with the grantor's key, the lessee never sees the answer, and nothing is paid. The grantor's `usage` shows a bill that was never paid. The buyer's `BuyerMeter` (`recordCalls` only on a received answer) shows 0, so the SD-068 comparison fails for the wrong reason.

Fix: wrap `middleware(...)` and, when the final status is `>= 400` after the provider answered below 300, call `release()` and write an audit entry `unbilled_call`. For side-effect calls, hold the credit before the call (reserve at `/verify`) if the facilitator offers it. Say in the README that a call can be made without being paid. Owner: Main C. Main B for the facilitator hold.

## B7-P5 (Medium): one request line stops the broker
`serve()` builds `new Request(\`http://${req.headers.host ?? "localhost"}${req.url}\`, …)` at `server.ts:139`. It is outside the `try` at `:143-147`, in an `async` callback of `createServer`. `main.ts` installs no `unhandledRejection` handler (grep: none in `src`), so the default of Node is to end the process.

Test (run): `server.test.ts`, "odd request lines and hosts", on a real socket. `TRACE /health` gives the rejection `'TRACE' HTTP method is unsupported`. `Host: a b` gives `Failed to parse URL from http://a b/health`. `Host: [` gives `Failed to parse URL from http://[/health`. `Host: a@evil.test` gives `Request cannot be constructed from a URL that includes credentials`. In each case the socket gets no answer. A normal `GET /health` is `200`. The test process only logs the rejection; "stops the broker" is the Node default. The standalone process was not run (Node 26 here cannot run the TypeScript sources with parameter properties without a loader).

Impact: one unauthenticated packet takes the broker down. The class B revoke (`deleteLeaseKey`) and the provider revoke queue need the broker alive, so a restart loop delays the removal of keys after the paid day. This is in `server.ts` and so hits every route, not only the proxy.

Fix: move `new Request` into the `try` (answer `400`), and add `process.on("unhandledRejection")` that logs and keeps running. Use a fixed base URL (`http://localhost`) and take only the path from `req.url`. Owner: Main C.

## B7-P6 (Medium): the unpaid caller costs memory and chain reads
`const body = … await request.clone().arrayBuffer()` (`handler.ts:123`) runs before the 402 and before `/verify`. Together with `Readable.toWeb(req)` (`server.ts:140`) and `res.end(Buffer.from(await response.arrayBuffer()))` (`:149`), a body of any size is read whole. The only check before it is that the grant is active, class C, and the method and path are in the public scope. The size limit `maxBodyBytes` exists only for the access routes. The proxy and usage routes have no rate limit (`provider/routes.ts:70-86` applies it only to `/access`). Every unpaid proxy or usage request costs `getGrant` and `nowMs` on the chain (`dispatcher.ts:47,51`), plus `currentEpoch` for the proxy. `guardVoucher` (`in-flight.ts:21-27`) runs before `/verify`, so a forged header with the public tuple `payer:payee:epoch:seq` of a real voucher holds the id for the length of the request and can give that voucher a `409` (read, not run).

Test (run): `server.test.ts`, "unauthenticated proxy request with a big body". A raw socket sends a `POST /grants/1/proxy/v1/echo/x` with 300 MB and no voucher. The answer `402` comes only after the whole body; RSS of the process grew by 1081 MB.

Impact: unauthenticated memory exhaustion of the broker, and a free amplifier on the NEAR RPC. `GET /grants/{id}/usage` answers anyone, for any class C grant id (ids are sequential), with the calls per epoch of the lessee (tested: `200` with no header). That is a small privacy leak and a free probe.

Fix: cap the body (`content-length` and a counting stream, same `readCapped` as the access routes) and read it after the payment passes; add the per-IP and per-grant window counters to the proxy and usage routes; cap the response (`upstream.body` read with a limit, `502 provider_response_too_large`); decide whether `usage` needs a signed notice of the lessee or the grantor like `/access/stop`. Owner: Main C.

## B7-P7 (Medium): the sub-key is shown once and can be lost
The key is in the answer of the paid `POST …/access` only (`routes.ts:200`, `openrouter-subkey.ts:83-86`). It is not stored. The access row is saved first (`manager.ts:238`), and the settle comes after the handler. Three ways to lose it:
1. Settle fails: the response is replaced by `402` (`middleware.ts:271`).
2. The response is lost on the network after the settle.
3. The broker stops between `POST /keys` and `#save` (crash window): no row exists, and nothing can delete the key.

Test (run): `or-route.test.ts`, the real access route with a mock OpenRouter and a facilitator whose settle fails. The first request gives `402` with no key in the body, one key is alive at the provider, and the access is saved as `active`. The next paid request (settle ok) gives `200` with `delivery.key = null` and the note "the key was shown on the first day; ask the grantor for a new access". The lessee has paid and holds nothing. The crash case: `or.test.ts`, "crash / save failure": the db closed during the `POST`. `grantAccess` fails, the key is alive, and there was no `DELETE`.

Impact: the lessee pays a day for nothing, or the grantor's key is alive with no owner and no record (see P2 for the same effect with a lessee behind it). The key is deleted at the end of the paid day if the row was saved, so case 1 and 2 are bounded to that day; case 3 is not bounded.

Fix: save the row with `status: pending_key` before the `POST`, write the hash right after it, and let `sweep` delete any key that has no row (list `GET /keys` by the name prefix `x207-`). Keep the key encrypted until the first successful delivery so a retry with a new voucher can return it, or delete and remake when no delivery was confirmed. Owner: Main C.

## B7-P8 (Low): redaction is the exact string in the body only
`redact` replaces `secret` in the decoded body bytes (`providers.ts:101-108`). The status and the headers of the answer are rebuilt from `content-type` only (`handler.ts:170,173`), and that header is not redacted.

Test (run): `proxy.test.ts`, "Q1".
- A provider that echoes the key percent-encoded, base64, hex, lower-cased, reversed or split in two JSON strings passes the redaction (`true` for each); only the exact string is removed.
- The exact key in the upstream `content-type` header reaches the lessee.
- `Set-Cookie`, `Location` (a `302` becomes a JSON `502`) and the status text do not reach the lessee.
- A `500` body with `Bearer <key>` comes back as `Bearer [redacted]`.
- A body with invalid UTF-8 bytes that also holds the key is rewritten through `toString("utf8")`: `ff fe 00 80` became `ef bf bd …`, so the binary is corrupted.

Not run: the lessee can send `accept-encoding` (it is forwarded, `handler.ts:136`). If a provider that echoes headers answers with an encoding that `fetch` does not decode, the redaction looks at compressed bytes. The README does not claim more than the exact string, and a real provider such as OpenRouter or OpenAI does not echo `Authorization`.

Impact: only a provider that reflects request headers is affected. The "BK-010 scan" is a test for the exact string only.

Fix: drop `accept-encoding` from the forwarded headers, redact `content-type`, build the redaction on common encodings of the secret (percent, base64, hex, JSON-escaped), and do not rewrite a body through UTF-8 (replace on the bytes). State in the README that the redaction is a net for plain echoes. Owner: Main C.

## B7-P9 (Low): `hosted` trusts a label
`hostedForbidden` keeps a provider unless `p.mock === true` (`providers.ts:129-132`), and `providersFromEnv` takes `mock` from the same JSON as `secret_env` (`:141`). `startBroker` throws only for entries without the flag (`broker.ts:66-68`).

Test (run): `proxy.test.ts`, "mock flag is only a claim". `{asset_type:"openai:chat", base_url:"https://api.openai.com", secret_env:"OPENAI_API_KEY", mock:true}` gives `hostedForbidden("hosted", …) = []`. An entry without `mock` gives its asset type, and a call through it answers `501 secret_hosted_forbidden` before anything is paid (tested: `hosted non-mock call: 501`). There is no way to add a provider at runtime: `ProviderRegistry` has only `get`, `version`, `authHeader`, `redact` and `rotate`. `rotate` can switch `secretEnv` to any variable name, but not `mock` or `baseUrl`. For P2 adapters, `register` refuses `real = true`, a flag the adapter sets itself.

Impact: the refusal protects against a forgotten flag, not against a real key under the demo label. There is no upload path for secrets, so the risk is an operator error.

Fix: in `hosted`, require that `base_url` is a loopback/`.test` host and that the secret value has a fixed prefix such as `mock-`; refuse `rotate` to a variable that is not on a list. Owner: Main C.

## B7-P10 (Low, with Info items): OpenRouter details
- The limit is per reset, not per paid day (read from the code, not run against OpenRouter). The `POST` has only `name`, `limit`, `limit_reset` (`openrouter-subkey.ts:80`). With `daily` the limit resets at the provider's day boundary (UTC midnight, as OpenRouter documents it; not checked here), and the key lives 24 h from the payment. A rent paid at 23:00 UTC can spend up to 2 times `limit`. With `weekly` or `monthly` the whole limit can go in the one paid day. The README says the limit is "the most the lessee can spend per period", which is true; the "USD of the day" reading is not.
- `lastError` holds the first 160 characters of the provider's error text (`http.ts:25`, `manager.ts:294`). It is returned unredacted in the open view `GET /grants/{id}/access` (`routes.ts:64`, "No authentication"). Test (run): a `DELETE` answering `500 … Bearer sk-or-v1-MANAGEMENT…` gives that text in `lastError`; only `redactString` (the log layer) would turn it into `Bearer [redacted]`. The same text goes to the lessee in `provider_grant_failed`. A real OpenRouter does not echo the key, so this is hardening.
- The `DELETE` path is sound: a failure gives `revoke_pending`, `nextRetryMs` +30 s, and `sweep` tries again (tested: attempts 1 then 2 after 31 s, doubling up to 1 h). It is a table in SQLite, so a restart keeps it, and `/metrics` has `x207_broker_revoke_queue{kind="provider"}`.
- Info: `OpenRouterSubkeyAdapter` is not wired. `broker.ts:36,85` takes `providerAdapters` from code, and `main.ts:6` passes none and reads no `OPENROUTER_*` variable (grep). The binary started with `npm start` cannot serve it. `settleDay` is called only from tests (`agents/test/rent.test.ts`), so the real cost is not billed in production. `baseUrl` of the adapter and `base_url` of the proxy have no SSRF check; they are operator config, and the adapter's `fetch` follows redirects (undici removes `Authorization` on a cross-origin redirect; not tested).
- Info: the lessee's headers are forwarded except the list at `handler.ts:35-40`. `x-api-key`, `origin`, `x-amz-security-token` and `accept-encoding` pass (tested). A provider that prefers another key header over the broker's could be given the lessee's own key; that is not harmful to the grantor. The query string is forwarded unchecked (`?y=/../../admin` stays a query).

Fix: pass an end to the provider if it has one, or document that `daily` straddles; redact `lastError` and the error text before they leave the manager; add the wiring (`OPENROUTER_MANAGEMENT_KEY`) and a call of `settleDay` in `tick`. Owner: Main C.

## Checked and found sound

### Code book
- Caps at the unit (run, `Q4`): `20000000` ok, `20000001` refused; verifiable `100000000` ok, `100000001` refused; `"0"`, `"010"`, `"1e2"`, `" 5"` and `2^128` give `code_bad_value`. The arbiter in any form (`""`, `false`, `0`, an account) gives `arbiter_not_supported`.
- `codeCheck` runs before `validateListing`. A null listing, `offer: null`, a numeric `offer.value`, a numeric account and a detail object all give a 400 with no 500. The value of the code document comes from `offer.value`, and the price from the same field.
- `verifiable` cannot be flipped after listing: it is inside `code_doc`, which is bound by the hash. The check route reads the detail of the stored listing.
- The plain code and the salt are in no table (existing `TC-BE-069-01`), no answer, and no log. With an adapter that returns `"VALID"` the 500 path logs a stack with only `CHECK constraint failed: verdict IN (...)` (run, `Q2d`). The route logger prints the pattern, not the path or the body. A synchronous throw with the code in its message does not reach the body.
- The check route: only the seller (403 otherwise), a wrong signature (401), a wrong code or salt (400 `code_bad_commitment`), a short code (400), and a notice for another listing (400). The notice is bound to the listing and to the seller's key. A throwing issuer decides nothing.
- A `used` check cancels the purchase only while it is `paid_held` or `cipher_posted`, and the listing. A `used` verdict found at the release cancels first and then throws 409, and the cancel is committed (existing `TC-BE-069-03`). Auto-confirmation uses the server clock (`dispute_until < nowS` in `settlePurchases`), so a late dispute `at` cannot pass.
- The size rule 40..1056 and `cipher_size <= content_size + 64` is enforced at `552` (existing `TC-BE-069-13`).
- The issuer receives only the code of the seller's own listing, because the commitment must match. A competitor's code reaches it only if the seller already knows that code. The 14 existing tests of `codes.test.ts` pass (run).

### Secret proxy and OpenRouter adapter
- **Path and scope.** `URL` folds `..`, `.` and `\` before the scope check, and the same normalised path is the one forwarded (`:150`). Run: `/v1/echo/../admin`, `%2e%2e`, `%2E%2E%2F`, `..%5c`, `%00`, a bad percent escape, `//v1/echo/x` and `.%2e` all give `403` and no provider call. `/v1/echo/;/../admin` and `/v1/echo/\..\admin` fold to `/v1/echo/admin`, inside the prefix. `%252e%252e` (double-encoded), `%0d%0a`, `@evil.test` and `//` stay inside the path and reach `provider.test` only. `#frag` is cut. The upstream host cannot be chosen: the path always starts with `/` and follows a fixed base URL.
- **Absolute-URI and Host.** `GET http://evil.test/grants/1/usage` gives `404`, `GET @evil.test/…` gives `400` (Node). `Host` is not used for routing; it matters only through P5.
- **Methods.** Upper-cased and compared with the scope list; a method outside it is `403` with no 402.
- **Headers.** `authorization`, `cookie`, `host`, `x-forwarded-*`, `forwarded`, `via`, `x-real-ip`, `proxy-authorization`, the method-override headers and `payment-signature` do not reach the provider (tested). The key header is set last, after the lessee's headers, so it cannot be overridden by name.
- **Redirects.** `redirect: "manual"`, any `3xx` is a JSON `502 provider_redirect`, not counted, slot released, `Location` and `Set-Cookie` dropped (tested).
- **Failed calls are free.** `404`, `500`, `302`, a timeout (`timeoutMs: 150`) and a body stream that errors after 3 bytes: each gives no settle and counted 0, and the slot is given back.
- **Quota race.** Five parallel calls with different vouchers and quota 2 give `[200, 200, 429, 429, 429]`, 2 provider calls, counted 2 (`reserveCall` is one statement). Three parallel calls with one voucher give `[200, 409, 409]` and one provider call (`guardVoucher`).
- **Audit and metrics.** Audit entries hold `kind, grantId, assetType, method, path, status, secretVersion` (a counter, not derived from the key); the query string is not logged; `/metrics` and `usage` have no key. `log.ts` redacts the key shapes (`Bearer`, `sk-`, `ed25519:`) in log lines. `secret_not_configured` names the variable, never a value.
- **Hosted refusal.** Run: a non-mock provider in `hosted` answers `501 secret_hosted_forbidden` before 402, verify or settle; `startBroker` refuses to start with one.
- **OpenRouter.** The management key is only in the `authorization` header of `#headers()`; delivery holds the new key only; the key goes to the payer who is the grantee (`routes.ts:197`); the handle is `or:<grant>:<hash>`, so a restart loses nothing for a saved row; `call` has a 10 s timeout that also covers the body; `grantee_ref` and `limit` are validated by regular expressions and `maxLimitUsd`.

## Not checked

### Code book
- The real settlement of a voucher at the contract (B7-C3 is "read").
- The frontend and agent side (Main B); the SDK `verifyCodeDelivery` beyond what I read.
- The legal side of `identity_bound`, rate limits of the write routes under load, and the effect of `X207_CODE_SEEN_KEY` rotation (all old MACs stop matching, silently).
- Behaviour with a real issuer adapter (none exists in the repo).
- Multi-circle behaviour of `code_seen` beyond the key `(circle_id, mac)`.

### Secret proxy and OpenRouter adapter
The real OpenRouter Management API (its daily reset time, whether `DELETE` of a disabled key answers `404`, the shape of its errors); the real facilitator (whether `/verify` and `/settle` can disagree for the same voucher, which decides how likely P4 is); a compressed echo with `accept-encoding` (P8); the forged-header hold of `guardVoucher` (P6, read only); the epoch used for the quota (`chain.currentEpoch()`) against the epoch of the voucher near a boundary; class B (`keys/*`, `revoker.ts`, `chain.ts`) and the other P2 adapters; TLS and the OS resolver; real load. P5 was shown as an unhandled rejection in a test process, not as a dead standalone process.

## How the findings were produced
The throwaway tests (15 for the code book, four files for the proxy) are not in any repository: the review was read only. They import the backend, the broker and the SDK by absolute path and were kept in the scratchpad of the session of Main B; a reader who wants to repeat one asks Main B, or writes the same case from the "Test (run)" line of the finding, which says what was sent and what was answered. The existing test of the code book (`backend/test/marketplace/codes.test.ts`, 14 tests) passes at the same commit.

## For the owner of each fix
- **Main C (backend and broker):** B7-C1 to B7-C10 and B7-P1 to B7-P10. The order that follows the level: B7-C3, B7-C1, B7-C2, B7-P1, B7-P2, then the Medium ones.
- **Main A2 (contracts):** B7-P1 may also get a contract rule (a class C offer must name the broker as operator); B7-C3 rests on `voucher.rs` dropping the delta of a stale voucher, which is by design.
- **Main B:** B7-P4 only if the facilitator can hold credit at `/verify`. The SDK and the frontend need no change for these findings; the page of the code says what the book does today, and B7-C10 item 1 is a point for the documents of the submission (the shipped binary registers no issuer, so the check of a code runs only in tests).
