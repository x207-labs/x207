// UM-115 (#70): an own preset or plugin, sold as a license of the file in near-sandbox, on the pattern of UM-114. The author made it and keeps the rights. Two kinds of license from the
// accepted list of the backend decide what the buyer may do with it, and the buyer reads that from the list, not from the seller's words:
//   - a preset under `own-work` (the seller made it and keeps the rights): the buyer may use it, and may not sell it on;
//   - a plugin under `commercial-redistribute`: the buyer may sell it on, and the backend list says so;
//   both are checked by the buyer before it pays (hash of the text, kind, statement of rights), opened, confirmed and paid in turn, the second voucher continuing from the first.
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { contentHash } from "@x207/core";
import { DEFAULT_LICENSE_IDS } from "../backend/src/marketplace/purchases.ts";
import { buyLicense, listLicense, receiveLicense, serveLicense } from "../agents/scenario/license.ts";
import { credit, startLicenseCircle, type LicenseCircle } from "./support/license-circle.ts";
import { sandboxAvailable } from "../sdk/test-support/sandbox.ts";

const text = (s: string) => new TextEncoder().encode(s);
const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
const RIGHTS = "The licensor made this work and holds the rights to it.";
const termsOf = (kind: string, resale: string): string => `License: ${kind}. ${RIGHTS} ${resale}`;
const acceptsTerms = (listing: { terms: string; detail: string }): boolean => {
  const d = JSON.parse(listing.detail) as { license_id: string; license_hash: string };
  return sha(listing.terms) === d.license_hash && listing.terms.startsWith(`License: ${d.license_id}.`) && listing.terms.includes(RIGHTS);
};
/** Whether the buyer may sell the file on: read from the accepted list of the backend, not from the text of the seller. */
const mayResell = (kind: string): boolean => DEFAULT_LICENSE_IDS.find((i) => i.id === kind)?.redistribute === true;

describe.skipIf(!sandboxAvailable)("UM-115 own preset and plugin (#70): the license kind decides whether the buyer may sell it on, both are checked, bought and paid", () => {
  let c: LicenseCircle | undefined;
  afterAll(async () => {
    await c?.stop();
  });

  it("TC-UM-115-01 a preset under own-work and a plugin under commercial-redistribute are bought after the terms check and paid in turn; the list of the backend says which one may be sold on", async () => {
    c = await startLicenseCircle(["author", "buyer"]);
    const [author, buyer] = [c.actor(c.members.author!), c.actor(c.members.buyer!)];
    const expiresAt = Math.floor(Date.now() / 1000) + 86_400;
    const E = c.epoch;
    const pairNow = () => c!.pair(c!.members.buyer!, c!.members.author!);
    const sell = async (name: string, plain: Uint8Array, kind: string, resale: string, price: number, state: { seq: number; cumulative: string }) => {
      const sold = await listLicense(c!.book, author, { plain, assetType: "plugin:preset", licenseId: kind, nonce: `um115-${name}`, price: credit(price), expiresAt, terms: termsOf(kind, resale) });
      expect(acceptsTerms(sold.listing)).toBe(true);
      const bought = await buyLicense(c!.book, buyer, sold, E, state);
      expect(bought.status).toBe("paid_held");
      await serveLicense(c!.book, author, bought.purchaseId, sold, c!.publish(name, sold.ciphertext), buyer);
      const received = await receiveLicense(c!.book, buyer, bought.purchaseId, author.publicKey, c!.sources);
      expect(received).toMatchObject({ outcome: "confirmed", status: "confirmed" });
      expect(contentHash(received.content!)).toBe(sold.doc.content_hash);
      const done = await c!.book.get(bought.purchaseId);
      await c!.registerOnChain(done.voucher, done.voucherSignature, c!.members.author!);
      return { sold, done };
    };

    // --- 1. a preset under own-work: the buyer uses it and may not sell it on
    const preset = await sell("preset", text("grade-warm.cube: a colour grade preset, 33 point lut"), "own-work", "The buyer may use it in its own work and may not sell it on.", 6, { seq: 0, cumulative: "0" });
    expect(mayResell("own-work")).toBe(false);
    await c.catchUp(() => pairNow() === credit(6));

    // --- 2. a plugin under commercial-redistribute: the buyer may sell it on; the second voucher continues from the first
    const plugin = await sell("plugin", text("export-helper-1.2.0.zip: a plugin that batches exports"), "commercial-redistribute", "The buyer may sell the plugin on, in whole.", 14, { seq: 1, cumulative: credit(6) });
    expect(mayResell("commercial-redistribute")).toBe(true);
    expect(plugin.done.voucher).toMatchObject({ cumulativeAmount: credit(20), payer: buyer.account, payee: author.account });
    await c.catchUp(() => pairNow() === credit(20));
    expect(preset.done.voucher).toMatchObject({ cumulativeAmount: credit(6) });
    console.log(["UM-115 #70", `epoch ${E}`, `pair ${pairNow()}`, "own-work resale no", "commercial-redistribute resale yes"].join(" | "));
  }, 1_800_000);
});
