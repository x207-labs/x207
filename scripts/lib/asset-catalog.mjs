// UM-075: the barter catalog, 90 kinds as data for the registry D10 of the contract (`set_asset_class`).
// `no` is the number of the row in the catalog (`X1` to `X9` for the refused kinds, which have no number there). Rows 61 to 90 are the off-chain digital assets; a row marked "condition" is lawful only when the provider or the law allows it, and its delivery method names the official channel. Class E (debts and invoices, rows 56 to 60) is not an asset of the registry and is left out.
// The nine refused kinds of the catalog are registered as class `X`, so that `offer_grant` for them fails with `ERR_ASSET_CLASS_FORBIDDEN`.
//
// Delivery methods are plain names that the contract only checks to be non-empty and that `offer_grant` must repeat. The names that other parts of the repository
// already use stay: `escrow_nft` (class A, CT-075), `near_access_key` (class B, F8), `proxy` (class C, the broker). New names follow the same style. The
// accepted proofs are among the three kinds of the contract: `rpc_access_key` (the key has the scope), `tee_attestation`, `zktls`.
import { createHash } from "node:crypto";

/** @typedef {{ no: number|string, assetType: string, cls: "A"|"B"|"C"|"D"|"X", name: string, delivery: string[], proofs: string[], status: string }} CatalogEntry */

const NFT = "escrow_nft";
const FT = "escrow_ft"; // CT-090: fungible NEP-141 escrow, not built yet; the registry may hold the name before the contract can deliver it
const MT = "escrow_mt"; // CT-092: multi-token NEP-245 escrow, not built yet
const LOCKER = "escrow_locker"; // roadmap F8: a locker contract for accounts and addresses
const NO_PROOF = [];

/** @type {CatalogEntry[]} */
export const CATALOG = [
  // A. on-chain assets, moved by escrow
  { no: 1, assetType: "nft:nep171", cls: "A", name: "NFT NEP-171", delivery: [NFT], proofs: NO_PROOF, status: "built (CT-075)" },
  { no: 2, assetType: "ticket:event-nft", cls: "A", name: "Event ticket as NFT", delivery: [NFT], proofs: NO_PROOF, status: "built, when the ticket is an NFT" },
  { no: 3, assetType: "game:item-nft", cls: "A", name: "On-chain game item", delivery: [NFT], proofs: NO_PROOF, status: "built, when the item is an NFT" },
  { no: 4, assetType: "coupon:voucher-nft", cls: "A", name: "Store coupon or voucher as NFT", delivery: [NFT], proofs: NO_PROOF, status: "built, when the coupon is an NFT" },
  { no: 5, assetType: "license:software-nft", cls: "A", name: "Software license as NFT", delivery: [NFT], proofs: NO_PROOF, status: "built, when the license is an NFT; license terms apply" },
  { no: 6, assetType: "token:nep141", cls: "A", name: "Fungible token NEP-141", delivery: [FT], proofs: NO_PROOF, status: "item CT-090" },
  { no: 7, assetType: "rwa:tokenized", cls: "A", name: "Tokenized real-world asset", delivery: [FT], proofs: NO_PROOF, status: "items CT-090, CT-091; regulation and recipient whitelist" },
  { no: 8, assetType: "lst:liquid-staking", cls: "A", name: "Liquid staking token", delivery: [FT], proofs: NO_PROOF, status: "item CT-090" },
  { no: 9, assetType: "intents:multi-token", cls: "A", name: "Stablecoin balance in NEAR Intents", delivery: [MT], proofs: NO_PROOF, status: "item CT-092" },
  { no: 10, assetType: "amm:lp-share", cls: "A", name: "Liquidity pool share", delivery: [FT, MT], proofs: NO_PROOF, status: "item CT-092" },
  { no: 11, assetType: "near:named-account", cls: "A", name: "Named NEAR account", delivery: [LOCKER], proofs: NO_PROOF, status: "roadmap F8" },
  { no: 12, assetType: "chain-signatures:derived-address", cls: "A", name: "Address controlled by Chain Signatures", delivery: [LOCKER], proofs: NO_PROOF, status: "roadmap F8" },
  { no: 13, assetType: "vesting:transferable-lockup", cls: "A", name: "Transferable vesting position", delivery: [LOCKER], proofs: NO_PROOF, status: "roadmap; many lockups cannot be moved" },
  { no: 14, assetType: "claim:cross-circle-receivable", cls: "A", name: "Claim on another circle", delivery: ["escrow_claim"], proofs: NO_PROOF, status: "roadmap CT-067 (catalog class A/E, kept as A)" },
  // B. limited access that can be revoked
  { no: 15, assetType: "near-rpc:access", cls: "B", name: "NEAR account access by function-call key", delivery: ["near_access_key"], proofs: ["rpc_access_key"], status: "built (testnet)" },
  { no: 16, assetType: "dao:vote-delegation", cls: "B", name: "DAO voting delegation", delivery: ["dao_delegation"], proofs: ["zktls"], status: "roadmap" },
  { no: 17, assetType: "saas:team-seat", cls: "B", name: "Team seat of a SaaS", delivery: ["seat_invite"], proofs: ["zktls"], status: "built with a mock SCIM service (BE-087, adapter saas-seat-scim); team plan terms" },
  { no: 18, assetType: "git:repo-collaborator", cls: "B", name: "Repository collaborator", delivery: ["repo_collaborator"], proofs: ["zktls"], status: "built with a mock repository host (UM-089: near-sandbox, paid by the day, removed by the grantor)" },
  { no: 19, assetType: "oauth:scoped-token", cls: "B", name: "OAuth token with a narrow scope", delivery: ["oauth_token"], proofs: ["zktls"], status: "built with a mock OAuth provider (BE-083, adapter oauth-scoped); provider terms" },
  { no: 20, assetType: "cloud:temporary-role", cls: "B", name: "Temporary cloud role", delivery: ["cloud_role"], proofs: ["zktls"], status: "built with a mock cloud provider (UM-089: near-sandbox, role with a cost per day, closed by the grantor)" },
  { no: 21, assetType: "storage:signed-url", cls: "B", name: "Signed download URL", delivery: ["signed_url"], proofs: ["zktls"], status: "roadmap" },
  { no: 22, assetType: "ssh:restricted-key", cls: "B", name: "Restricted SSH key", delivery: ["ssh_key"], proofs: ["zktls"], status: "built with a mock server (UM-089: near-sandbox, authorized_keys in memory, checked by what sshd does with the key)" },
  { no: 23, assetType: "database:readonly-user", cls: "B", name: "Read-only database user", delivery: ["db_user"], proofs: ["zktls"], status: "built with a mock SQL client (BE-082, adapter postgres-readonly); not run against a real PostgreSQL" },
  { no: 24, assetType: "community:paid-role", cls: "B", name: "Paid community role", delivery: ["community_role"], proofs: ["zktls"], status: "built (UM-099, adapter discord with a mock server, rent by the day); platform terms" },
  { no: 25, assetType: "org:spend-limited-member", cls: "B", name: "Organisation member with a spending limit", delivery: ["org_member"], proofs: ["zktls"], status: "built with a mock organisation (UM-113, near-sandbox, adapter org-member-budget): invited with a daily budget kept by the organisation, the real spend is shown and billed, removed at the end of the paid day; provider terms" },
  // C. a single secret, through the broker
  { no: 26, assetType: "api:delegated-key", cls: "C", name: "API key that may be delegated", delivery: ["proxy"], proofs: ["tee_attestation"], status: "built with a mock provider; no TEE yet" },
  { no: 27, assetType: "giftcard:code", cls: "C", name: "Gift card code", delivery: ["secret_release"], proofs: ["tee_attestation"], status: "built with a mock issuer (UM-094, near-sandbox): sold once, a used code refused before the handover, paid after the buyer redeems; issuer terms" },
  { no: 28, assetType: "license:key", cls: "C", name: "Software license key", delivery: ["secret_release"], proofs: ["tee_attestation"], status: "built with a mock issuer (UM-100, near-sandbox): checked before and after the handover, paid after activation; a key bound to an account or a region is refused; license terms" },
  { no: 29, assetType: "domain:transfer-code", cls: "C", name: "Domain transfer code", delivery: ["secret_release"], proofs: ["tee_attestation"], status: "built with a mock registrar (UM-095: near-sandbox, the code is handed once outside x207); registrar terms" },
  { no: 30, assetType: "api:quota-proxy", cls: "C", name: "API quota used through the proxy", delivery: ["proxy"], proofs: ["tee_attestation"], status: "built with a mock provider" },
  // D. own resources and services, opened as x402 endpoints
  { no: 31, assetType: "compute:cpu-idle", cls: "D", name: "Idle CPU", delivery: ["x402_endpoint"], proofs: NO_PROOF, status: "built (x402 endpoint)" },
  { no: 32, assetType: "compute:gpu-hours", cls: "D", name: "GPU hours", delivery: ["x402_endpoint"], proofs: NO_PROOF, status: "built" },
  { no: 33, assetType: "storage:capacity", cls: "D", name: "Storage", delivery: ["x402_endpoint"], proofs: NO_PROOF, status: "built" },
  { no: 34, assetType: "cdn:static-cache", cls: "D", name: "Cache and CDN", delivery: ["x402_endpoint"], proofs: NO_PROOF, status: "built" },
  { no: 35, assetType: "model:inference", cls: "D", name: "Inference by the agent's own model", delivery: ["x402_endpoint"], proofs: NO_PROOF, status: "built" },
  { no: 36, assetType: "model:fine-tuning", cls: "D", name: "Fine-tuning", delivery: ["x402_endpoint"], proofs: NO_PROOF, status: "built" },
  { no: 37, assetType: "data:dataset", cls: "D", name: "Dataset", delivery: ["x402_endpoint"], proofs: ["zktls"], status: "built; data license terms" },
  { no: 38, assetType: "model:weights", cls: "D", name: "Model weights", delivery: ["x402_endpoint"], proofs: NO_PROOF, status: "built; model license terms" },
  { no: 39, assetType: "agent:prompt-workflow", cls: "D", name: "Prompt, template or workflow", delivery: ["x402_endpoint"], proofs: NO_PROOF, status: "built" },
  { no: 40, assetType: "research:report", cls: "D", name: "Research and report", delivery: ["x402_endpoint"], proofs: NO_PROOF, status: "built" },
  { no: 41, assetType: "text:translation-summary", cls: "D", name: "Translation and summary", delivery: ["x402_endpoint"], proofs: NO_PROOF, status: "built" },
  { no: 42, assetType: "data:annotation", cls: "D", name: "Data annotation and labelling", delivery: ["x402_endpoint"], proofs: NO_PROOF, status: "built" },
  { no: 43, assetType: "data:web-crawl", cls: "D", name: "Web data collection", delivery: ["x402_endpoint"], proofs: ["zktls"], status: "built; site terms" },
  { no: 44, assetType: "oracle:data-feed", cls: "D", name: "Data feed or oracle", delivery: ["x402_endpoint"], proofs: ["zktls"], status: "built" },
  { no: 45, assetType: "iot:sensor-data", cls: "D", name: "IoT sensor data", delivery: ["x402_endpoint"], proofs: NO_PROOF, status: "built" },
  { no: 46, assetType: "x207:keeper-cron", cls: "D", name: "Keeper or cron service", delivery: ["x402_endpoint"], proofs: NO_PROOF, status: "built" },
  { no: 47, assetType: "gas:relayer", cls: "D", name: "Gas relayer", delivery: ["x402_endpoint"], proofs: NO_PROOF, status: "built" },
  { no: 48, assetType: "x207:solver-routing", cls: "D", name: "Solver or routing service", delivery: ["x402_endpoint"], proofs: NO_PROOF, status: "built" },
  { no: 49, assetType: "queue:priority-slot", cls: "D", name: "Priority queue slot", delivery: ["x402_endpoint"], proofs: NO_PROOF, status: "built" },
  { no: 50, assetType: "ads:promo-slot", cls: "D", name: "Advertising or promotion slot", delivery: ["x402_endpoint"], proofs: NO_PROOF, status: "built" },
  { no: 51, assetType: "sales:referral-lead", cls: "D", name: "Referral and lead", delivery: ["x402_endpoint"], proofs: NO_PROOF, status: "built (seeker share of F9)" },
  { no: 52, assetType: "code:audit-review", cls: "D", name: "Code audit and review", delivery: ["x402_endpoint"], proofs: NO_PROOF, status: "built" },
  { no: 53, assetType: "qa:load-test", cls: "D", name: "Load test or QA", delivery: ["x402_endpoint"], proofs: NO_PROOF, status: "built" },
  { no: 54, assetType: "ops:monitoring-alert", cls: "D", name: "Monitoring and alerts", delivery: ["x402_endpoint"], proofs: NO_PROOF, status: "built" },
  { no: 55, assetType: "network:proxy-bandwidth", cls: "D", name: "Proxy and bandwidth", delivery: ["x402_endpoint"], proofs: NO_PROOF, status: "built; local law applies" },
  // F. off-chain digital assets of ordinary people (rows 61 to 90). Delivery is by confirmation of the receiver and a dispute window (BE-047, CT-093), not atomic.
  { no: 61, assetType: "ai-credit:api", cls: "C", name: "Credit of an AI model API", delivery: ["proxy"], proofs: ["tee_attestation"], status: "built with a mock provider (UM-109, near-sandbox): the key stays in the broker, one unit of the quota per paid call, a failed call is not paid, a used-up quota is refused before the provider; condition: many providers forbid sharing a key, a managed proxy must be allowed" },
  { no: 62, assetType: "cloud:credit", cls: "B", name: "Cloud promotional credit", delivery: ["project_member"], proofs: ["zktls"], status: "built as a project membership (UM-115, near-sandbox): the grantor invites a person to a cloud project with a daily budget that the provider keeps; the credit itself is not transferred. Lawful only when the provider allows it: promotional credit is usually not transferable" },
  { no: 63, assetType: "messaging:subaccount", cls: "B", name: "Messaging sub-account (SMS or email quota)", delivery: ["subaccount"], proofs: ["zktls"], status: "built with a mock messaging provider (BE-085, adapter messaging-subaccount); condition: provider with sub-accounts" },
  { no: 64, assetType: "maps:geocoding-quota", cls: "C", name: "Map and geocoding API quota", delivery: ["proxy"], proofs: ["tee_attestation"], status: "built with a mock provider (UM-109, near-sandbox): the key stays in the broker in its own header, one unit of the quota per paid call, a used-up quota is refused before the provider; condition: the terms of the map provider must allow a shared quota" },
  { no: 65, assetType: "hosting:reseller-account", cls: "B", name: "Hosting or VPS account under a reseller plan", delivery: ["derived_account"], proofs: ["zktls"], status: "built with a mock reseller provider (BE-086, adapter hosting-subaccount); lawful under a reseller plan" },
  { no: 66, assetType: "domain:name", cls: "C", name: "Domain name", delivery: ["secret_release"], proofs: ["tee_attestation"], status: "built with a mock registrar (UM-095: near-sandbox, paid only after the registry proof); lawful, registrar transfer is common" },
  { no: 67, assetType: "site:web-property", cls: "C", name: "Website, app or online shop", delivery: ["admin_credentials"], proofs: ["tee_attestation"], status: "built (UM-098): sold as two parts, the domain through the transfer ledger and the admin credentials once through secret_release (capped at 20 credit); the single asset type stays roadmap_only; lawful, selling a site is common" },
  { no: 68, assetType: "design:template", cls: "D", name: "Template and design asset", delivery: ["licensed_download"], proofs: [], status: "built (UM-114, near-sandbox): a license of the file whose text names the kind and states that the licensor holds the rights; the buyer checks the text before it pays; a stock license kind is refused at posting" },
  { no: 69, assetType: "creative:licensed-asset", cls: "D", name: "Licensed font, music, footage or icon", delivery: ["licensed_download"], proofs: [], status: "built (UM-114, near-sandbox): a license of the file with terms that state the rights; a rights holder takes a listing down before the seller is paid, the unconfirmed purchase is cancelled and no voucher reaches the seller" },
  { no: 70, assetType: "plugin:preset", cls: "D", name: "Own preset or plugin", delivery: ["download"], proofs: [], status: "built (UM-115, near-sandbox): a license of the file; the kind of license from the accepted list of the backend says whether the buyer may sell it on; lawful when made by the giver" },
  { no: 71, assetType: "course:own-class", cls: "D", name: "Own online course", delivery: ["x402_endpoint"], proofs: [], status: "built (UM-111, near-sandbox): the course package is sold as a license with the hash it promised; the lesson endpoint of the seller serves the buyer for a term and answers 410 after it" },
  { no: 72, assetType: "course:gift-code", cls: "C", name: "Course gift code from a platform", delivery: ["secret_release"], proofs: ["tee_attestation"], status: "built with a mock issuer (UM-113, near-sandbox): sold once, a redeemed or voided code refused before the handover, paid after the buyer redeems; condition: platform" },
  { no: 73, assetType: "ticket:digital-event", cls: "C", name: "Digital event ticket with an official transfer feature", delivery: ["platform_transfer"], proofs: ["zktls"], status: "built (UM-096, platform_transfer with a mock platform); condition: only through the official transfer" },
  { no: 74, assetType: "game:key-code", cls: "C", name: "Game code or activation key", delivery: ["secret_release"], proofs: ["tee_attestation"], status: "built with a mock issuer (UM-100, near-sandbox): checked before and after the handover, paid after activation; a key bound to an account or a region is refused; condition: some publishers forbid resale" },
  { no: 75, assetType: "game:tradable-item", cls: "C", name: "Game item through the official trade system", delivery: ["game_trade"], proofs: ["zktls"], status: "built (UM-096, platform_transfer with a mock Steam trade offer API); condition: only games that allow trade" },
  { no: 76, assetType: "promo:voucher-code", cls: "C", name: "Voucher and promo code", delivery: ["secret_release"], proofs: ["tee_attestation"], status: "built with a mock issuer (UM-101, near-sandbox): the end date is checked at the issuer before the handover and an expired code is refused; paid after the buyer redeems; condition: personal codes are usually not transferable" },
  { no: 77, assetType: "giftcard:digital-store", cls: "C", name: "Digital store gift card", delivery: ["secret_release"], proofs: ["tee_attestation"], status: "built with a mock issuer (UM-101, near-sandbox): the balance is checked at the issuer before the handover and an empty card is refused; paid after the buyer spends it; condition: issuer (same as row 27)" },
  { no: 78, assetType: "telco:airtime-data", cls: "B", name: "Mobile airtime and data allowance", delivery: ["carrier_transfer"], proofs: ["zktls"], status: "built (UM-097, BE-047 handover with the confirmation of the receiver, no API); condition: only carriers with a transfer feature" },
  { no: 79, assetType: "loyalty:transferable-points", cls: "B", name: "Transferable loyalty points", delivery: ["program_transfer"], proofs: ["zktls"], status: "built (UM-097, BE-047 handover with the confirmation of the receiver, no API); condition: many programs forbid it" },
  { no: 80, assetType: "plan:family-or-team-seat", cls: "B", name: "Seat of a family or team plan that allows members outside the household", delivery: ["member_invite"], proofs: ["zktls"], status: "built (UM-098, BE-047 handover with the confirmation of the receiver, no API); condition: a plan that needs one fixed household is class X" },
  { no: 81, assetType: "storage:shared-folder", cls: "B", name: "Shared cloud folder with a quota", delivery: ["folder_invite"], proofs: ["zktls"], status: "built with a mock storage provider (BE-084, adapter cloud-folder-share); lawful to share the content, not to sell an account" },
  { no: 82, assetType: "content:own-work", cls: "D", name: "Own article, photo, video or design", delivery: ["file_handover"], proofs: [], status: "built (UM-110, file license P7: hash checked by the buyer, exclusive license, voucher held until confirmation); lawful when made by the giver" },
  { no: 83, assetType: "service:freelance", cls: "D", name: "Freelance service", delivery: ["x402_endpoint"], proofs: [], status: "built (UM-108, near-sandbox): an order of two milestones; each file is handed over with its hash, checked by the client, confirmed and paid in turn" },
  { no: 84, assetType: "service:consultation-slot", cls: "D", name: "Consultation or mentoring time", delivery: ["calendar_slot"], proofs: [], status: "built (UM-108, near-sandbox): a slot is an order with one milestone due when the slot ends; attended and confirmed it is paid, a no-show is cancelled by the buyer after the due date and pays nothing" },
  { no: 85, assetType: "community:own-paid-group", cls: "B", name: "Own paid group or community", delivery: ["invite_or_role"], proofs: ["zktls"], status: "built (UM-099, adapter discord with a mock server, rent by the day); lawful for the owner of the community" },
  { no: 86, assetType: "newsletter:own-archive", cls: "B", name: "Own newsletter or paid content", delivery: ["reader_account"], proofs: ["zktls"], status: "built with a mock publisher API (BE-088, adapter newsletter-reader); lawful for the publisher" },
  { no: 87, assetType: "beta:invite-code", cls: "C", name: "Beta invitation code", delivery: ["secret_release"], proofs: ["tee_attestation"], status: "built with a mock issuer (UM-094, near-sandbox): sold once, a used code refused before the handover, paid after the buyer redeems; condition: product" },
  { no: 88, assetType: "service:product-testing", cls: "D", name: "Product testing and report", delivery: ["x402_endpoint"], proofs: [], status: "built (UM-111, near-sandbox): the test report is a milestone of an order; the signed terms require the disclosure that it is paid, and a report that hides it is disputed and not paid" },
  { no: 89, assetType: "data:own-anonymized", cls: "D", name: "Own anonymised data", delivery: ["consented_download"], proofs: [], status: "built (UM-110, file license P7 with the scan of the preview for personal data); lawful for one\'s own, anonymised data only" },
  { no: 90, assetType: "compute:home-device", cls: "D", name: "Idle home device for computing", delivery: ["x402_endpoint"], proofs: [], status: "built with a mock device (AG-049, no network): minutes prepaid in slices of 30 so an offline device costs at most one slice, plus a day lease; a real home device is not connected; lawful; power and security are the owner's" },
  // X. refused
  { no: "X1", assetType: "payment:digital-wallet-balance", cls: "X", name: "Airtime or digital wallet balance as a general means of payment", delivery: ["none"], proofs: [], status: "refused: it becomes a regulated money transfer service" },
  { no: "X2", assetType: "account:game-or-platform", cls: "X", name: "Whole game or platform account", delivery: ["none"], proofs: [], status: "refused: provider terms" },
  { no: "X3", assetType: "voucher:identity-bound", cls: "X", name: "Code or voucher bound to the identity of its owner", delivery: ["none"], proofs: [], status: "refused: cannot be handed over" },
  { no: "X4", assetType: "securities:equity", cls: "X", name: "Shares and securities, also conditional shares", delivery: ["none"], proofs: NO_PROOF, status: "refused: securities regulation, needs an oracle and liquidation" },
  { no: "X5", assetType: "subscription:consumer-nonshareable", cls: "X", name: "Consumer subscription that forbids sharing", delivery: ["none"], proofs: NO_PROOF, status: "refused: provider terms" },
  { no: "X6", assetType: "social:account", cls: "X", name: "Social media account", delivery: ["none"], proofs: NO_PROOF, status: "refused: provider terms" },
  { no: "X7", assetType: "pii:third-party-data", cls: "X", name: "Personal data of third parties", delivery: ["none"], proofs: NO_PROOF, status: "refused: data protection law" },
  { no: "X8", assetType: "token:soulbound", cls: "X", name: "Token that cannot be transferred (SBT)", delivery: ["none"], proofs: NO_PROOF, status: "refused: cannot be handed over" },
  { no: "X9", assetType: "credential:stolen-access", cls: "X", name: "Stolen credentials or access without permission", delivery: ["none"], proofs: NO_PROOF, status: "refused: illegal" },
];

/** Same rule as `valid_asset_type` in the contract: two parts of `[a-z0-9._-]`, 1 to 64 bytes each, one colon. */
export function validAssetType(text) {
  const part = /^[a-z0-9._-]{1,64}$/;
  const pieces = text.split(":");
  return pieces.length === 2 && part.test(pieces[0]) && part.test(pieces[1]);
}

/**
 * `terms_hash` of an entry: sha256 of a fixed text that names the entry. It identifies the catalog line, not a legal terms document; a real provider replaces it
 * with the hash of its own terms through `set_asset_class` (the owner may write a known `asset_type` again).
 */
export function termsHashOf(entry) {
  return createHash("sha256").update(`x207 asset class v1\n${entry.assetType}\n${entry.cls}\n${entry.name}\n`).digest("hex");
}

/** The argument of `set_asset_class` for a catalog entry. */
export function toArgs(entry) {
  const body = {
    asset_type: entry.assetType,
    class: entry.cls,
    delivery_methods: [...entry.delivery],
    accepted_proofs: [...entry.proofs],
    terms_hash: termsHashOf(entry),
  };
  return { asset_type: entry.assetType, entry: body };
}

const sameEntry = (a, b) =>
  a && b && a.asset_type === b.asset_type && a.class === b.class && a.terms_hash === b.terms_hash &&
  JSON.stringify(a.delivery_methods) === JSON.stringify(b.delivery_methods) && JSON.stringify(a.accepted_proofs) === JSON.stringify(b.accepted_proofs);

/**
 * Registers the catalog and checks the registry afterwards. Idempotent: an entry that the registry already holds, equal to the catalog, is not written again.
 * @param {object} o
 * @param {(method: string, args: object) => Promise<any>} o.view view of the contract
 * @param {(call: { methodName: string, args: object }) => Promise<string>} o.send signs and sends as the owner, returns the hash
 * @param {(entry: object) => void} [o.log]
 * @param {boolean} [o.dryRun] only say what would be written
 * @param {CatalogEntry[]} [o.catalog]
 */
export async function registerCatalog({ view, send, log = () => {}, dryRun = false, catalog = CATALOG }) {
  const existing = new Map();
  for (let from = 0; ; from += 50) {
    const page = (await view("list_asset_classes", { from_index: from, limit: 50 })) ?? [];
    for (const e of page) existing.set(e.asset_type, e);
    if (page.length < 50) break;
  }
  const written = [];
  const skipped = [];
  for (const entry of catalog) {
    const args = toArgs(entry);
    if (sameEntry(existing.get(entry.assetType), args.entry)) {
      skipped.push(entry.assetType);
      continue;
    }
    if (dryRun) {
      written.push({ assetType: entry.assetType, class: entry.cls, hash: null });
      continue;
    }
    const hash = await send({ methodName: "set_asset_class", args });
    written.push({ assetType: entry.assetType, class: entry.cls, hash });
    log({ method: "set_asset_class", assetType: entry.assetType, class: entry.cls, hash });
  }
  if (dryRun) return { written, skipped, missing: [], wrong: [] };
  // the registry must now return every entry of the catalog with its class
  const after = new Map();
  for (let from = 0; ; from += 50) {
    const page = (await view("list_asset_classes", { from_index: from, limit: 50 })) ?? [];
    for (const e of page) after.set(e.asset_type, e);
    if (page.length < 50) break;
  }
  const missing = catalog.filter((e) => !after.has(e.assetType)).map((e) => e.assetType);
  const wrong = catalog.filter((e) => after.has(e.assetType) && !sameEntry(after.get(e.assetType), toArgs(e).entry)).map((e) => e.assetType);
  return { written, skipped, missing, wrong, total: after.size };
}
