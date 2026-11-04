// UM-108 (#84): consultation or mentoring slots in near-sandbox, on the order and milestone flow of UM-087. A slot is an order with one milestone: the spec names the calendar slot
// (start, end, topic), the milestone falls due when the slot ends.
//   - a slot that took place: the mentor hands over the record of the session (its hash), the learner confirms that the session was attended, signs the voucher, and the mentor
//     registers it: the pair holds 8 credit;
//   - a slot where the mentor did not show: nothing is delivered, the due date passes, the learner cancels the open milestone (only possible after the due date), no voucher is signed,
//     and the pair keeps the 8 credit of the first slot only;
//   - a slot that is not due yet cannot be cancelled by the learner, and a delivered record is not a payment until the learner confirms it.
import { afterAll, describe, expect, it } from "vitest";
import { contentHash, type OrderDocument } from "@x207/core";
import { ledgerFor, payMilestone } from "../agents/scenario/services.ts";
import { credit, startOrderCircle, type OrderCircle } from "./support/order-circle.ts";
import { sandboxAvailable } from "../sdk/test-support/sandbox.ts";

const text = (s: string) => new TextEncoder().encode(s);
/** The spec of a slot: the hash of its calendar entry, the same bytes on both sides. */
const slotSpec = (start: number, end: number, topic: string): string => contentHash(text(JSON.stringify({ start, end, topic })));

describe.skipIf(!sandboxAvailable)("UM-108 consultation slot (#84): a slot that was attended is paid after the buyer confirms, a no-show of the seller is not paid", () => {
  let c: OrderCircle | undefined;
  afterAll(async () => {
    await c?.stop();
  });

  it("TC-UM-108-02 an attended slot is paid and registered; a slot where the mentor did not show is cancelled by the learner and nothing is paid", async () => {
    c = await startOrderCircle(["learner", "mentor"]);
    const [learner, mentor] = [c.actor(c.members.learner!), c.actor(c.members.mentor!)];
    const nowS = Math.floor(Date.now() / 1000);
    const E = c.epoch;
    const pairNow = () => c!.pair(c!.members.learner!, c!.members.mentor!, E);
    const slot = (name: string, start: number, end: number): OrderDocument => ({
      circle: c!.contract, kind: "freelance", buyer: learner.account, seller: mentor.account, spec_hash: slotSpec(start, end, name), sample_hash: null, target: null, proof: null, nonce: `um108-${name}`,
      milestones: [{ amount: credit(8), due_at: end }],
    });

    // --- 1. the slot of tomorrow: attended
    const attended = slot("attended", nowS + 86_400, nowS + 86_400 + 3_600);
    const attendedHash = await c.book.open(attended, learner, mentor);
    expect((await c.book.get(attendedHash)).status).toBe("open");
    const record = text("session record: the call took place, topics: pricing, first hire");
    await c.book.milestone(attendedHash, 1, mentor, "delivered", { deliverable: contentHash(record) });
    expect((await c.book.get(attendedHash)).milestones[0]!.status).toBe("delivered");
    expect(pairNow().cumulativeAmount).toBe("0"); // delivered is not paid
    await c.book.milestone(attendedHash, 1, learner, "confirmed");
    const paid = payMilestone(ledgerFor(attended), 1, E, pairNow(), learner);
    expect(paid.cumulativeAmount).toBe(credit(8));
    await c.registerOnChain(paid, c.members.mentor!);
    await c.until(async () => (await c!.book.get(attendedHash)).milestones[0]!.status === "paid");
    expect(pairNow().cumulativeAmount).toBe(credit(8));

    // --- 2. a slot of yesterday: the mentor did not show. The learner cannot cancel before the due date, and can after it.
    const missed = slot("missed", nowS - 7_200, nowS - 3_600);
    const missedHash = await c.book.open(missed, learner, mentor);
    expect((await c.book.get(missedHash)).milestones[0]!.status).toBe("open");
    await expect(c.book.milestone(missedHash, 1, learner, "confirmed")).rejects.toThrow(); // nothing was delivered, nothing to confirm
    const cancelled = await c.book.milestone(missedHash, 1, learner, "cancelled");
    expect(cancelled.milestones[0]!.status).toBe("cancelled");
    await expect(c.book.milestone(missedHash, 1, mentor, "delivered", { deliverable: contentHash(record) })).rejects.toThrow(); // a late record does not revive it
    expect(pairNow().cumulativeAmount).toBe(credit(8)); // no voucher for the missed slot

    // --- 3. a slot that is not due yet cannot be cancelled by the learner, so the learner cannot walk away from a slot that may still take place
    const later = slot("later", nowS + 2 * 86_400, nowS + 2 * 86_400 + 3_600);
    const laterHash = await c.book.open(later, learner, mentor);
    await expect(c.book.milestone(laterHash, 1, learner, "cancelled")).rejects.toThrow();
    expect((await c.book.get(laterHash)).milestones[0]!.status).toBe("open");
    console.log(["UM-108 #84", `epoch ${E}`, `attended ${(await c.book.get(attendedHash)).milestones[0]!.status}`, `missed ${(await c.book.get(missedHash)).milestones[0]!.status}`, `pair ${pairNow().cumulativeAmount}`].join(" | "));
  }, 1_800_000);
});
