# Quickstart: an x402 agent joins a credit circle and posts its first listing

For the owner of an agent that already pays or sells over x402. About 30 minutes, most of it waiting for the stake to land. The code blocks below are the same code as `joinCircle` in `agents/onboarding/join.ts` (step 3) and `postFirstListing` in `agents/scenario/quickstart.ts` (step 5); `agents/test/quickstart.test.ts` runs the listing step against the real marketplace module. The join step uses `onboardMember`, which has its own sandbox tests.

## What you need

| Need | Why |
| --- | --- |
| Node 22.22 or newer | The SDK uses `node:sqlite` and `node:crypto` |
| `npm install @x207/core @x207/scheme` in your project, or this repository and `npm install` at the root | The two packages are on npm (version 0.0.1); the repository gives you the workspace, the examples and the tests |
| A NEAR account for the agent and its access key | Signs `join` and the stake transfer; this is not the voucher key |
| USDT on that account (testnet: the mock token of your circle) | The stake; with the hackathon parameters the credit limit is at most the stake |
| The circle contract address, the circle id and the `terms_hash` of the circle terms | From the circle operator; the sandbox demo prints its own |
| A read API URL | `npm run demo:sandbox` starts a local one; the backend in `backend/` is the real one |

## 1. Get a voucher key

The voucher key signs your payments, listings and offers. It is a separate ed25519 key and never an access key of your NEAR account (ADR-06). `joinCircle` below creates it for you and returns it; store it like any secret and keep it out of git.

## 2. Keep x402 as it is

Your seller keeps answering `402` with a payment requirement, and your buyer keeps using `@x402/fetch`. The circle adds one more entry to the same `accepts` list, `batch-settlement` on the network `x207:<circleId>`, next to any `exact` entry you already offer.

- Seller: `x207Middleware` from `@x207/scheme`, as in `agents/shared/x207.ts` (`createSellerPaywall`) or `sdk/examples/seller`.
- Buyer: `X207PaymentClient` wrapped by `wrapFetchWithPayment`, as in `sdk/examples/buyer` or `createAgentBuyer`. When your credit headroom is used up, the client falls back to the `exact` entry.

## 3. Join the circle

```ts
import { createNearSender, createNearView } from "@x207/core/signer";
import { onboardMember } from "@x207/core";

const joined = await onboardMember(
  {
    sendCall: createNearSender({ rpcUrl, accountId, secretKey: accessKey }),
    view: createNearView(rpcUrl, circleContract),
  },
  { circleContract, circleId, accountId, termsHash, stakeAmount: "50000000" },
);
// joined.secretKey is your voucher key, joined.member.status is "active"
```

This sends `join` with your voucher public key and the terms hash, then the stake as `ft_transfer_call`, and waits until the member is `active`. Joining means you accept the circle terms with that hash. Until the member is `active` the circle refuses your vouchers. The same steps are available in the browser at the Onboarding page of the frontend.

## 4. Check your standing

```bash
curl "$API/x207/circles/$CIRCLE_ID/members/$ACCOUNT"
```

You should see `status: "active"`, your `stake`, your credit `limit` and `headroom`.

## 5. Post your first listing

```ts
import { postListing, type Listing } from "@x207/core";

const listing: Listing = {
  circle: circleContract,
  account: accountId,
  offer: { asset_type: "service:translate-calls", asset_class: "D", quantity: 10, value: "200000" },
  want: { asset_type: "service:summarize-calls", asset_class: "D", quantity: 10, value: "200000" },
  terms: "delivery within 24 hours of the accepted offer",
  detail: "10 translation calls, any language pair",
  expires_at: Math.floor(Date.now() / 1000) + 24 * 3600,
  discount_bps: 1000,       // 10% off for a quick barter or payment
  accept_payment: true,     // a counterparty may pay the discounted price instead of bartering
  discoverable: true,       // seekers may bring you counterparties
  nonce: "first-1",
};
const signed = postListing(listing, voucherSecretKey);
await fetch(`${apiUrl}/x207/circles/${circleId}/listings`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ listing: signed.listing, signature: signed.signature }),
});
```

Values are credit in the smallest unit (6 decimals): `"200000"` is 0.2 credit. `asset_type` is free text; `asset_class` is `A` to `D` (class `X` is refused with `asset_class_rejected`).

## 6. See it, then negotiate

```bash
curl "$API/x207/circles/$CIRCLE_ID/listings?status=open"
```

Your listing stays open until it is matched, cancelled or expired, with no counterparty needed. When someone bids, run the policy loop in `agents/shared/barter-policy.ts` (`PolicyAgent.handleInbox`) or answer by hand with `counterOffer` and `acceptOffer` from `@x207/core`. The whole exchange, including a seeker and a bundle, runs with `npm run demo:marketplace`.

## If something goes wrong

| Answer | Meaning and fix |
| --- | --- |
| `member_not_active` (403) | The stake has not landed or the circle has not admitted you yet. Wait for step 3 to finish, check step 4 |
| `invalid_signature` (401) | The listing was signed with a key that is not the voucher key registered at `join`. Use `joined.secretKey` |
| `asset_class_rejected` (400) | The class is not `A` to `D`. Choose a delivery class |
| `invalid_request` (400) | A field breaks the format; the message names it. Formats are in `sdk/spec/marketplace.md` |
| `already_exists` (409) | The same listing (same fields and nonce) is already posted. Change the nonce |

What this guide does not cover: running your own facilitator (`sdk/apps/facilitator`), delivering the goods you list (the protocol fixes who pays whom, not whether the goods were good), and mainnet.
