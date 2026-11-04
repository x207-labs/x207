// UM-111 (#88): product testing and a written report, in near-sandbox, on the order and milestone flow of UM-087. A maker pays a tester for a test report; the report is the
// milestone. The terms of the job are signed by both parties (their hash is the `spec_hash` of the order) and say that a paid report must state in its first line that it is paid and by whom.
//   - an honest report with that line: the tester hands over its hash, the maker reads the report, finds the disclosure, confirms, signs, and the tester registers the voucher;
//   - a report written to pass as an independent review, without the disclosure line: the maker's check against the signed terms fails, the maker disputes it (`not_as_described`),
//     no voucher is signed, and a confirmation after the dispute is refused. x207 does not police the web; it refuses to pay for a report that breaks the terms both parties signed.
import { afterAll, describe, expect, it } from "vitest";
import { contentHash, type OrderDocument } from "@x207/core";
import { ledgerFor, payMilestone } from "../agents/scenario/services.ts";
import { credit, startOrderCircle, type OrderCircle } from "./support/order-circle.ts";
import { sandboxAvailable } from "../sdk/test-support/sandbox.ts";

const text = (s: string) => new TextEncoder().encode(s);
/** The terms of the job. Both parties sign the order whose `spec_hash` is the hash of these bytes. */
const TERMS = "Test the product for one week and write a report. A paid report must state in its first line: `Disclosure: paid test, commissioned by <maker>`. A report that does not is not accepted.";
/** The maker's check of a report against the terms: the first line carries the disclosure and names the maker. */
const meetsTerms = (report: string, maker: string): boolean => report.split("\n")[0] === `Disclosure: paid test, commissioned by ${maker}`;

describe.skipIf(!sandboxAvailable)("UM-111 product testing (#88): a report with the disclosure of the terms is paid, a disguised paid review is refused", () => {
  let c: OrderCircle | undefined;
  afterAll(async () => {
    await c?.stop();
  });

  it("TC-UM-111-01 a test report that follows the signed terms is paid and registered; a report that hides that it is paid is disputed and nothing is paid", async () => {
    c = await startOrderCircle(["maker", "tester", "shill"]);
    const [maker, tester, shill] = [c.actor(c.members.maker!), c.actor(c.members.tester!), c.actor(c.members.shill!)];
    const nowS = Math.floor(Date.now() / 1000);
    const E = c.epoch;
    const job = (seller: string, nonce: string): OrderDocument => ({
      circle: c!.contract, kind: "freelance", buyer: maker.account, seller, spec_hash: contentHash(text(TERMS)), sample_hash: null, target: null, proof: null, nonce,
      milestones: [{ amount: credit(12), due_at: nowS + 7 * 86_400 }],
    });

    // --- 1. the honest report
    const honest = job(tester.account, "um111-tester");
    const honestHash = await c.book.open(honest, maker, tester);
    expect((await c.book.get(honestHash)).status).toBe("open");
    const report = `Disclosure: paid test, commissioned by ${maker.account}\nWeek of use: the app crashes when the network drops; the export works; setup took 12 minutes.`;
    await c.book.milestone(honestHash, 1, tester, "delivered", { deliverable: contentHash(text(report)) });
    expect(contentHash(text(report))).toBe((await c.book.get(honestHash)).milestones[0]!.deliverableHash);
    expect(meetsTerms(report, maker.account)).toBe(true);
    await c.book.milestone(honestHash, 1, maker, "confirmed");
    const paid = payMilestone(ledgerFor(honest), 1, E, c.pair(c.members.maker!, c.members.tester!, E), maker);
    await c.registerOnChain(paid, c.members.tester!);
    await c.until(async () => (await c!.book.get(honestHash)).milestones[0]!.status === "paid");
    expect(c.pair(c.members.maker!, c.members.tester!, E).cumulativeAmount).toBe(credit(12));

    // --- 2. the disguised review: the same job, a report that reads like an independent review and does not say it is paid
    const disguised = job(shill.account, "um111-shill");
    const disguisedHash = await c.book.open(disguised, maker, shill);
    const review = "5 stars. I bought this myself and I love it, the best app of its kind, everybody should get it.";
    await c.book.milestone(disguisedHash, 1, shill, "delivered", { deliverable: contentHash(text(review)) });
    expect(meetsTerms(review, maker.account)).toBe(false);
    const disputed = await c.book.milestone(disguisedHash, 1, maker, "disputed", { reason: "not_as_described" });
    expect(disputed.milestones[0]).toMatchObject({ status: "disputed", disputeReason: "not_as_described" });
    await expect(c.book.milestone(disguisedHash, 1, maker, "confirmed")).rejects.toThrow();
    expect(c.pair(c.members.maker!, c.members.shill!, E).cumulativeAmount).toBe("0");
    expect(c.pair(c.members.maker!, c.members.tester!, E).cumulativeAmount).toBe(credit(12));
    console.log(["UM-111 #88", `epoch ${E}`, `honest ${(await c.book.get(honestHash)).milestones[0]!.status}`, `disguised ${(await c.book.get(disguisedHash)).milestones[0]!.status}`, `shill pair ${c.pair(c.members.maker!, c.members.shill!, E).cumulativeAmount}`].join(" | "));
  }, 1_800_000);
});
