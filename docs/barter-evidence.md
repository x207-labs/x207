# Barter catalog: what is proven, kind by kind (UM-200)

_Written 2026-11-08. This table is the upper limit for every sentence about the barter catalog in the README, in [CLAIMS.md](../CLAIMS.md), in the judge documents and in the pitch: nothing may say more than the status of a row here. `scripts/barter-evidence.test.mjs` checks that the table has one row per catalog entry, that the counts below are the counts of the rows, and that every path named as proof exists._

**What "90 kinds" means.** The design note lists 90 numbered rows. Rows 56 to 60 (debts and invoices) are not assets of the registry, so the registry D10 holds **85 kinds that can be offered** (rows 1 to 55 and 61 to 90) and **9 refused kinds** (class X, no number): 94 entries in [scripts/lib/asset-catalog.mjs](../scripts/lib/asset-catalog.mjs). Every entry below is one of the 94.

## The counts

| Status | Rows | What it means, and what it does not |
| --- | ---: | --- |
| `testnet` | 11 | A delivery of this kind ran on a NEAR testnet circle, with transaction hashes in a file of this repository. It does not mean mainnet, and not a real third-party provider: the NFT, token and multi-token contracts of these runs are mock contracts of ours |
| `sandbox` | 13 | The pipeline of this kind runs in `near-sandbox` against the real contract and the real backend, and a test names the kind. Nothing outside x207 is simulated, apart from token contracts and a fake internet that serves files |
| `mock` | 31 | The pipeline runs in `near-sandbox` (or in an agent test), but the provider, issuer or platform behind it is a mock written by us. The x207 side is tested; the provider side is not |
| `unit` | 12 | Only unit tests name the kind (presets, listing form, adapter). No transaction ran for this kind itself |
| `generic` | 13 | No test names this asset type. It is registered in D10, and the generic path of its class (an NFT escrow or an x402 endpoint) is tested through other kinds. Do not read it as "this kind works" |
| `P1 in progress` | 4 | Items #11 to #14: sale of NEAR accounts through a locker, contract 0.0.18 on the branch `p1-0.0.18` of `contracts`. Not on `main`, not on testnet; the main circle stays at 0.0.17. TODO(0.0.18): after the migration #11 and #14 move to `testnet` (only with the transactions of their sale) and the counts here, in the README, in CLAIMS and in the test change with them; #12 and #13 stay `P1 in progress` |
| `roadmap` | 1 | Registered so that a listing can name it; no code |
| `X` | 9 | Refused on purpose: `offer_grant` fails with `ERR_ASSET_CLASS_FORBIDDEN` (tested) |
| **All** | **94** | 85 that can be offered (11 + 13 + 31 + 12 + 13 + 4 + 1) and 9 refused |

By the strictest reading, **11 of 85 kinds have run on testnet (the ten on-chain kinds #1 to #10 of batch 1 and #15), 24 (testnet plus sandbox) run against the real components without a mock provider, and 55 (add the 31 with a mock) have a pipeline that ran end to end in a test.** The other 30 are unit-tested only (12), registered with no test of their own (13), in progress (4) or not built (1). The ten on-chain kinds ran with mock token contracts and, for #9, a mock multi-token instead of NEAR Intents. No kind has run on mainnet: no mainnet transaction has been sent.

The coverage numbers in [asset-catalog.md](asset-catalog.md) (49 "built", 25 "mock", and so on) count the `status` text of the catalog, which the owner of a pipeline sets. They are not proof: they call the 13 `generic` kinds of class D "built", and they call #6 to #10 "planned" although the contract tests and the testnet batch 1 exist (the catalog row is out of date; the table below is the reading to use). When the two disagree, this table wins.

## Table

Paths are relative to the root of the umbrella repository (the sub-repositories `contracts`, `sdk`, `backend`, `agents` sit in it as folders). Hashes are transaction hashes on NEAR testnet; `npm run check:claims -- --online` asks the chain for each one.

### Class A: on-chain assets, moved by escrow

| # | asset_type | Status | Proof | Limits |
| --- | --- | --- | --- | --- |
| 1 | `nft:nep171` | `testnet` | Batch 1 (UM-084) on `x207-b1-v011.testnet` (contract v0.0.11, wasm of the release), `docs/testnet-batch1.json`, run by `tests/testnet-batch1-v011.live.test.ts`: `complete_escrow` delivered `5cfAoTB9NN8mUf95oBb6akBRsikTmAP7vRDcUWQuUAPW`. Also an NFT escrow on `x207-circle-v9.testnet` (contract 0.0.7), in `docs/testnet-f8-v9.json`: offer `8wLu9eahfKBHt3MSVDyJHtz13arZzSanEgZv4kmNq6Vv`, `nft_transfer_call` `2kxJJJquFbnBhhGxZjDQaUxqL6F9wAvXTyLPDf3vLYBt`, `complete_escrow` delivered `HgXnvGHcz6cao7CYANVhWeWNWkrvWwRERbQqmD27jdQq`. Sandbox: `contracts/tests/ct075_escrow.rs`, `tests/escrow-d9.sandbox.test.ts` | The testnet run used the test asset type `nft:ticket` and a mock NFT contract, on an old contract (0.0.7). `nft:nep171` itself was registered on `x207-v013.testnet` by a DAO vote (proposal `CXJMDGLSPsKnhE2JNka9b76VSSmi2CWEzykHtWPM4696`); no delivery ran there |
| 2 | `ticket:event-nft` | `testnet` | Batch 1 (UM-084), `docs/testnet-batch1.json`, `tests/testnet-batch1-v011.live.test.ts`: `complete_escrow` delivered `CgKmPdc3y6imsUbqtZ8tx7J6NNpmE2AeSqAoRL32vR59` | Mock NFT contract; contract v0.0.11 |
| 3 | `game:item-nft` | `testnet` | Batch 1 (UM-084), `docs/testnet-batch1.json`: `complete_escrow` delivered `8hA5CrH49pmAMAs6TKnmSxb1h73MSjf72MMAnHvgNSTM` | Mock NFT contract; contract v0.0.11 |
| 4 | `coupon:voucher-nft` | `testnet` | Batch 1 (UM-084), `docs/testnet-batch1.json`: `complete_escrow` delivered `5TWYxpQ9sjuG1qc6swjkubjYmRcnLqVD7mcPDXXga3Bw` | Mock NFT contract; contract v0.0.11 |
| 5 | `license:software-nft` | `testnet` | Batch 1 (UM-084), `docs/testnet-batch1.json`: `complete_escrow` delivered `FAiXbGMU5jGqVf82nXzDqzmeZQfxaNMhbmJHPM38u9pa` | Mock NFT contract; license terms apply; contract v0.0.11 |
| 6 | `token:nep141` | `testnet` | Batch 1 (UM-084), `docs/testnet-batch1.json`: `complete_escrow` delivered `7NFPjBdMN7xj8xYLtg9pAXDABoM6wUVRKXy1PYZ1MCps`. Sandbox: `contracts/tests/ct090_ft_escrow.rs` | The token is a mock token contract (`probes/mock_rwa`); contract v0.0.11. Also registered on `x207-v013.testnet` by a DAO vote (proposal `3DvxrC2kzrfvLrokqUbNUM4taACVCg6KVs2PeAHgMNPQ`); no delivery there. The catalog row still says "item CT-090" |
| 7 | `rwa:tokenized` | `testnet` | Batch 1 (UM-084), `docs/testnet-batch1.json`: `complete_escrow` delivered `EUspN4NXWsuKwhVwvig9tfMPu8Mf3BGdLW3t48wXqQuR`. Sandbox: `contracts/tests/ct091_restricted_token.rs` (whitelist, frozen account, transfer fee) | A mock restricted token with a whitelist; contract v0.0.11; regulation and recipient whitelist are the issuer's |
| 8 | `lst:liquid-staking` | `testnet` | Batch 1 (UM-084), `docs/testnet-batch1.json`: `complete_escrow` delivered `9V8mQaVbtsKwgVYpShFUUww46GsVQArdjyf5YH6MFPQw`. Sandbox: `contracts/tests/ct090_ft_escrow.rs` | A mock token contract; contract v0.0.11 |
| 9 | `intents:multi-token` | `testnet` | Batch 1 (UM-084), `docs/testnet-batch1.json`: `complete_escrow` delivered `bqLLELpMyqXArqgsEB5NihuVPE2quJDgDxdEnBAAw7m`. Sandbox: `contracts/tests/ct092_mt_escrow.rs` | The token is a mock multi-token (`probes/mock_mt`), NOT the contract of NEAR Intents (the file says so). The real `intents.near` code runs only in the sandbox residual payment: `contracts/tests/ct103_real_intents.rs` |
| 10 | `amm:lp-share` | `testnet` | Batch 1 (UM-084), `docs/testnet-batch1.json`: `complete_escrow` delivered `6fEWd13oGyJZ2UQ6djPB8XfYkYEGUBQJBXajz1B3qqkE`. Sandbox: `contracts/tests/ct092_mt_escrow.rs` | A mock multi-token as the pool share; contract v0.0.11 |
| 11 | `near:named-account` | `P1 in progress` | Branch `p1-0.0.18` of `contracts`: ADR `b81f935`, locker contract `ed04e15`, escrow of kind `account` `6ad63e9`, sandbox tests of the locker with the circle `b5e531e` (test file `ct127_account_escrow`); agents end-to-end test `TC-AG-050-01` ran the sale against the 0.0.18 wasm (agents commit `de105ad`) | Not on `main`, not on testnet, no release. Version 1 sells accounts without contract code. The seller keeping a key cannot be stopped by the contract; the SDK check must refuse (SD-119, not run against testnet). Testnet account TODO(0.0.18); tx of the finalised epoch TODO(0.0.18) |
| 12 | `chain-signatures:derived-address` | `P1 in progress` | Same mechanism and commits as #11 (ADR `b81f935`) | The ADR limits it to accounts with zero `sign` calls; the contract cannot see that history, so the backend must refuse the listing (BE-110, partial on a branch); no test of its own on chain |
| 13 | `vesting:transferable-lockup` | `P1 in progress` | Same ADR `b81f935` | Design only for this kind; no test of its own; many lockups cannot be moved |
| 14 | `claim:cross-circle-receivable` | `P1 in progress` | Same ADR `b81f935` (the asset type `near:member_account`) | Design only for this kind; no test of its own |

### Class B: limited access that can be revoked

| # | asset_type | Status | Proof | Limits |
| --- | --- | --- | --- | --- |
| 15 | `near-rpc:access` | `testnet` | Function-call key rented and revoked on `x207-circle-v9.testnet` (contract 0.0.7), in `docs/testnet-f8-v9.json`: offer `BKHWPyNvmDnx1mnU4xpaq7azACwm6xNWp65SFa9aQATx`, accept `BhGzR4X16TXWzU1ptwSETZV8e8MbRpHibv4bfzfCpeZL`, `AddKey` `F6Kgbrap5hdhy2J96YLLi7s2KnBXeQz7dVNVaoH1UjgE`, leased key calls `get_params` `HGE7J35aSALrC5kLTBNvH2fXdsF6qY2MCYtDLqYxQySJ`, revoke by the grantor `3aPNAxTdLFFSFtVeA2SirS7Jy3EGctbBQN2BXVa68g5A`, `DeleteKey` `63p4mNXZ6AuWahT7oZHAErtJGaQPALBhkJGSzCW3tQwE`. Sandbox: `tests/broker-class-b.sandbox.test.ts` | Old contract (0.0.7); no TEE. Run again on interface 0.0.9 (`docs/testnet-f8-v10.json`) |
| 16 | `dao:vote-delegation` | `unit` | `backend/broker/test/provider-dao-vote.test.ts` (adapter `DaoVoteAdapter`) | Unit test only; no chain test. The catalog row still says "roadmap" |
| 17 | `saas:team-seat` | `mock` | `backend/broker/test/saas-seat-scim.test.ts` (adapter `saas-seat-scim`) | Mock SCIM service; team plan terms |
| 18 | `git:repo-collaborator` | `mock` | `tests/rent.sandbox.test.ts` | Mock repository host |
| 19 | `oauth:scoped-token` | `mock` | `backend/broker/test/oauth-scoped.test.ts` | Mock OAuth provider |
| 20 | `cloud:temporary-role` | `mock` | `tests/rent.sandbox.test.ts` | Mock cloud provider |
| 21 | `storage:signed-url` | `roadmap` | None | No adapter, no test |
| 22 | `ssh:restricted-key` | `mock` | `tests/rent.sandbox.test.ts` | Mock SSH server (`authorized_keys` in memory) |
| 23 | `database:readonly-user` | `mock` | `backend/broker/test/postgres-readonly.test.ts` | Mock SQL client; not run against a real PostgreSQL |
| 24 | `community:paid-role` | `mock` | `tests/community-role.sandbox.test.ts` | Mock Discord server; the real Discord adapter talks to it |
| 25 | `org:spend-limited-member` | `mock` | `tests/org-member.sandbox.test.ts`, `backend/broker/test/org-member-budget.test.ts` | Mock organisation API |

### Class C: a single secret through the broker

| # | asset_type | Status | Proof | Limits |
| --- | --- | --- | --- | --- |
| 26 | `api:delegated-key` | `mock` | `tests/broker-class-c.sandbox.test.ts`, `backend/broker/test/proxy.test.ts` | Mock provider; no TEE and no attestation. A class C grant was offered on `x207-circle-v9.testnet` (`docs/testnet-f8-v9.json`: offer `UXEzMsEroMCgpwsJswR8JDHvzid4Kk13BRXR9S5wmJx`, accept `A6sbDg83KsfjK5UfxyUWUXRCDa94HTupLCijRft8PNGf`, asset type `mock:echo`), but the proxy ran locally |
| 27 | `giftcard:code` | `mock` | `tests/codes.sandbox.test.ts` | Mock issuer |
| 28 | `license:key` | `mock` | `tests/codes-keys.sandbox.test.ts` | Mock issuer; a key bound to an account or region is refused |
| 29 | `domain:transfer-code` | `mock` | `tests/transfer.sandbox.test.ts` | Mock registrar and registry |
| 30 | `api:quota-proxy` | `mock` | `tests/broker-class-c.sandbox.test.ts`, `backend/broker/test/proxy.test.ts` | Mock provider |

### Class D: own resources and services

| # | asset_type | Status | Proof | Limits |
| --- | --- | --- | --- | --- |
| 31 | `compute:cpu-idle` | `unit` | `tests/metered-catalog.test.ts`, `sdk/packages/scheme/test/metered-endpoint.test.ts`, `backend/test/marketplace/resource-listing.test.ts` | Presets, listing and the backend table only. The x402 endpoint path itself ran on testnet for an `exact` payment ([what-has-run.md](what-has-run.md)), not for this kind |
| 32 | `compute:gpu-hours` | `unit` | Same tests as #31 | Same limit |
| 33 | `storage:capacity` | `unit` | Same tests as #31 | Same limit |
| 34 | `cdn:static-cache` | `unit` | Same tests as #31 | Same limit |
| 35 | `model:inference` | `unit` | Same tests as #31 | Same limit |
| 36 | `model:fine-tuning` | `unit` | Same tests as #31 | Same limit |
| 37 | `data:dataset` | `sandbox` | `tests/licenses.sandbox.test.ts`, `agents/test/license.test.ts` | A license of a file (P7); data license terms; a fake internet serves the file |
| 38 | `model:weights` | `generic` | Generic x402 endpoint path of #31 | No test names this asset type; model license terms |
| 39 | `agent:prompt-workflow` | `generic` | Generic x402 endpoint path of #31 | No test names this asset type |
| 40 | `research:report` | `generic` | Generic x402 endpoint path of #31 | No test names this asset type |
| 41 | `text:translation-summary` | `generic` | Generic x402 endpoint path of #31 | No test names this asset type |
| 42 | `data:annotation` | `generic` | Generic x402 endpoint path of #31 | No test names this asset type |
| 43 | `data:web-crawl` | `generic` | Generic x402 endpoint path of #31 | No test names this asset type; site terms |
| 44 | `oracle:data-feed` | `unit` | Same tests as #31 | Same limit |
| 45 | `iot:sensor-data` | `unit` | Same tests as #31 | Same limit |
| 46 | `x207:keeper-cron` | `generic` | Generic x402 endpoint path of #31 | No test names this asset type |
| 47 | `gas:relayer` | `unit` | Same tests as #31 | Same limit |
| 48 | `x207:solver-routing` | `generic` | Generic x402 endpoint path of #31 | No test names this asset type |
| 49 | `queue:priority-slot` | `unit` | Same tests as #31 | Same limit |
| 50 | `ads:promo-slot` | `generic` | Generic x402 endpoint path of #31 | No test names this asset type |
| 51 | `sales:referral-lead` | `generic` | Generic x402 endpoint path of #31 | No test names this asset type |
| 52 | `code:audit-review` | `generic` | Generic x402 endpoint path of #31 | No test names this asset type |
| 53 | `qa:load-test` | `generic` | Generic x402 endpoint path of #31 | No test names this asset type |
| 54 | `ops:monitoring-alert` | `generic` | Generic x402 endpoint path of #31 | No test names this asset type |
| 55 | `network:proxy-bandwidth` | `unit` | Same tests as #31 | Same limit; local law applies |

### Rows 61 to 90: off-chain digital assets of ordinary people

| # | asset_type | Status | Proof | Limits |
| --- | --- | --- | --- | --- |
| 61 | `ai-credit:api` | `mock` | `tests/proxy-credit-quota.sandbox.test.ts` | Mock model provider; the key stays in the broker |
| 62 | `cloud:credit` | `mock` | `tests/cloud-credit.sandbox.test.ts` | Mock members API of the cloud project; a project membership, the credit is not transferred |
| 63 | `messaging:subaccount` | `mock` | `backend/broker/test/messaging-subaccount.test.ts` | Mock messaging provider |
| 64 | `maps:geocoding-quota` | `mock` | `tests/proxy-credit-quota.sandbox.test.ts` | Mock provider |
| 65 | `hosting:reseller-account` | `mock` | `backend/broker/test/hosting-subaccount.test.ts` | Mock reseller provider |
| 66 | `domain:name` | `mock` | `tests/transfer.sandbox.test.ts` | Mock registrar and registry (DNS and RDAP are faked) |
| 67 | `site:web-property` | `mock` | `tests/site-sale.sandbox.test.ts` | Domain through the transfer ledger with a faked registry, credentials through `secret_release` |
| 68 | `design:template` | `sandbox` | `tests/design-asset.sandbox.test.ts`, `agents/test/license.test.ts` | License of a file; the buyer checks the license text |
| 69 | `creative:licensed-asset` | `sandbox` | `tests/licensed-asset.sandbox.test.ts` | License of a file; a rights holder can take a listing down before payment |
| 70 | `plugin:preset` | `sandbox` | `tests/own-plugin.sandbox.test.ts` | License of a file |
| 71 | `course:own-class` | `sandbox` | `tests/course.sandbox.test.ts` | A fake internet serves the files |
| 72 | `course:gift-code` | `mock` | `tests/codes-course.sandbox.test.ts` | Mock issuer |
| 73 | `ticket:digital-event` | `mock` | `tests/transfer-ticket-item.sandbox.test.ts`, `backend/test/marketplace/transfers.test.ts` | Mock platform; only through the official transfer |
| 74 | `game:key-code` | `mock` | `tests/codes-keys.sandbox.test.ts` | Mock issuer; some publishers forbid resale |
| 75 | `game:tradable-item` | `mock` | `tests/transfer-ticket-item.sandbox.test.ts` | Mock trade offer API; only games that allow trade |
| 76 | `promo:voucher-code` | `mock` | `tests/codes-promo.sandbox.test.ts` | Mock issuer |
| 77 | `giftcard:digital-store` | `mock` | `tests/codes-promo.sandbox.test.ts` | Mock issuer |
| 78 | `telco:airtime-data` | `sandbox` | `tests/delivery-group-e.sandbox.test.ts`, `backend/test/marketplace/delivery-bond.test.ts` | No API: the seller hands it over outside x207 and the receiver confirms with a signed notice; the operator is not involved |
| 79 | `loyalty:transferable-points` | `sandbox` | `tests/delivery-group-e.sandbox.test.ts` | Same; many programs forbid it |
| 80 | `plan:family-or-team-seat` | `sandbox` | `tests/team-seat.sandbox.test.ts` | Same; a plan that needs one fixed household is class X |
| 81 | `storage:shared-folder` | `mock` | `backend/broker/test/cloud-folder-share.test.ts` | Mock storage provider |
| 82 | `content:own-work` | `sandbox` | `tests/own-content.sandbox.test.ts` | File license (P7); a fake internet serves the ciphertext |
| 83 | `service:freelance` | `sandbox` | `tests/freelance.sandbox.test.ts` | Order with two milestones, each handed over with its hash |
| 84 | `service:consultation-slot` | `sandbox` | `tests/consultation-slot.sandbox.test.ts` | Order with one milestone; no calendar service involved |
| 85 | `community:own-paid-group` | `mock` | `tests/community-role.sandbox.test.ts` | Mock Discord server |
| 86 | `newsletter:own-archive` | `mock` | `backend/broker/test/newsletter-reader.test.ts` | Mock publisher API |
| 87 | `beta:invite-code` | `mock` | `tests/codes.sandbox.test.ts` | Mock issuer |
| 88 | `service:product-testing` | `sandbox` | `tests/product-test.sandbox.test.ts` | Order and milestone; the report is the milestone |
| 89 | `data:own-anonymized` | `sandbox` | `tests/own-content.sandbox.test.ts` | File license with a scan of the preview for personal data |
| 90 | `compute:home-device` | `mock` | `agents/test/home-device.test.ts`, `sdk/packages/scheme/test/metered-endpoint.test.ts` | Mock device, no network; a real home device is not connected |

### Refused kinds (class X)

Proof for all nine: `tests/asset-catalog.sandbox.test.ts` (an offer of a class X kind fails with `ERR_ASSET_CLASS_FORBIDDEN`) and `contracts/tests/ct069_asset_class.rs`.

| # | asset_type | Status | Reason |
| --- | --- | --- | --- |
| X1 | `payment:digital-wallet-balance` | `X` | It becomes a regulated money transfer service |
| X2 | `account:game-or-platform` | `X` | Provider terms |
| X3 | `voucher:identity-bound` | `X` | Cannot be handed over |
| X4 | `securities:equity` | `X` | Securities regulation, needs an oracle and liquidation |
| X5 | `subscription:consumer-nonshareable` | `X` | Provider terms |
| X6 | `social:account` | `X` | Provider terms |
| X7 | `pii:third-party-data` | `X` | Data protection law |
| X8 | `token:soulbound` | `X` | Cannot be handed over |
| X9 | `credential:stolen-access` | `X` | Illegal |

## How a row was given its status

1. `X`: the catalog class is `X`.
2. `testnet`: a file of this repository holds the transaction hashes of a delivery of this kind on a NEAR testnet circle.
3. `P1 in progress`: the ADR of contract 0.0.18 names the kind as one of the items #11 to #14.
4. Otherwise a test must name the kind. If it runs in `near-sandbox` and the only simulated parts are token contracts and a fake internet for files, the status is `sandbox`. If a provider, issuer, registrar or platform is simulated, it is `mock`. If only unit tests name it, it is `unit`.
5. If no test names the kind and the catalog says it is built, it is `generic`. If the catalog says it is not built and no code exists, it is `roadmap`.

A kind moves up only when a test or a transaction in the repository shows it. A third-party product named in a row was not checked one by one.
