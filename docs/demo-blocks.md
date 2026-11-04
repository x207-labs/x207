# Demo blocks: pipelines and features, do X and see Y

_Moved from the README section 4. The content is unchanged; paths are relative to this folder. Start at the [README](../README.md)._

### Business and invoice blocks (tracks `business` and `realworld`)

Two more sandbox blocks run from the root; each starts its own `near-sandbox` node and takes about 80 seconds.

```bash
npm run demo:business     # procurement agent buys on credit inside the owner's limits
npm run demo:realworld    # three businesses, invoices as vouchers, F3 netting, F4 residual
```

| Do | See |
| --- | --- |
| `business`: the `gpu` agent buys `translate` (on the owner's list, price 0.02) | HTTP 200 and a signed voucher; spent this epoch 20000 |
| `business`: it asks for `summarize` (quoted 0.02 above the 0.01 limit) and `image` (not on the list) | Refused before payment: `price_above_service_limit`, `service_not_allowed`; no voucher signed |
| `business`: it keeps buying until the 0.06 epoch budget is spent, then asks once more | `over_epoch_budget`; the contract shows `gpu -> translator` 40000 and `gpu -> cleaner` 20000, no edge to `summarizer`: on-chain debt equals the approved purchases (3 approved, 3 refused in the run) |
| `realworld`: three businesses owe each other 100, 60 and 80 credit; each invoice becomes a voucher with `resource = x207:invoice:<sha256>` | Three vouchers; the invoice text stays off-chain, only its hash is signed |
| `realworld`: close the epoch, run the solver, commit | Contract obligation 240 credit equals the invoice total; cleared 180 credit (60 around the ring on three edges); residual edges `maker -> supplier` 40 and `retailer -> maker` 20 |
| `realworld`: read the F4 positions | Debtors owe 40 credit, creditors claim 40 credit; net cash is 40 of the 240 credit of invoices |

The run on 2026-11-02 asserts these numbers against the contract (`obligation`, `get_clearing_proposal`, `list_positions`, `net_position`), so the printed totals before and after netting are the contract's. No new contract is involved: invoices are ordinary cumulative vouchers and the existing clearing. The `business` limits are enforced by the agent before it signs anything; the contract enforces its own credit headroom independently. What these blocks do not show: real-world invoice disputes, tax or legal status of an invoice, and payment of the residual through 1Click.

### Invoice and installment block (pipeline P8)

```bash
npx vitest run agents/test/invoice-book.test.ts             # agents against the invoice book, in process, no sandbox
X207_SANDBOX=1 npx vitest run tests/invoice.sandbox.test.ts  # real contract, indexer, solver and keeper; several minutes
```

An invoice is a claim of an issuer on a debtor outside x207. When the debtor signs it as an ordinary voucher (`resource = x207:invoice:<sha256 of the document>`) it becomes an edge of the ledger and is cleared with everything else. An invoice can be paid in 1 to 24 installments, one per epoch; the debtor signs all of them at once, each as `seq` 1 of the pair in its own epoch (`sdk/docs/invoice.md`).

| Do | See |
| --- | --- |
| The issuer requests an invoice of 90 credit in three installments; the debtor checks the hash and the schedule against the plan of the SDK and approves | The book shows `approved` with epochs E+1, E+2, E+3, 30 credit each |
| The issuer registers the voucher of each installment in its own epoch | `voucher_registered` is read by the indexer; the installment is `registered`, and the invoice is `registered` after the third |
| Two more invoices of 30 credit close the ring in the first epoch (`maker -> supplier -> retailer -> maker`) | The ring is cleared: obligation 90, cleared 90, nothing left to pay |
| Installment 2 and 3 have no ring | No cycle: 30 credit goes through the residual path F4 in each epoch |
| An installment fails for lack of headroom (the contract answers `ERR_INSUFFICIENT_CREDIT`) | `scheduled` with reason `headroom`; the debtor shifts it once with a voucher signed **after** the failure; failing again is `missed` |
| The debtor registers a voucher with a higher `seq` first | `missed` with reason `blocked_by_debtor`; no catch-up |

There is no spare voucher signed in advance: the issuer could register it although the real installment was paid, and the debtor would pay twice. A signature in advance is evidence, not a guarantee of payment: the contract allows gaps in `seq`, so a debtor can block an installment. Reputation, the status `blocked_by_debtor` and the bond of CT-094 for a large invoice answer that (ADR-44). The invoice page of the frontend is `/invoice`.

### Service orders block (pipeline P6)

```bash
npx vitest run agents/test/services.test.ts                  # agents against the order book, in process, no sandbox
X207_SANDBOX=1 npx vitest run tests/orders.sandbox.test.ts    # real contract, indexer and keeper; several minutes
```

An order is the agreement of a buyer and a seller on work. On the chain there is only an ordinary cumulative voucher with `resource = x207:order:<sha256 of the document>`; the contract does not change (`sdk/docs/order.md`). A milestone is paid only after it is confirmed (or after the dispute window), and the buyer signs its voucher then, from the real state of the pair.

| Do | See |
| --- | --- |
| `research` orders an audit of two milestones (10 and 20 credit) from `audit`; both sign the document | The book shows the order `open` |
| Milestone 1 is delivered and confirmed; the buyer signs, the seller registers the voucher | `voucher_registered` is read by the indexer; the milestone is `paid`, the pair holds 10 credit |
| Milestone 2 is delivered and disputed (`not_as_described`) | No voucher is signed; the pair stays at 10 credit; a confirmation afterwards is refused |
| `research` hires `keeper` at 1 credit per `close_epoch` | The member `keeper` closes the epoch itself; the list `onchain-proofs` has that call and its signer |
| The buyer pays the proof | One voucher of 1 credit; the same proof presented again is `already_paid` |

Two more items run on the same flow (UM-108, catalog items 83 and 84):

```bash
X207_SANDBOX=1 npx vitest run tests/freelance.sandbox.test.ts tests/consultation-slot.sandbox.test.ts --no-file-parallelism   # about one minute each
```

| Do | See |
| --- | --- |
| **Freelance service (#83).** `client` hires `freelancer` in two milestones (30 and 20 credit). The freelancer hands over file 1 with its hash | The client hashes the file it received and compares: a copy changed on the way has another hash. Nothing moves before the client confirms |
| The client confirms milestone 1, signs, the freelancer registers | The pair holds 30 credit. Milestone 2 goes the same way and its voucher continues from the first: the pair holds 50 credit |
| **Consultation slot (#84).** A slot is an order with one milestone, due when the slot ends. The mentor hands over the record of the session, the learner confirms | The pair holds 8 credit |
| The mentor does not show at another slot: nothing is delivered | The learner cannot confirm; after the due date the learner cancels the open milestone; no voucher is signed. A slot that is not due yet cannot be cancelled |

**Product testing (#88, UM-111).** `X207_SANDBOX=1 npx vitest run tests/product-test.sandbox.test.ts` (about one minute). A maker orders a test report from `tester` (12 credit, one milestone). The terms are signed with the order (their hash is its `spec_hash`) and say that a paid report states in its first line that it is paid and by whom.

| Do | See |
| --- | --- |
| `tester` hands over a report whose first line is `Disclosure: paid test, commissioned by <maker>`; the maker checks the line, confirms, signs | The milestone is `paid`, the pair holds 12 credit |
| `shill` hands over a report that reads like an independent review and does not say it is paid; the maker checks it against the terms and disputes it (`not_as_described`) | No voucher is signed, the pair stays at 0, a confirmation afterwards is refused |

x207 does not police the web. What it does is refuse to pay for a report that breaks the terms both parties signed. The check of the first line is the maker's own, in the test (`meetsTerms`).

Two choices behind these rows. A slot uses the order kind `freelance`, because `ORDER_KINDS` has no kind for consultation and the milestone flow is the same. A no-show is not a dispute: the backend allows a dispute only from `delivered`, so the learner cancels the open milestone after its due date, which pays nothing.

A dispute leaves the state as it was: a cumulative voucher cannot skip a milestone, so the next voucher never carries a disputed one. What this block does not show: the judgement of a dispute, the check of the target of a load test, and orders of a kind other than `audit` and `keeper` (each has its own test in `agents/test/services.test.ts`).

### Content license block (pipeline P7)

```bash
npx vitest run agents/test/license.test.ts                     # agents against the purchase routes, in process, no sandbox
X207_SANDBOX=1 npx vitest run tests/licenses.sandbox.test.ts    # real contract and indexer; about one minute
```

x207 does not store the file. The seller encrypts it, puts the ciphertext at a source of its choice (`https` or `ipfs`), and sells a license: the buyer's voucher is held by the backend, the seller releases the file key sealed to the buyer's key, and the buyer opens the file and checks it against the `content_hash` of the listing before it confirms (`sdk/docs/license.md`). Files larger than one block use `https`.

| Do | See |
| --- | --- |
| `seller` lists a dataset; `buyer` buys it with a voucher of 50 credit | The purchase is `paid_held`; the answer has no voucher |
| The seller posts the ciphertext and releases the key | `key_released`; the backend never sees the key of the file |
| The buyer downloads, opens, checks the hash and confirms | `confirmed`; only now the voucher is in the answer, and the seller registers it: the pair holds 50 credit |
| `second` buys a file whose hash is not the one of the listing | The buyer's SDK makes the proof, the backend checks it by itself: the purchase is `disputed`, no voucher leaves, the pair holds 0 |

A seller who lies about the hash is caught by the buyer's own check, without a judge. What this block does not show: a source that serves other bytes than the ciphertext (the buyer's SDK refuses it and makes no proof), the 72-hour automatic confirmation, and the exclusive license with a bond (each has its own test in `agents/test/license.test.ts`).

### Codes and secrets block (pipeline P3, catalog items 27 and 87)

```bash
npx vitest run agents/test/code.test.ts agents/test/code.book.test.ts   # agents against the code book, in process, no sandbox
X207_SANDBOX=1 npx vitest run tests/codes.sandbox.test.ts                 # real contract and indexer; about one minute
```

A one-time code (a gift card code, a beta invitation code) is a secret that can be used only once. x207 sells it as a `secret_release`: the seller encrypts the code with a salt, the listing carries only the commitment `contentHash(salt || code)`, and the code is capped (20 credit when it cannot be checked, 100 credit when its issuer can check it; no bond or arbiter lifts the cap). The backend holds the buyer's voucher and asks the issuer before the key leaves the seller. In the test both issuers are mocks (`MockCodeIssuer`); a real issuer is an adapter registered by the operator.

| Do | See |
| --- | --- |
| `seller` lists a gift card code (item 27, issuer `shop.example`); `buyer` buys it with a voucher of 5 credit | `paid_held`; the answer has no voucher |
| The seller posts the ciphertext and releases the key | The backend asked the issuer once and the code was valid: `key_released` |
| The buyer opens the code, redeems it at the issuer and confirms | `confirmed`; only now the voucher is in the answer, and the seller registers it: the pair holds 5 credit |
| The same flow for a beta invitation code (item 87, another issuer), 3 credit | The voucher continues from the held one (`cumulative` 5 + 3): the pair holds 8 credit |
| The gift code is listed again with another salt and sold to `second` | The issuer says it is used: `code_used`, the purchase is `cancelled`, no key is released, no voucher leaves, the pair holds 0 |

The code, its salt and the key of the file are in no table of the read model and in no console line of the run; the test searches for them in both. What this block does not show: a real issuer (only the mock ran), a code that the issuer cannot check (it is sold on the seller's word, within the 20 credit cap), and a proxy secret per call, which is the class C broker block of `tests/broker-class-c.sandbox.test.ts`.

#### Software license keys and game keys (items 28 and 74, UM-100)

```bash
X207_SANDBOX=1 npx vitest run tests/codes-keys.sandbox.test.ts            # same pattern, about one minute
```

A license key (item 28, issuer `licenses.example`) and a game or activation key (item 74, issuer `games.example`) are sold once each as a `secret_release`, with the issuer asked before and after the handover.

| Do | See |
| --- | --- |
| `buyer` buys a license key (6 credit) | `paid_held`, no voucher in the answer, the pair holds 0 |
| The seller releases the key | The backend asked the issuer once and the key was valid; the issuer still says `valid` (the handover does not use the key) |
| The buyer activates the key at the issuer and confirms | The issuer now says `used`; only now the voucher is in the answer, the seller registers it, the pair holds 6 credit |
| The same flow for a game key (4 credit) | The voucher continues from the registered one: the pair holds 10 credit |
| A key that was activated before the sale is listed and sold to `second` | `code_used`: refused before the handover, `cancelled`, no key, no payment, the pair holds 0 |
| A key bound to an account or a region (`identity_bound`) is listed | `code_bound_to_identity` at the listing: nothing is in the book (such a key stays class X) |

Keys, salts and file keys are in no table of the read model and in no console line; the test searches for them. Not shown: a real issuer (a mock ran), and a publisher that forbids resale (the seller must check the terms of the publisher).

#### Promo codes and digital store gift cards (items 76 and 77, UM-101)

```bash
X207_SANDBOX=1 npx vitest run tests/codes-promo.sandbox.test.ts           # same pattern, about one minute
```

A store gift card (item 77, issuer `store.example`) has a face value and a balance at its issuer; a promo or voucher code (item 76, issuer `promo.example`) has an end date at its issuer. Both are sold once as a `secret_release`, and the issuer is asked before the key leaves the seller.

| Do | See |
| --- | --- |
| `buyer` buys a gift card with a balance of 5 credit for 4 credit | `paid_held`, no voucher in the answer, the pair holds 0 |
| The seller releases the key | The backend asked the issuer once and the balance covered the face value; the balance is not touched by the handover |
| The buyer spends the card at the store and confirms | The balance is now 0; only now the voucher is in the answer, the seller registers it, the pair holds 4 credit |
| A card whose balance went to 0 after it was listed is sold to `second` | `code_used`: refused before the handover, `cancelled`, no key, no payment, the pair holds 0 |
| `buyer` buys a promo code that is still good (3 credit) | The voucher continues from the registered one; after the buyer redeems it the pair holds 7 credit |
| A promo code whose end date passes between the purchase and the handover | `code_unknown`: the issuer does not know it any more; the key is not released, the purchase stays at `cipher_posted`, no voucher leaves, the pair holds 0 |

Codes, salts and file keys are in no table of the read model and in no console line; the test searches for them. Not shown: a real store or promo issuer (a mock ran), and a promo code that is bound to the account of its first holder (such a code is not sold: `code_bound_to_identity`, see the block above).

#### AI credit and map quota through the proxy (items 61 and 64, UM-109)

```bash
X207_SANDBOX=1 npx vitest run tests/proxy-credit-quota.sandbox.test.ts     # about two minutes
```

These two are not codes but a key that the grantor keeps: the class C proxy of the broker calls the provider with it, the lessee never sees it, and the meter is the `call` (one unit of the quota of the grant, one voucher). The test runs two mock providers that keep their own books.

| Do | See |
| --- | --- |
| `gpu` pays 0.015 credit for a call to the AI provider (item 61), with an `authorization` header of its own | The provider sees the key of the grantor and no voucher; the header of the lessee is not forwarded; one voucher is settled |
| A path or a method outside the scope of the grant | `403 grant_scope_denied` before payment; the provider is not asked |
| The provider answers `402` because its own credit is gone | The answer is passed on, the call is not paid and the quota is not used |
| The third paid call, then a fourth | The fourth is `429 grant_quota_exceeded`: refused before the provider and before payment; three calls were bought, three used |
| The same for the map quota (item 64): a GET with a query string, the key in `x-api-key`, 0.005 credit a call | The key is in its own header at the provider; three calls pass, the fourth is refused; six vouchers in all, one per call |
| A provider that echoes the request headers | The key is replaced by `[redacted]` in the body and the headers of the answer |

The keys are in no answer, no header, no log line of the broker and nothing the facilitator settled; the test searches for them. Not shown: a real AI or map provider (many forbid sharing a key, which is why both catalog rows carry a condition), and a broker inside a TEE (the key is in the environment of the broker process).

#### Course gift code and organisation member with a budget (items 72 and 25, UM-113)

```bash
X207_SANDBOX=1 npx vitest run tests/codes-course.sandbox.test.ts      # about one minute, the pattern of the codes above
X207_SANDBOX=1 npx vitest run tests/org-member.sandbox.test.ts        # about two minutes, real broker, real adapter, a mock organisation
```

| Do | See |
| --- | --- |
| A gift code for a course (item 72, issuer `courses.example`) is sold for 8 credit | `paid_held`, no voucher; the platform is asked once before the key is released and the code is valid; the handover does not redeem it |
| The buyer redeems the code on the platform and confirms | The platform now says `used`; only now the voucher is in the answer and registered: the pair holds 8 credit |
| A code that was redeemed before the sale, and a code the platform does not know (voided after a refund) | `code_used` (cancelled) and `code_unknown`: the key is not released, no voucher leaves, the pair holds 0 |
| A course code bound to the recipient's account | `code_bound_to_identity` at the listing: nothing in the book |
| The lessee pays one day for an organisation seat (item 25, adapter `org-member-budget`) with a daily budget of 20 USD | The broker invites the e-mail of the scope with its role and budget; the organisation keeps the budget |
| The person accepts and spends: 12, then 10 more, then 8 | The organisation refuses the 10 (past the budget) and accepts the 8; the read of the access shows the real spend of the day, 20 credit units |
| A second day paid before the first ends | The same member, the paid end moves by one day, no second invitation |
| A day nobody pays | At the paid end the broker removes the member; the organisation refuses its next spend |

Not shown: a real course platform or organisation (mocks ran). The organisation test moves the clock of the broker past the paid end and does not fast-forward the chain, which would take minutes; the grant on the contract lasts 30 days.

**Design templates (#68) and licensed assets (#69), UM-114.** `X207_SANDBOX=1 npx vitest run tests/design-asset.sandbox.test.ts tests/licensed-asset.sandbox.test.ts --no-file-parallelism` (about one minute each). The license text is the `terms` of the listing and its sha256 is the `license_hash`; it names the kind of license (one of the accepted list of the backend, for example `commercial` or `personal`) and says that the licensor holds the rights.

| Do | See |
| --- | --- |
| `designer` lists a template with a `commercial` license; `studio` reads the terms and checks that their hash is the `license_hash`, that they name the kind of the listing, and that they state the rights | The check passes; the studio buys, the designer releases the key, the studio opens the file and confirms: the pair holds 25 credit |
| A listing whose terms do not state the rights | The buyer's check fails and the studio does not buy; nothing is paid |
| A listing with a license kind that is not on the list (`stock-standard`) | `license_id_rejected` when it is posted |

The backend checks the kind of license, not the text: the statement of rights is the buyer's check, and x207 cannot prove who holds the copyright. What protects a buyer is the takedown:

| Do | See |
| --- | --- |
| `musician` sells a track (`creative:licensed-asset`, `commercial`, 15 credit); the studio checks the terms, buys, opens, confirms | The pair holds 15 credit |
| `reseller` lists footage and claims the rights; the studio pays, the voucher is held by the backend | `paid_held`, no voucher in the answer |
| The studio, as the buyer, files a takedown | `takedown_invalid`: a buyer uses the dispute of its purchase |
| `holder`, the member who owns the footage, files a takedown with a claim and the hash of its evidence | The listing is hidden, the unconfirmed purchase is `cancelled`, the voucher never reaches the seller, the pair stays at 0, and nobody can buy the listing |

A confirmed sale stays (ADR-20): a takedown after the key was released and confirmed does not take the money back.

**Own preset and plugin (#70, UM-115).** `X207_SANDBOX=1 npx vitest run tests/own-plugin.sandbox.test.ts` (about one minute). The author sells a colour preset under `own-work` (6 credit) and a plugin under `commercial-redistribute` (14 credit) to the same buyer. Each is bought after the terms check of the blocks above, opened, confirmed and paid; the second voucher continues from the first and the pair holds 20 credit. Whether the buyer may sell a file on is read from the accepted list of the backend (`own-work`: no, `commercial-redistribute`: yes), not from the text of the seller.

### Platform transfer block (ADR-49)

```bash
npx vitest run agents/test/transfer.book.test.ts                  # agents against the transfer ledger, in process, no sandbox
X207_SANDBOX=1 npx vitest run tests/transfer.sandbox.test.ts      # a domain (#66, #29): real contract and indexer; about one minute
X207_SANDBOX=1 npx vitest run tests/transfer-ticket-item.sandbox.test.ts   # a ticket (#73) and a game item (#75): same circle, fake Steam trade offer API
```

A domain, a game item or a ticket is not moved by x207: the seller moves it with the official feature of its platform (registrar, Steam trade, ticket transfer), and x207 only decides when the buyer's voucher is paid. The voucher is held by the backend until the platform shows that the transfer happened (`dns_txt`, `trade_api` or `buyer_confirm`); the window is 7 days for a domain, 1 day for a ticket and 1 hour for a game item. In the sandbox test the registrar is a fake internet (DNS over HTTPS and the registry RDAP are injected, because the backend refuses a loopback address).

| Do | See |
| --- | --- |
| `seller` sets the TXT `x207-sell=<listing_hash>` on the domain and lists it; `buyer` pays with a voucher of 40 credit | The transfer is `paid_held`; the answer has no voucher |
| `seller` sets the transfer code (auth code, #29) at the registrar and hands it to `buyer` once, outside x207; `buyer` redeems it at the registrar (a wrong code and a second use are refused) | The registrar moves the domain (#66); the code is never sent to the backend |
| The proof is asked before the registrar has finished, then while the registry still says `pending transfer` | `pending`, with the TXT that is missing; still no voucher, the pair holds 0 |
| The registry shows the domain `active` and the buyer's TXT `x207-own=<transfer id>` is there | `confirmed`; only now the voucher is in the answer, and the seller registers it: the pair holds 40 credit |
| `second` pays for a domain whose transfer never finishes, and the 7 day window passes | `cancelled` with `transfer_window_passed`; no voucher ever leaves, the pair holds 0 |
| `seller` sells a ticket (60 credit): the platform cannot prove it, `buyer` confirms | Only the buyer's signed notice confirms (the seller's is refused); then the voucher is released and registered |
| `second` buys a ticket, and the platform cancels the transfer | `buyer` cancels the held transfer: `cancelled`, nothing is paid or registered |
| A game item (12 credit): the Steam trade offer is sent, then accepted but held by Steam, then past its hold | `pending` (state 2), `pending` with `retryAfterSeconds`, then `confirmed`: only now registered |
| A game item whose trade offer Steam cancels, and the buyer says `cancelled` | A request, not an end: no proof ever, so it takes effect when the window ends (`cancelled_by_buyer`), the pair holds 0 |
| The buyer already has the game item and says `cancelled` | Still `paid_held` with `cancelRequested`; the seller's proof then gives `confirmed`, and the voucher is registered (the buyer does not keep the item for free) |

The transfer code never appears in an answer or request of the API, in the log, or in any table of D9 (the test searches all three). A seller who does not transfer is not paid, and a buyer who has no domain is not charged: the voucher moves only on a proof. What this block does not show: the registrar and Steam themselves (both are fakes in every test) (a real registry is not called in any test).

### Group E without an API block (pipeline P2: airtime and loyalty points)

```bash
X207_SANDBOX=1 npx vitest run tests/delivery-group-e.sandbox.test.ts   # real contract and indexer; about one minute
```

Airtime and data allowance (#78) and transferable loyalty points (#79) have no API that x402 or x207 can call. The seller hands the thing over once, with the transfer feature of the carrier or the program, outside x207, and signs a `delivered` notice (with the hash of the receipt, never the receipt). The receiver signs `confirmed` or `disputed` (BE-047), and the payment is registered on the contract only when the handover is confirmed. A deal at or above the bond threshold (100 credit) is a **deal with a bond** (CT-094): `accept` refuses a plain payment (`409 bond_required`) and takes a bundle of the two parties whose signed terms name an arbiter and `confirm_by`; the bundle is committed before the handover, so the bond of each side is locked while the thing is handed over. A sale has one payment, and the contract needs a swap of two legs, so the bundle carries a nominal return leg of one unit (0.000001 credit) from the seller.

| Do | See |
| --- | --- |
| `seller` lists 30 credit of airtime, `buyer` offers and `seller` accepts | The match is `awaiting`, not payable, `needsBond: false` |
| `seller` signs `delivered`; `buyer` signs `confirmed` (the seller cannot confirm its own handover) | `payable: true`; then `buyer` signs the voucher and `seller` registers it: the pair holds 30 credit |
| `seller` lists 110 credit of loyalty points and `second` buys them; `accept` without an arbiter | `409 bond_required` |
| `seller` accepts with an arbiter; both sign the terms; anybody commits the bundle | The bundle is `ready` before the handover; `commit_bundle` locks the bond of both sides (`bond_locked`) |
| `seller` signs `delivered`; `second` signs `disputed` (`not_received`) and calls `dispute_deal`; the arbiter calls `rule_deal` `accused_guilty` | The bond of the seller goes to the stake of the buyer, both locks are lifted, the handover is never payable, the pair holds 0 |

What this block does not show: a ruling for the seller (`no_fault` and `complaint_false` have their own tests on the contract), a real carrier or program (the transfer is simulated by the notices), the automatic confirmation after 72 hours of silence (own backend test), and the transfer ledger of the platforms (domain, game item, ticket): it keeps refusing a value at or above the threshold with `transfer_arbiter_required`, because its voucher flow cannot carry a bond.

### Team plan seat block (pipeline P2 group E, #80)

```bash
X207_SANDBOX=1 npx vitest run tests/team-seat.sandbox.test.ts   # real contract and indexer; about one minute
```

A seat of a team plan has no API that x207 can call: the seller invites the buyer once with the member feature of the plan, outside x207, and signs `delivered` (the hash of the invitation, never the invitation). The buyer accepts the invitation and signs `confirmed` (BE-047); only then is the payment registered on the contract. A plan that needs one fixed household is class X, so a seat of a family plan is disputed by a buyer who cannot use it. The deal is below the bond threshold (100 credit); at or above it the handover is a deal with a bond (see the group E block above).

| Do | See |
| --- | --- |
| `seller` lists a team plan seat for 25 credit, `buyer` offers and `seller` accepts | The match is `awaiting`, not payable, `needsBond: false` |
| `seller` signs `delivered`; the seller cannot sign `confirmed` | `403`: only the receiver confirms |
| `buyer` accepts the invitation and signs `confirmed`; `seller` registers the voucher | `payable: true`; the pair holds 25 credit |
| `second` buys a seat of a family plan, gets an invitation it cannot use and signs `disputed` (`not_as_described`) | `disputed`, never payable, a later `confirmed` is refused, the pair holds 0 |

What this block does not show: a real plan or invitation (the invitation is simulated by the notices), the 72 hour silence that confirms by itself (own backend test), and a seat at or above 100 credit (own block).

### Website block (pipeline P4, #67)

```bash
X207_SANDBOX=1 npx vitest run tests/site-sale.sandbox.test.ts   # real contract and indexer; about one minute
```

x207 does not move a website or an online shop. A site is sold as **two sales with their own proofs**, because the backend keeps refusing the asset type `site:web-property` as one listing (`asset_roadmap_only`): the domain goes through the transfer ledger (the voucher is held until the registry shows the domain moved, as in the platform transfer block), and the admin credentials go once through `secret_release` (sealed to the buyer, as in the one-time code flow; credentials cannot be checked by an issuer, so that part is capped at 20 credit). `agents/scenario/site.ts` has the three steps of each side.

The order is the rule, and the vouchers are cumulative: the voucher of the credentials is the later one of the pair and carries the price of the domain too. So the seller hands over the credentials only after the domain is proven, and the buyer confirms them only after it took control of the panel (logged in and changed the password).

| Do | See |
| --- | --- |
| `seller` sets the TXT `x207-sell` on the domain, lists the domain (70 credit) and the admin credentials (20 credit); `buyer` pays both | Two purchases `paid_held`, no voucher released |
| `seller` tries to hand over the credentials before the domain moved | Refused by the agent (`domain_not_proven`): the key stays with the seller |
| The registry shows the domain `active` and the buyer's TXT is there | The domain transfer is `confirmed`; voucher 1 (70 credit) is released |
| `seller` hands over the credentials; `buyer` logs in, changes the password and confirms | `confirmed`; voucher 2 (90 credit cumulative) is released; the old credentials stop working; `seller` registers both and the pair holds 90 credit |
| `second` pays for a site whose domain never moves; 7 days pass | The domain transfer is `cancelled` (`transfer_window_passed`); the credentials are never handed over, the seller gives up that sale, the pair holds 0 |

The credentials, their salt and the key of the file are in no table of D9 (the test searches all of them). What this block does not show: a real registrar or admin panel (both are fakes), a site worth more than 20 credit in credentials (a larger price needs a different handover), the files and the database of the site (they are the seller's to hand over by the same credentials), and what happens if the seller registers the later voucher before the earlier one (a cumulative voucher pays the earlier part too: the buyer confirms the credentials last for this reason).

### Community role block (pipeline P2 group D, #24 and #85)

```bash
X207_SANDBOX=1 npx vitest run tests/community-role.sandbox.test.ts   # real contract, indexer, facilitator and broker; several minutes
```

A role of a community is rented by the day. The broker of the grantor holds the bot of the community and gives the role with the REST calls of Discord (the real `discord` adapter; the server of the test is a mock that keeps the roles of its members). A role gives no expiry of its own, so the broker takes it back: at the end of the paid day, or when the grantor revokes. Paying is an ordinary voucher through the facilitator, one day each time, and a day paid before the first ends is added to its end. The id of the member is only checked to exist on the server unless Discord OAuth is set up on the broker (the answer then carries the warning `grantee_unproven`).

| Do | See |
| --- | --- |
| #24 paid role: `scraper` offers the role, `translator` accepts and pays a day | The member holds the role on the server; the answer has the guild and the role |
| `translator` pays a second day before the first ends | The paid end moves by one day; the role stays |
| The paid end passes and nobody pays | The broker's tick removes the role; the access is no longer `active` |
| #85 own group: `gpu` rents the member role of its group, `image` pays a day | The member holds the role |
| `image` leaves the circle (`request_exit`) and tries to pay the next day | No voucher can be signed; the role stays until the paid end, then the broker takes it away |

What this block does not show: a real Discord server (the REST calls are mocked), the OAuth proof of the id of the member, and a rate limit of Discord (the retry of the broker has its own test).

**Own online course (#71, UM-111).** `X207_SANDBOX=1 npx vitest run tests/course.sandbox.test.ts` (about one minute), described here because it is the license flow below with an endpoint added. `teacher` sells the course package (the syllabus and the lesson list) as a license of 40 credit; `student` buys it, opens it, checks the hash and confirms, and the teacher registers the voucher. The lessons are then read from the teacher's endpoint, open for a term of 30 days that starts when the teacher sees the purchase confirmed:

| Do | See |
| --- | --- |
| `student` signs a lesson request with its voucher key on day 1 and on day 29 | `200`, the lesson |
| `outsider`, a member who did not buy, signs with its own key for the student's purchase | `403`: the signature is checked against the voucher key of the buyer in the contract |
| `student` asks on day 31 | `410`, course access expired |
| A request before the purchase is confirmed, or for a purchase that does not exist | `404` |

The term is the teacher's: x207 sells the license and proves who paid, and the endpoint of the seller enforces the days. The seller's clock is set in the test so that it does not wait 30 days.

**Cloud credit (#62, UM-115).** `X207_SANDBOX=1 npx vitest run tests/cloud-credit.sandbox.test.ts` (several minutes). What is rented is a place in a cloud project with a daily budget, not the credit: the grantor's project holds the promotional credit, the provider keeps the daily budget, and a person is invited for each paid day (the adapter `org-member-budget`, with a mock members API as the provider).

| Do | See |
| --- | --- |
| The lessee pays one day with an ordinary voucher | The project invites the e-mail of the grant as an `editor` with a daily budget of 20 USD; nothing of the credit moves |
| The person accepts and spends 12, then 10, then 8 USD | The provider refuses the 10 (12 + 10 is over the budget) and takes the 8 (12 + 8 is the whole budget); the read of the access shows the real spend of the day, 20 credit units |
| A second day is paid before the first ends | The same member, the paid end moves by one day, no second invitation |
| Nobody pays the next day | At the paid end the broker removes the member and the provider refuses the next spend |

Promotional cloud credit is usually not transferable, and a provider can end a project that lends it out. The catalog entry therefore reads "lawful only when the provider allows it", and the rent is a membership under the grantor's own account, with the admin token staying on the machine of the broker.

### Own work and own anonymised data block (pipeline P7, #82 and #89)

```bash
X207_SANDBOX=1 npx vitest run tests/own-content.sandbox.test.ts   # real contract and indexer; about two minutes
```

The file license of the block above (UM-088) serves two more catalog items without a new route: #82 an article, photo, video or design that the seller made (`content:own-work`, license `own-work`) and #89 data of the seller that has been anonymised (`data:own-anonymized`). x207 never holds the file: the seller encrypts it, the voucher of the buyer is held by the backend, the key is sealed to the buyer, and the buyer checks the hash of the file before it confirms.

| Do | See |
| --- | --- |
| `seller` lists an article (15 credit) with the license `own-work`; `buyer` pays, `seller` releases the key, `buyer` opens the file and confirms | `confirmed`; the voucher is registered and the pair holds 15 credit |
| `seller` lists an exclusive license of a photo (20 credit); `buyer` pays; `second` tries to buy the same exclusive license | The second purchase is refused; the first is confirmed and registered (35 credit) |
| `seller` lists a dataset whose preview has an e-mail address | The book refuses the listing: `preview_contains_pii` (the scan finds e-mail, identity number, phone, card number, IBAN; it answers the kinds, never the matches) |
| The same dataset with a preview of aggregate figures | Listed, sold and registered (60 credit in all) |
| `seller` lists a dataset but the file it delivers is another one | The SDK of `second` proves it, the purchase is `disputed`, no voucher leaves, the pair holds 0 |

What this block does not show: the anonymisation itself (x207 cannot tell whether a file is anonymous; the scan covers the preview only, and it finds common shapes, not every personal datum), the rights of the seller over the work (a takedown claim has its own test), and the content of the file when the buyer opens it.

### Access rent block (pipeline P2)

```bash
npx vitest run agents/test/rent.test.ts                       # agents against the broker, in process, no sandbox
X207_SANDBOX=1 npx vitest run tests/rent.sandbox.test.ts       # real contract, indexer, facilitator and broker; several minutes
```

An access (an SSH key, a repository collaborator, a cloud role) is rented by the day. The grantor offers a grant on the contract and runs its own broker, so the administrator token of the provider stays on its machine; the lessee pays one day in advance with an ordinary voucher and signs the next day only if the access still works (`sdk/docs/daily-rent.md`). Each side loses one day at most. The providers in this block are mocks and an SSH `authorized_keys` that is checked by what `sshd` does with it.

| Do | See |
| --- | --- |
| The grantor offers an SSH grant, the lessee accepts, proves it owns the key (a signature of the challenge of the broker) and pays one day | The key is in `authorized_keys` with its forced command and `expiry-time` at the end of the paid day; after that time `sshd` refuses it even if the broker is down |
| The grantor revokes the grant on the contract | `grant_revoked` reaches the broker through the read API; the line is removed and a new payment is refused (`403`) |
| A repository collaborator is rented and the lessee stops with a signed notice | The collaborator is removed at the provider; the SDK signs no voucher after the stop |
| A cloud role is rented with a daily cap of 0.1 credit; the real cost of day 1 is 0.02 | The broker writes the bill; the lessee signs it as a second voucher (`resource = x207:grant:<id>:cost`) |
| The real cost of day 2 is 0.3, above the cap | The broker closes the access, and the SDK refuses to sign the bill (`rent_bill_over_cap`) |

What this block does not show: real GitHub, Discord or AWS accounts (the broker has adapters for them, tested against mocked `fetch`), the payment of a bill by the facilitator, and the loss of the paid day when a provider closes an access in the minutes after the check.

### Marketplace block (feature F9)

```bash
npm run demo:marketplace   # about 2.5 minutes; real contract, indexer, solver and keeper in near-sandbox
```

| Do | See |
| --- | --- |
| `translator` lists a service for another service and nobody is there | The listing stays open for two hours; a second listing with a 30 minute life drops out of the open results |
| `summarizer` arrives later and negotiates by its own policy | `bid 0.17 -> countered 0.19 -> countered 0.18 -> accepted`; the pair becomes a bundle that both sign |
| A seeker visits idle agents that opted in | Offers to `translator` by pay and to `summarizer` by barter; the agent that did not opt in is skipped |
| Pay path (listing value 0.5, discount 20%, seeker share 4%) | The counterparty pays 0.42 = 0.4 to the seller + 0.02 to the seeker |
| Barter path (same parameters) | Cashback 0.08 to the counterparty, the seller bears 0.1, the seeker earns 0.02 on each path |
| Three agents post intents and the solver finds the ring `gpu -> translator -> image` | All three sign the same `terms_hash`; the solver commits four bundles (`commit_bundle`) |
| Pay every leg with ordinary x402 calls | The voucher carries the bundle id, so the call uses reserved headroom; 110 paid calls registered |
| Close the epoch, run the solver, commit, read the 207 report | Cleared 1.74 credit; `image` and `gpu` (ring only) have status 200 and net 0; the seeker nets 0.04; every net equals the registered obligations |

The amounts are small on purpose so that each leg is a whole number of 0.02 calls. The seeker leg is named in the signed terms (`search_leg`) and the contract caps it at `max_search_share_bps` (default 500, 5%) of the sum of the legs of the bundle; a 10% share made the first version of this demo fail on the 0.0.5 contract, so the run uses a 4% share of a 0.5 listing (the seeker leg is 0.02 of 0.42 on the pay path); the 100 / 10 / 3 example of the F9 note is computed by the same functions with other parameters (`sdk/spec/marketplace.md`). The listing book, negotiation and seeker are off-chain (backend module M11); the contract only checks a bundle: one signature per participant over its `terms_hash` and the reserved headroom of each leg. Run on 2026-11-02; the test `tests/marketplace.sandbox.test.ts` asserts the same figures. Not shown: quality of goods or disputes (the protocol does not judge them), asset classes A to C with real delivery adapters, and the on-chain `post_intent` hash (the demo posts intents to the book only).

Off-chain assets (a code, a seat, a domain) cannot be handed over atomically like a class A escrow. For assets of class B or C a match starts a delivery flow in the marketplace (`backend/docs/delivery.md`): the seller marks the asset delivered, the buyer confirms or disputes inside a 72 hour window, a silent buyer counts as confirming, and a bundle is not ready to commit until then. In a barter match the counterparty's own handover is tracked the same way. Two limits: a dispute is not ruled on (it needs an arbiter and a contract change, `contracts/docs/payment-hold.md`), and for a plain payment the backend only reports `payable`; the party that registers the voucher must check it. Not run against real traffic.


### Access asset block, class B (feature F8)

```bash
npm run demo:classb   # about 2 minutes; real contract, indexer, facilitator and broker in near-sandbox
```

| Do | See |
| --- | --- |
| `scraper` offers a rental of the asset type `near-rpc:access` (method `get_params`, 0.05 credit a day, operator = the broker) | Grant 1, status `offered` |
| `translator` accepts with its own function-call key as `delivery_pubkey` | Status `active`; the secret key stays with `translator` |
| `translator` asks the broker for the lease without paying | HTTP 402 whose x207 entry has `payTo` = `scraper` (the grantor, not the broker) and `extra.grantId` |
| `translator` pays one day with an ordinary x402 voucher | HTTP 200, the key is installed on the lease sub-account and `paidUntil` is one day ahead (capped at `expires_at`); the node shows a function-call key with the receiver, the method and the allowance of the grant |
| `translator` calls `get_params` with the key | The call succeeds |
| `translator` calls `get_epoch`, and `get_params` with 1 yoctoNEAR attached | Both are refused by the NEAR protocol itself ("Access key does not allow method", "Deposit is not allowed with function call") |
| `translator` does not pay its residual; the keeper finalizes the epoch | `translator` is `suspended`; the broker reads `member_defaulted` from the read API and deletes the key about 3 seconds later; the grant is `revoked`; the same key is refused |
| Another member asks for the lease of that grant | HTTP 403 `grant_revoked` |

The rent is an ordinary voucher from the lessee to the grantor, so the broker never writes the obligation ledger and the rent is cleared by F3 like any other payment. The run is a sandbox run: no TEE, no testnet or mainnet transaction, class C is not built, and the quality of what the key is used for is not judged. The test `tests/broker-class-b.sandbox.test.ts` covers the same flow plus renewal and expiry.

### Barter bundle block (feature F5)

```bash
X207_SANDBOX=1 npx vitest run tests/barter.sandbox.test.ts   # real contract, facilitator, indexer, book, solver and keeper in near-sandbox
```

| Do | See |
| --- | --- |
| `translator`, `summarizer` and `scraper` each post an intent (offer one service, need the next) | Three open intents in the book; no match is stored for any single pair |
| The solver finds the ring and the three agents sign the same `terms_hash` | One bundle of three legs; the server, the client and the contract compute the same hash from the legs |
| Anyone calls `commit_bundle` with the three signatures | `bundle_committed` with the `terms_hash`; each payer's headroom is reserved for its leg |
| Each leg is paid with an ordinary x402 call whose voucher carries `bundleId` | Facilitator `verify` checks the leg with `get_bundle`, and the scheduler registers it with `register_in_bundle`; cumulative equals the leg amount on all three edges |
| Close the epoch, run the solver, commit, read the 207 report | Cleared equals the obligation of the three legs; all three members have status 200 and net 0; no position to claim |

Contract rules behind the rows: `contracts/x207-circle/src/bundle.rs` (`commit_bundle` checks the epoch phase, the shape of the legs, active participants, one valid signature per participant over the NEP-413 style `terms_hash`, and headroom of every payer; nothing is written before the last check passes) and `contracts/tests/ct065_bundle.rs`. The test run is the source of the figures; the printed form for the whole flow with a seeker is the marketplace block above.

### Metered resource block (pipeline P5, class D)

```bash
npx vitest run agents/test/metered.test.ts        # a CPU job in chunks and a data feed per call (AG-024), no network
```

A resource that is paid per unit of use is an x402 endpoint. `createMeteredEndpoint({ kind, unitPrice, handler })` in `@x207/scheme` gives it the price per unit, the ceiling per request, the listing detail and the warnings of its kind; the twelve kinds are the same as in the registry D10 (`docs/asset-catalog.md`) and in the listing form of the frontend:

| Kind | Asset type | Units (first is default) |
| --- | --- | --- |
| `cpu` (#31) | `compute:cpu-idle` | minute, job |
| `gpu` (#32) | `compute:gpu-hours` | minute, job |
| `storage` (#33) | `storage:capacity` | GB, day |
| `cdn` (#34) | `cdn:static-cache` | GB, request |
| `inference` (#35) | `model:inference` | request, call |
| `fine-tuning` (#36) | `model:fine-tuning` | job |
| `data-feed` (#44) | `oracle:data-feed` | call, request |
| `iot-sensor` (#45) | `iot:sensor-data` | call, day |
| `gas-relayer` (#47) | `gas:relayer` | request, call |
| `priority-slot` (#49) | `queue:priority-slot` | request, day |
| `proxy-bandwidth` (#55) | `network:proxy-bandwidth` | GB, request |
| `home-device` (#90) | `compute:home-device` | minute, day, job |

| Do | See |
| --- | --- |
| The buyer asks `?quantity=30` at a `cpu` endpoint priced per minute | `402` with `extra.meter = {unit, quantity, unit_price, max_quantity}`; above the ceiling the request is refused `413` before any `402` |
| A long job is split in chunks and the budget is committed as a bundle (`JobBudget`, SD-067) | The buyer signs the voucher of chunk k only after chunk k-1 arrived; the seller works chunk k only after its voucher arrived |
| The buyer stops paying, or the seller disappears inside a chunk | The seller worked nothing unpaid; the buyer lost one chunk at most (the one it prepaid) |

The buyer keeps its own count (`BuyerMeter`, SD-068): it signs no voucher above the price of what it received plus what it asked for, so a bill of 10 GB for 2 GB gets no voucher above 2 GB.

The contract does not change: the units live in the SDK, the listing and the voucher. The contract needs two legs in a bundle (`ERR_BAD_BUNDLE`), so the budget bundle carries a one-unit counter leg from the seller to the buyer. Proxy and bandwidth (#55) are subject to local law and a device at home (#90) leaves power and security to its owner; both carry a warning, they are not refused. See `sdk/docs/metered-endpoint.md`.
