# x207 demo video: script (target 2:55)

This file mirrors the narration of the recorded video. It is a draft: nothing here was posted, and the owner publishes the post ([x-post.md](x-post.md), form: [form-draft.md](form-draft.md)).

Every number has a source in the "Source" line of its scene; nothing here is a claim beyond those sources. Everything ran on **testnet** with a **mock USDT** (`usdt.x207-deployer.testnet`); no mainnet transaction has been sent. In the ring demo one team script signs for all three agents.

| # | Scene | Time | Length |
|---|---|---|---|
| 1 | Hook | 0:00–0:15 | 15 s |
| 2 | Pricing | 0:15–0:50 | 35 s |
| 3 | Matching | 0:50–1:40 | 50 s |
| 4 | Timing and safety | 1:40–2:15 | 35 s |
| 5 | Developer | 2:15–2:35 | 20 s |
| 6 | Close | 2:35–2:55 | 20 s |

## Scene 1. Hook (0:00–0:15)

**Screen:** the landing page `https://x207.vercel.app/`, hero.

> Barter failed for three reasons: matching, pricing, timing.
> x207 fixes all three for AI agents on NEAR.
> x402 lets agents pay. x207 lets them pay with anything of value. Here it is, on testnet.

## Scene 2. Pricing (0:15–0:50)

**Screen:** the marketplace of circle v018, a listing with the appraisal badge, then its proof panel.

> Pricing. An API quota or a licence has no market price.
> So x207 asks an appraiser on NEAR AI Cloud, running inside a TEE, to value the asset in credit.
> An appraised listing carries a badge, and the proof panel shows what was checked.
> Signature checked locally; quote checked via third-party verifiers, Phala and NVIDIA NRAS.
> The value is advice only. The contract never reads it.

**Source:** [README.md](../../README.md) section "Asset appraiser on NEAR AI Cloud (TEE)"; the appraisal shown is the ring's own Mapbox appraisal `apr_4d97a431de9635c442083c67` on the v018 backend (market price 30, value 24 credit, the same value as in Scene 3; `agents/docs/demo-barter-cycle.md`).

## Scene 3. Matching (0:50–1:40)

**Screen:** the dashboard at `/stats?epoch=184&circle=v018`, the ring of epoch 184.

> Matching. Three agents each hold something another one wants, but no pair wants each other's asset.
> Alice lists a Mapbox geocoding quota, appraised at 24 credit. Bob lists a JetBrains licence, 32. Dan lists FastNEAR RPC access, 25.
> A team script signs for all three.
> They trade in a ring: alice to bob, bob to dan, dan to alice. 81 credit of trade.
> The circle contract nets every position, so only 8 USDT actually moves.
> A clearing proposal removes 72 of the 81 from the gross record. Only credit moved; no asset was delivered in this run.

**Source:** `agents/docs/demo-barter-cycle.md` (`x207-v018.testnet`, epoch 184): values 24 / 32 / 25; gross 81; cancelled 72 (88.9%); 8 USDT moved.

## Scene 4. Timing and safety (1:40–2:15)

**Screen:** the overspend run: the accepted voucher, then the refused one on nearblocks.

> Timing. The other side may not be able to deliver today.
> So agents trade on mutual credit: a signed voucher is served at once, and settled at the end of the epoch, backed by a stake.
> What stops an agent from overspending?
> Bob signed two vouchers of 75 credit, with room for only 125. The contract registered the first, and refused the second with insufficient credit.
> By default a seller serves before the chain answers; the register-first mode closes that gap.

**Source:** `contracts/docs/testnet-epochs/ct132-overspend-run.json` (`x207-v018.testnet`, epoch 183): headroom 125, two vouchers of 75; the second fails with `ERR_INSUFFICIENT_CREDIT`.

## Scene 5. Developer (2:15–2:35)

**Screen:** the docs site `https://x207-docs.vercel.app`, the Ask AI box, then the one-line client setup in the README.

> For developers: the docs site has an Ask AI box.
> After joining and staking, an agent that already uses x402 adds one line to its client, and pays sellers that accept x207.

**Source:** [README.md](../../README.md) section "Adding x207 to an agent that uses `@x402/fetch`".

## Scene 6. Close (2:35–2:55)

**Screen:** the README status lines on GitHub.

> Everything you saw ran on NEAR testnet, with a mock USDT.
> Mainnet has not run yet. A runbook is prepared.
> The code, the evidence and the docs are linked below. Thank you.

**Source:** [README.md](../../README.md): "Mainnet has not run: no mainnet transaction has been sent"; [docs/mainnet-runbook.md](../mainnet-runbook.md).

## Words not to say

"DCAP-verified", "trustless", "validator", "only NEAR", "mainnet live", "cash-free", "saves gas", "guaranteed", "audited" (the security review is internal, not a third-party audit).
