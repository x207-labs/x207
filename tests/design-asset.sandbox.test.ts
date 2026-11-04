// UM-114 (#68): a design template, sold as a license of the file in near-sandbox, on the pattern of UM-088. The license text is part of the listing: its sha256 is the `license_hash`, it names
// the kind of license (`commercial`, from the accepted list of the backend) and states that the licensor holds the rights.
//   - the buyer reads the terms from the listing and checks three things before it pays: the hash of the text is the `license_hash`, the kind in the text is the `license_id` of the
//     listing, and the text says that the licensor holds the rights; then it buys, the seller posts the ciphertext and releases the key, the buyer opens the template, checks the content
//     hash, confirms, and the seller registers the voucher: the pair holds 25 credit;
//   - a listing whose terms do not say that the licensor holds the rights is not bought: the buyer's check fails and nothing is paid;
//   - a listing with a license kind that is not on the list of the backend (a stock license) is refused when it is posted, `license_id_rejected`.
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { contentHash } from "@x207/core";
import { buyLicense, listLicense, receiveLicense, serveLicense } from "../agents/scenario/license.ts";
import { credit, startLicenseCircle, type LicenseCircle } from "./support/license-circle.ts";
import { sandboxAvailable } from "../sdk/test-support/sandbox.ts";

const text = (s: string) => new TextEncoder().encode(s);
const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
const RIGHTS = "The licensor holds the rights to this work and may license it.";
const termsOf = (kind: string, rights: boolean): string => `License: ${kind}. ${rights ? RIGHTS : "No statement about the rights."} The buyer may use the template in its own commercial projects and may not resell it.`;
/** The buyer's check of a license listing before it pays: the text hashes to the `license_hash`, names the kind of the listing, and states the rights. */
const acceptsTerms = (listing: { terms: string; detail: string }): boolean => {
  const d = JSON.parse(listing.detail) as { license_id: string; license_hash: string };
  return sha(listing.terms) === d.license_hash && listing.terms.startsWith(`License: ${d.license_id}.`) && listing.terms.includes(RIGHTS);
};

describe.skipIf(!sandboxAvailable)("UM-114 design template (#68): a license with the kind and the statement of rights is bought and paid, a listing without the statement is not bought", () => {
  let c: LicenseCircle | undefined;
  afterAll(async () => {
    await c?.stop();
  });

  it("TC-UM-114-01 the template is bought after the terms check, opened, confirmed and paid; terms without the statement of rights stop the buyer; a stock license kind is refused at posting", async () => {
    c = await startLicenseCircle(["designer", "studio"]);
    const [designer, studio] = [c.actor(c.members.designer!), c.actor(c.members.studio!)];
    const expiresAt = Math.floor(Date.now() / 1000) + 86_400;
    const E = c.epoch;
    const pairNow = () => c!.pair(c!.members.studio!, c!.members.designer!);

    // --- 1. the template with a license that names its kind and states the rights
    const plain = text("template-pack.fig: 24 screens, 3 themes, 120 components");
    const sold = await listLicense(c.book, designer, { plain, assetType: "design:template", licenseId: "commercial", nonce: "um114-template", price: credit(25), expiresAt, terms: termsOf("commercial", true) });
    expect(acceptsTerms(sold.listing)).toBe(true);
    expect(sold.doc.license_id).toBe("commercial");
    const bought = await buyLicense(c.book, studio, sold, E, { seq: 0, cumulative: "0" });
    expect(bought.status).toBe("paid_held");
    const ref = c.publish("template", sold.ciphertext);
    expect((await serveLicense(c.book, designer, bought.purchaseId, sold, ref, studio)).status).toBe("key_released");
    const received = await receiveLicense(c.book, studio, bought.purchaseId, designer.publicKey, c.sources);
    expect(received).toMatchObject({ outcome: "confirmed", status: "confirmed" });
    expect(contentHash(received.content!)).toBe(sold.doc.content_hash);
    const done = await c.book.get(bought.purchaseId);
    expect(done.voucher).toMatchObject({ payer: studio.account, payee: designer.account, cumulativeAmount: credit(25), epoch: E });
    await c.registerOnChain(done.voucher, done.voucherSignature, c.members.designer!);
    await c.catchUp(() => pairNow() === credit(25));

    // --- 2. terms without the statement of rights: the listing is posted (the backend does not read the text), the buyer's check fails, the buyer does not buy
    const vague = await listLicense(c.book, designer, { plain: text("icon-set.fig"), assetType: "design:template", licenseId: "commercial", nonce: "um114-vague", price: credit(10), expiresAt, terms: termsOf("commercial", false) });
    expect(acceptsTerms(vague.listing)).toBe(false);
    expect(pairNow()).toBe(credit(25)); // the studio did not pay for it

    // --- 3. a license kind that is not on the list of the backend
    await expect(listLicense(c.book, designer, { plain: text("stock.fig"), assetType: "design:template", licenseId: "stock-standard", nonce: "um114-stock", price: credit(10), expiresAt, terms: termsOf("stock-standard", true) }))
      .rejects.toMatchObject({ code: "license_id_rejected" });
    console.log(["UM-114 #68", `epoch ${E}`, `pair ${pairNow()}`, "vague terms not bought", "stock kind rejected"].join(" | "));
  }, 1_800_000);
});
