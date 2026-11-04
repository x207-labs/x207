// UM-097: delivery of a thing that has no API (P2 group E, ADR-47 point 7: airtime and data allowance #78, loyalty points #79) in near-sandbox. The seller hands it over once, with the transfer feature of
// the operator or the program, outside x207; the receiver confirms with a signed notice (BE-047) and only then is the payment registered on the contract:
//   - airtime of 30 credit: listed, offered, accepted; `delivered` by the seller, `confirmed` by the buyer; the buyer's voucher is then registered and the pair holds 30;
//   - loyalty points of 130 credit: the deal is at or above the bond threshold (100 credit), so the match says `needsBond`; the seller says `delivered`, the buyer says `disputed` (`not_received`):
//     the payment never becomes payable, a later `confirmed` is refused, nothing is registered and the pair holds 0.
import { afterAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { createCircleViewFn, listingHash, onboardMember, signListing, signOffer, signVoucher, type ContractAbi, type ContractCall, type Listing, type Offer, type UnsignedVoucher } from "@x207/core";
import { FailoverRpcClient, Indexer, RpcBlockSource, createApiServer, openDatabase, rpcChainReader } from "../backend/src/index.ts";
import { viewClearedEdges } from "../backend/src/indexer/view-edges.ts";
import { marketplaceRoutes } from "../backend/src/marketplace/index.ts";
import { signDeliveryNotice, type DeliveryAction, type DeliveryNotice } from "../backend/src/marketplace/delivery-core.ts";
import { TERMS_HASH, deployCircle, type CircleFixture } from "../sdk/test-support/circle.ts";
import { sandboxAvailable, type SandboxAccount } from "../sdk/test-support/sandbox.ts";

const credit = (n: number): string => (BigInt(n) * 1_000_000n).toString();
type Member = { account: SandboxAccount; secretKey: `ed25519:${string}`; publicKey: string };

describe.skipIf(!sandboxAvailable)("UM-097 group E without an API (airtime #78, loyalty points #79): confirmed then registered, disputed and never paid, a deal of 100 credit or more asks for a bond", () => {
  let fx: CircleFixture;
  let api: Server | undefined;
  afterAll(async () => {
    api?.close();
    await fx?.stop();
  });
  // the clock of the backend: the window of the transfer is measured on it, so the test moves it instead of waiting 7 days
  const clock = { now: Date.now() };

  it("TC-UM-097-01 airtime is confirmed and then registered; loyalty points are disputed and never paid; 100 credit or more asks for a bond", async () => {
    fx = await deployCircle();
    const rpcUrl = fx.sandbox.rpcUrl;
    const rpc = async (method: string, params: unknown) => ((await (await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()) as any).result;
    // from the first block: the indexer must see the epoch_opened of the first epoch, which was emitted when the contract was initialised, before any member joined
    const startBlock = 1;
    const view = createCircleViewFn({ circleContract: fx.circle.accountId, rpcUrls: [rpcUrl] });
    const join = async (name: string): Promise<Member> => {
      const account = await fx.member(name);
      const joined = await onboardMember(
        {
          sendCall: async (c: ContractCall) => {
            const r = await account.call(c);
            if (r.failures.length > 0) throw new Error(r.failures.join("; "));
            return r.value;
          },
          view, pollIntervalMs: 200, timeoutMs: 30_000,
        },
        { circleContract: fx.circle.accountId, circleId: fx.circleId, accountId: account.accountId, termsHash: TERMS_HASH, stakeAmount: "150000000", usdtTokenId: fx.usdt.accountId },
      );
      return { account, secretKey: joined.secretKey, publicKey: joined.publicKey };
    };
    const seller = await join("seller");
    const buyer = await join("buyer");
    const second = await join("second");
    const contract = fx.circle.accountId;
    const view_ = <T,>(method: string, args: object) => fx.sandbox.view<T>(contract, method, args);

    // --- indexer and read API with the license routes; the backend downloads from a fake internet (the guard of the backend refuses a loopback address)
    const advance = async (ns: string | null | undefined) => {
      await fx.sandbox.advanceTo(Number(BigInt(ns!) / 1_000_000n) + 1_000);
      await new Promise((r) => setTimeout(r, 3_000));
    };
    const db = openDatabase(":memory:");
    const indexer = new Indexer({
      db, source: new RpcBlockSource(rpcChainReader(new FailoverRpcClient({ endpoints: [rpcUrl] })), contract, startBlock), circleId: "agents-main",
      contractId: contract, startBlock, fetchParams: () => view_("get_params", {}) as Promise<ContractAbi.Params>,
      fetchClearedEdges: (epoch) => viewClearedEdges(rpcUrl, contract, epoch),
    });
    await indexer.bootstrap();
    // The indexer reads final blocks, and the sandbox makes blocks slowly when nothing is sent: nudge the clock a little while waiting.
    const catchUp = async (done: () => boolean) => {
      for (let i = 0; i < 90; i++) {
        await indexer.drain();
        if (done()) return;
        if (i % 5 === 4) await fx.sandbox.advanceTo((await fx.sandbox.blockTimestampMs()) + 2_000);
        await new Promise((r) => setTimeout(r, 1_000));
      }
      const members = (db.prepare("select count(*) as n from members").get() as { n: number }).n;
      const epochs = db.prepare("select epoch, phase from epochs").all();
      const cursor = db.prepare("select last_block_height, head_block_height from indexer_cursor").get();
      throw new Error(`the indexer did not catch up in 90 seconds: members ${members}, epochs ${JSON.stringify(epochs)}, cursor ${JSON.stringify(cursor)}`);
    };
    const phaseOf = (epoch: number) => (db.prepare("select phase from epochs where epoch = ?").get(epoch) as { phase: string } | undefined)?.phase;
    // The epoch rows of the indexer appear with the first epoch event after the cutoff, so the open epoch is read from the contract (the book falls back to the rows otherwise).
    api = createApiServer({ db, now: () => clock.now, extraRoutes: marketplaceRoutes(db, { chainView: (_contract: string, method: string, args: object) => view_(method, args), sourceFetch: { resolver: async () => ["93.184.216.34"], transport: async () => ({ status: 404, body: Buffer.alloc(0), truncated: false }) } }) });
    await new Promise<void>((resolve) => api!.listen(0, "127.0.0.1", resolve));
    const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    const base = `${apiUrl}/x207/circles/agents-main`;
    await catchUp(() => (db.prepare("select count(*) as n from members").get() as { n: number }).n === 3);
    const E = (await view_<ContractAbi.EpochView>("get_epoch", {})).epoch;
    const pairOf = (debtor: Member, creditor: Member) => {
      const row = db.prepare("SELECT cumulative_amount FROM obligations WHERE circle_id = 'agents-main' AND epoch = ? AND debtor = ? AND creditor = ?").get(E, debtor.account.accountId, creditor.account.accountId) as { cumulative_amount?: string } | undefined;
      return String(row?.cumulative_amount ?? "0");
    };
    const post = async (path: string, payload: unknown) => {
      const res = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      return { status: res.status, json: (await res.json()) as any };
    };
    const get = async (path: string) => (await (await fetch(`${base}${path}`)).json()) as any;
    const nowS = () => Math.floor(Date.now() / 1000);
    const contractId = contract;
    /** The seller lists the thing, the buyer offers its price in pay mode, the seller accepts: the match starts a handover that waits for the confirmation of the receiver. */
    const dealOn = async (assetType: string, price: number, nonce: string, buyerM: Member) => {
      const listing: Listing = {
        circle: contractId, account: seller.account.accountId, offer: { asset_type: assetType, asset_class: "B", quantity: 1, value: credit(price) },
        want: { asset_type: "usdc", asset_class: "A", quantity: 1, value: credit(price) }, terms: "handed over once through the transfer feature of the operator or the program",
        detail: `${assetType} ${nonce}`, expires_at: nowS() + 86_400, discount_bps: 0, accept_payment: true, discoverable: true, nonce,
      };
      const hash = listingHash(listing);
      expect((await post("/listings", { listing, signature: signListing(listing, seller.secretKey) })).status).toBe(201);
      const offer: Offer = { circle: contractId, listing_hash: hash, proposer: buyerM.account.accountId, round: 1, mode: "pay", value: credit(price), quantity: 1, deliver_by: nowS() + 3 * 86_400 };
      const posted = await post(`/listings/${hash}/offers`, { offer, signature: signOffer(offer, buyerM.secretKey) });
      expect(posted.status).toBe(201);
      const accepted = await post(`/listings/${hash}/offers/${posted.json.offerHash}/accept`, { account: seller.account.accountId });
      expect(accepted.status).toBe(201);
      return { hash, offerHash: posted.json.offerHash as string, accepted: accepted.json };
    };
    const notice = (deal: { hash: string; offerHash: string }, who: Member, action: DeliveryAction, proof?: string, reason?: string) => {
      const n: DeliveryNotice = {
        circle: contractId, listing_hash: deal.hash, offer_hash: deal.offerHash, side: "offer", actor: who.account.accountId, action, at: nowS(),
        proof_hash: action === "delivered" ? (proof ?? null) : null, reason: action === "disputed" ? (reason as DeliveryNotice["reason"]) : null,
      };
      return post(`/listings/${deal.hash}/delivery`, { notice: n, signature: signDeliveryNotice(n, who.secretKey) });
    };

    // --- 1. airtime (#78), 30 credit: below the bond threshold, handed over once, confirmed, then paid
    const airtime = await dealOn("telco:airtime-data", 30, "um097-airtime", buyer);
    expect(airtime.accepted.result.delivery).toMatchObject({ required: true, payable: false, needsBond: false, sides: { offer: "awaiting" } });
    expect(pairOf(buyer, seller)).toBe("0");
    const receipt = createHash("sha256").update("operator receipt: 5 GB data allowance moved to the line of the buyer").digest("hex"); // the proof stays off x207; only its hash is kept
    expect((await notice(airtime, seller, "delivered", receipt)).json).toMatchObject({ payable: false });
    await expect(notice(airtime, seller, "confirmed")).resolves.toMatchObject({ status: 403 }); // the seller cannot confirm its own handover
    const confirmed = await notice(airtime, buyer, "confirmed");
    expect(confirmed.status).toBe(201);
    expect(confirmed.json.payable).toBe(true);
    expect(pairOf(buyer, seller)).toBe("0"); // payable is not paid: the buyer still has to sign the voucher
    const voucher: UnsignedVoucher = { circle: contractId, payer: buyer.account.accountId, payee: seller.account.accountId, epoch: E, seq: 1, cumulativeAmount: credit(30), unit: "credit", resource: `x207:delivery:${airtime.hash}` };
    const r = await seller.account.call({ receiverId: contract, methodName: "register_cumulative", args: { voucher, signature: signVoucher(voucher, buyer.secretKey).signature }, deposit: 0n, gas: 100_000_000_000_000n }, "FINAL");
    expect(r.failures).toEqual([]);
    await catchUp(() => pairOf(buyer, seller) === credit(30));

    // --- 2. loyalty points (#79), 130 credit: at or above 100 credit the match asks for a bond; the buyer disputes and nothing is paid
    const points = await dealOn("loyalty:transferable-points", 130, "um097-points", second);
    expect(points.accepted.result.delivery).toMatchObject({ required: true, payable: false, needsBond: true });
    expect((await get(`/listings/${points.hash}/delivery`)).needsBond).toBe(true);
    await notice(points, seller, "delivered", createHash("sha256").update("program receipt").digest("hex"));
    const disputed = await notice(points, second, "disputed", undefined, "not_received");
    expect(disputed.status).toBe(201);
    expect(disputed.json).toMatchObject({ payable: false });
    expect(disputed.json.deliveries[0]).toMatchObject({ state: "disputed", disputeReason: "not_received" });
    expect((await notice(points, second, "confirmed")).status).toBeGreaterThanOrEqual(400); // a disputed handover stays disputed
    expect((await get(`/listings/${points.hash}/delivery`)).payable).toBe(false);
    await new Promise((r2) => setTimeout(r2, 3_000));
    expect(pairOf(second, seller)).toBe("0"); // nothing was signed or registered for the disputed deal
    console.log(["UM-097", `epoch ${E}`, `airtime pair ${pairOf(buyer, seller)}`, `points pair ${pairOf(second, seller)}`, `points needsBond ${points.accepted.result.delivery.needsBond}`].join(" | "));
  }, 1_800_000);
});
