// UM-108 (#83): a freelance service in near-sandbox, on the order and milestone flow of UM-087. A client hires a freelancer for a job in two milestones; each milestone is a file that
// the freelancer hands over with its hash.
//   - the order is opened by both signatures; the freelancer delivers file 1 with its hash, the client checks the hash of the file it received against the hash in the book, confirms,
//     signs the voucher of that milestone, and the freelancer registers it: the pair holds 30 credit;
//   - milestone 2 is delivered, checked and confirmed the same way, and its voucher continues from the first (seq 2, cumulative 50): the pair holds 50 credit;
//   - a copy that was changed on the way has another hash than the one in the book, so the client would not confirm it; nothing moves for a milestone that is not confirmed.
import { afterAll, describe, expect, it } from "vitest";
import { contentHash, type OrderDocument } from "@x207/core";
import { hashOf, ledgerFor, payMilestone } from "../agents/scenario/services.ts";
import { credit, startOrderCircle, type OrderCircle } from "./support/order-circle.ts";
import { sandboxAvailable } from "../sdk/test-support/sandbox.ts";

const text = (s: string) => new TextEncoder().encode(s);

describe.skipIf(!sandboxAvailable)("UM-108 freelance service (#83): two milestones, each a file handed over with its hash and paid only after the client confirms it", () => {
  let c: OrderCircle | undefined;
  afterAll(async () => {
    await c?.stop();
  });

  it("TC-UM-108-01 each milestone is paid and registered after the client checked the hash of the file and confirmed; an unconfirmed milestone moves nothing", async () => {
    c = await startOrderCircle(["client", "freelancer"]);
    const [client, freelancer] = [c.actor(c.members.client!), c.actor(c.members.freelancer!)];
    const nowS = Math.floor(Date.now() / 1000);
    const job: OrderDocument = {
      circle: c.contract, kind: "freelance", buyer: client.account, seller: freelancer.account, spec_hash: hashOf("a"), sample_hash: null, target: null, proof: null, nonce: "um108-freelance",
      milestones: [{ amount: credit(30), due_at: nowS + 86_400 }, { amount: credit(20), due_at: nowS + 2 * 86_400 }],
    };
    const hash = await c.book.open(job, client, freelancer);
    expect((await c.book.get(hash)).status).toBe("open");
    const ledger = ledgerFor(job);
    const E = c.epoch;
    const pairNow = () => c!.pair(c!.members.client!, c!.members.freelancer!, E);

    // --- milestone 1: the freelancer hands over a file and its hash; the client hashes the file it received and compares
    const file1 = text("logo-v1.svg: the first milestone, the brand mark in three sizes");
    await c.book.milestone(hash, 1, freelancer, "delivered", { deliverable: contentHash(file1) });
    const delivered1 = (await c.book.get(hash)).milestones[0]!;
    expect(delivered1.status).toBe("delivered");
    expect(contentHash(file1)).toBe(delivered1.deliverableHash);
    // a copy that was changed on the way does not match the hash in the book
    expect(contentHash(text("logo-v1.svg: changed on the way"))).not.toBe(delivered1.deliverableHash);
    // nothing is registered before the client confirms
    expect(pairNow().cumulativeAmount).toBe("0");
    expect((await c.book.milestone(hash, 1, client, "confirmed")).milestones[0]!.status).toBe("confirmed");
    const paid1 = payMilestone(ledger, 1, E, pairNow(), client);
    expect(paid1.cumulativeAmount).toBe(credit(30));
    await c.registerOnChain(paid1, c.members.freelancer!);
    await c.until(async () => (await c!.book.get(hash)).milestones[0]!.status === "paid");
    expect(pairNow().cumulativeAmount).toBe(credit(30));

    // --- milestone 2: the same steps, and its voucher continues from the first
    const file2 = text("site.zip: the second milestone, the landing page with its source");
    await c.book.milestone(hash, 2, freelancer, "delivered", { deliverable: contentHash(file2) });
    expect(contentHash(file2)).toBe((await c.book.get(hash)).milestones[1]!.deliverableHash);
    expect(pairNow().cumulativeAmount).toBe(credit(30)); // delivered is not paid
    await c.book.milestone(hash, 2, client, "confirmed");
    const paid2 = payMilestone(ledger, 2, E, pairNow(), client);
    expect(paid2.seq).toBeGreaterThan(paid1.seq);
    await c.registerOnChain(paid2, c.members.freelancer!);
    await c.until(async () => (await c!.book.get(hash)).milestones[1]!.status === "paid");
    expect(pairNow().cumulativeAmount).toBe(credit(50));
    console.log(["UM-108 #83", `epoch ${E}`, `milestones ${(await c.book.get(hash)).milestones.map((m) => m.status).join(",")}`, `pair ${pairNow().cumulativeAmount}`].join(" | "));
  }, 1_800_000);
});
