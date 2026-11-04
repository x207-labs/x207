// UM-114 (#69): a font, a music track, footage or an icon, sold as a license of the file in near-sandbox, on the pattern of UM-088. The license text names the kind (`personal`,
// `commercial`) and states that the licensor holds the rights; x207 cannot prove who holds the copyright, so what protects a buyer is the takedown of a rights holder.
//   - a music track with a `commercial` license is bought after the terms check, opened, confirmed and paid: the pair holds 15 credit;
//   - footage is listed by somebody who does not hold the rights (its terms claim the rights all the same). A buyer pays, the voucher is held by the backend; the real rights holder, a member, files a
//     takedown with a claim and the hash of its evidence: the listing is hidden, the unconfirmed purchase is cancelled, the voucher never reaches the seller, and nothing moves on the chain;
//   - the buyer of the listing cannot file the takedown itself (`takedown_invalid`), and nobody can buy the listing after it.
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { contentHash } from "@x207/core";
import { buyLicense, listLicense, receiveLicense, serveLicense } from "../agents/scenario/license.ts";
import { credit, startLicenseCircle, type LicenseCircle } from "./support/license-circle.ts";
import { sandboxAvailable } from "../sdk/test-support/sandbox.ts";

const text = (s: string) => new TextEncoder().encode(s);
const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
const RIGHTS = "The licensor holds the rights to this work and may license it.";
const termsOf = (kind: string): string => `License: ${kind}. ${RIGHTS} The buyer may use the file in its own projects and may not redistribute it.`;
const acceptsTerms = (listing: { terms: string; detail: string }): boolean => {
  const d = JSON.parse(listing.detail) as { license_id: string; license_hash: string };
  return sha(listing.terms) === d.license_hash && listing.terms.startsWith(`License: ${d.license_id}.`) && listing.terms.includes(RIGHTS);
};
const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "no error";
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};

describe.skipIf(!sandboxAvailable)("UM-114 licensed asset (#69): a licensed track is bought and paid, footage sold without the rights is taken down by the rights holder before the seller is paid", () => {
  let c: LicenseCircle | undefined;
  afterAll(async () => {
    await c?.stop();
  });

  it("TC-UM-114-02 a music track is paid after the terms check; footage without the rights is taken down, its purchase cancelled and nothing is paid", async () => {
    c = await startLicenseCircle(["musician", "reseller", "studio", "holder"]);
    const [musician, reseller, studio, holder] = [c.actor(c.members.musician!), c.actor(c.members.reseller!), c.actor(c.members.studio!), c.actor(c.members.holder!)];
    const expiresAt = Math.floor(Date.now() / 1000) + 86_400;
    const E = c.epoch;

    // --- 1. the track of a musician who holds the rights
    const track = text("track-01.wav: 3 minutes 12 seconds, 48 kHz, stereo");
    const sold = await listLicense(c.book, musician, { plain: track, assetType: "creative:licensed-asset", licenseId: "commercial", nonce: "um114-track", price: credit(15), expiresAt, terms: termsOf("commercial") });
    expect(acceptsTerms(sold.listing)).toBe(true);
    const bought = await buyLicense(c.book, studio, sold, E, { seq: 0, cumulative: "0" });
    const ref = c.publish("track", sold.ciphertext);
    await serveLicense(c.book, musician, bought.purchaseId, sold, ref, studio);
    const received = await receiveLicense(c.book, studio, bought.purchaseId, musician.publicKey, c.sources);
    expect(received).toMatchObject({ outcome: "confirmed", status: "confirmed" });
    expect(contentHash(received.content!)).toBe(sold.doc.content_hash);
    const done = await c.book.get(bought.purchaseId);
    await c.registerOnChain(done.voucher, done.voucherSignature, c.members.musician!);
    await c.catchUp(() => c!.pair(c!.members.studio!, c!.members.musician!) === credit(15));

    // --- 2. footage listed by somebody who does not hold the rights; the studio pays, the voucher is held
    const footage = await listLicense(c.book, reseller, { plain: text("harbour-timelapse.mov: 4K, 90 seconds"), assetType: "creative:licensed-asset", licenseId: "personal", nonce: "um114-footage", price: credit(30), expiresAt, terms: termsOf("personal") });
    const boughtFootage = await buyLicense(c.book, studio, footage, E, { seq: 1, cumulative: credit(15) });
    expect(boughtFootage.status).toBe("paid_held");
    expect((boughtFootage as { voucher?: unknown }).voucher).toBeUndefined();

    // --- the buyer of the listing does not file the takedown (it has the dispute of its purchase); the rights holder does, with the hash of its evidence
    expect(await codeOf(c.book.takedown(footage.listingHash, studio, "I want my money back"))).toBe("takedown_invalid");
    const evidence = sha("registration certificate of the footage, held by the holder");
    const taken = (await c.book.takedown(footage.listingHash, holder, "I shot this footage and I own the rights; the seller has no license from me", evidence)) as { hidden: boolean; cancelledPurchases: number; claimant: string; evidenceHash: string };
    expect(taken).toMatchObject({ hidden: true, cancelledPurchases: 1, claimant: holder.account, evidenceHash: evidence });
    const after = await c.book.get(boughtFootage.purchaseId);
    expect(after.status).toBe("cancelled");
    expect(after.voucher).toBeUndefined();
    expect(c.pair(c.members.studio!, c.members.reseller!)).toBe("0"); // nothing moved for the footage
    expect(c.pair(c.members.studio!, c.members.musician!)).toBe(credit(15));
    // nobody buys the listing after the takedown
    expect(await codeOf(buyLicense(c.book, holder, footage, E, { seq: 0, cumulative: "0" }))).not.toBe("no error");
    console.log(["UM-114 #69", `epoch ${E}`, `track pair ${c.pair(c.members.studio!, c.members.musician!)}`, `footage purchase ${after.status}`, `footage pair ${c.pair(c.members.studio!, c.members.reseller!)}`].join(" | "));
  }, 1_800_000);
});
