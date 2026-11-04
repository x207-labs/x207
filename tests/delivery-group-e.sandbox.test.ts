// UM-097: delivery of a thing that has no API (P2 group E, ADR-47 point 7: airtime and data allowance #78, loyalty points #79) in near-sandbox. The seller hands it over once, with the transfer feature of
// the operator or the program, outside x207; the receiver confirms with a signed notice (BE-047) and only then is the payment registered on the contract:
//   - airtime of 30 credit (below the bond threshold): listed, offered, accepted; `delivered` by the seller, `confirmed` by the buyer; the buyer's voucher is then registered and the pair holds 30;
//   - loyalty points of 110 credit (at or above the threshold of 100 credit): accept refuses a plain payment (`bond_required`) and takes a deal with a bond (CT-094): a bundle of the two parties with an
//     arbiter in its signed terms, committed BEFORE the handover so that the bond of each side is locked. The seller says `delivered`, the buyer says `disputed` (`not_received`) on the backend and
//     `dispute_deal` on the contract, the arbiter rules `accused_guilty`: the bond of the seller moves to the stake of the buyer, the locks are lifted, the payment is never payable and the pair holds 0.
import { afterAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { bundleInput, createCircleViewFn, listingHash, onboardMember, parseEventLog, signBundle, signListing, signOffer, signVoucher, termsHash, type BundleTerms, type ContractAbi, type ContractCall, type Listing, type Offer, type UnsignedVoucher } from "@x207/core";
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

    // --- 2. loyalty points (#79), 110 credit: at or above 100 credit the handover is a deal with a bond (CT-094). Accept refuses a plain payment, takes a bundle with an arbiter in its signed
    // terms, and the bundle is committed BEFORE the handover, so the bond of the seller is locked while the points are handed over. The buyer disputes: the arbiter finds the seller at fault, the
    // bond of the seller goes to the stake of the buyer, and the buyer never pays.
    const arbiter = await fx.sandbox.createAccount("arbiter", "10");
    const listing: Listing = {
      circle: contractId, account: seller.account.accountId, offer: { asset_type: "loyalty:transferable-points", asset_class: "B", quantity: 1, value: credit(110) },
      want: { asset_type: "usdc", asset_class: "A", quantity: 1, value: credit(110) }, terms: "points moved once through the transfer feature of the program",
      detail: "loyalty points um097", expires_at: nowS() + 86_400, discount_bps: 0, accept_payment: true, discoverable: true, nonce: "um097-points",
    };
    const lh = listingHash(listing);
    expect((await post("/listings", { listing, signature: signListing(listing, seller.secretKey) })).status).toBe(201);
    const offer: Offer = { circle: contractId, listing_hash: lh, proposer: second.account.accountId, round: 1, mode: "pay", value: credit(110), quantity: 1, deliver_by: nowS() + 3 * 86_400 };
    const posted = await post(`/listings/${lh}/offers`, { offer, signature: signOffer(offer, second.secretKey) });
    const offerHash = posted.json.offerHash as string;
    // a plain payment of this value is refused
    const plain = await post(`/listings/${lh}/offers/${offerHash}/accept`, { account: seller.account.accountId });
    expect([plain.status, plain.json.error.code]).toEqual([409, "bond_required"]);
    // the terms with the arbiter come from the preview; both parties sign them
    const chainNowNs = BigInt(await fx.sandbox.blockTimestampMs()) * 1_000_000n;
    const confirmBy = (chainNowNs + 3n * 86_400n * 1_000_000_000n).toString();
    const shown = await post(`/listings/${lh}/offers/${offerHash}/preview`, { account: seller.account.accountId, arbiter: arbiter.accountId, confirmBy });
    expect([shown.status, shown.json.needsBond, shown.json.kind]).toEqual([200, true, "bundle"]);
    const terms = shown.json.bundle.terms as BundleTerms;
    expect(terms).toMatchObject({ arbiter: arbiter.accountId, confirm_by: confirmBy });
    const accepted = await post(`/listings/${lh}/offers/${offerHash}/accept`, { account: seller.account.accountId, arbiter: arbiter.accountId, confirmBy, signature: signBundle(terms, seller.account.accountId, seller.secretKey).signature });
    expect(accepted.status).toBe(201);
    expect(accepted.json.result.delivery).toMatchObject({ required: true, payable: false, needsBond: true });
    const th = termsHash(terms);
    expect((await post(`/bundle-proposals/${th}/signatures`, { account: second.account.accountId, signature: signBundle(terms, second.account.accountId, second.secretKey).signature })).status).toBe(201);
    expect((await get(`/bundle-proposals/${th}`))).toMatchObject({ status: "ready", missing: [] }); // ready before the handover
    // anybody commits the bundle: the bond of both sides is locked
    const stakeOf = async (m: Member) => BigInt((await view_<ContractAbi.MemberView>("member", { account_id: m.account.accountId })).stake);
    const [sellerStake0, buyerStake0] = [await stakeOf(seller), await stakeOf(second)];
    const commit = await arbiter.call({ receiverId: contract, methodName: "commit_bundle", deposit: 0n, gas: 200_000_000_000_000n, args: { bundle: bundleInput(terms), signatures: [seller, second].map((m) => ({ account_id: m.account.accountId, signature: signBundle(terms, m.account.accountId, m.secretKey).signature })) } }, "FINAL");
    expect(commit.failures).toEqual([]);
    const bundleId = Number((commit.logs.flatMap((l: string) => (parseEventLog(l) ?? []) as Array<Record<string, any> & { event: string }>).find((e) => e.event === "bundle_committed") as any).bundle_id);
    const deal = await view_<ContractAbi.DealView>("get_deal", { bundle_id: bundleId });
    expect(deal).toMatchObject({ arbiter: arbiter.accountId, state: "open" });
    const bond = BigInt(deal.bond_each);
    expect(bond).toBeGreaterThan(0n);
    expect([await view_<string>("bond_locked", { account_id: seller.account.accountId }), await view_<string>("bond_locked", { account_id: second.account.accountId })]).toEqual([bond.toString(), bond.toString()]);
    // the handover: the seller says delivered, the buyer got nothing and disputes, on the backend and on the contract
    await notice({ hash: lh, offerHash }, seller, "delivered", createHash("sha256").update("program receipt").digest("hex"));
    const disputed = await notice({ hash: lh, offerHash }, second, "disputed", undefined, "not_received");
    expect(disputed.json).toMatchObject({ payable: false });
    expect(disputed.json.deliveries[0]).toMatchObject({ state: "disputed", disputeReason: "not_received" });
    expect((await second.account.call({ receiverId: contract, methodName: "dispute_deal", args: { bundle_id: bundleId, evidence_hash: createHash("sha256").update("screenshot of the empty balance").digest("hex") }, deposit: 0n, gas: 100_000_000_000_000n }, "FINAL")).failures).toEqual([]);
    expect(await view_<ContractAbi.DealView>("get_deal", { bundle_id: bundleId })).toMatchObject({ state: "disputed", complainant: second.account.accountId, accused: seller.account.accountId });
    // the arbiter rules for the receiver: the bond of the seller goes to the stake of the buyer, both locks are lifted
    const ruled = await arbiter.call({ receiverId: contract, methodName: "rule_deal", args: { bundle_id: bundleId, verdict: "accused_guilty" }, deposit: 0n, gas: 100_000_000_000_000n }, "FINAL");
    expect(ruled.failures).toEqual([]);
    expect([await stakeOf(seller), await stakeOf(second)]).toEqual([sellerStake0 - bond, buyerStake0 + bond]);
    expect([await view_<string>("bond_locked", { account_id: seller.account.accountId }), await view_<string>("bond_locked", { account_id: second.account.accountId })]).toEqual(["0", "0"]);
    expect((await get(`/listings/${lh}/delivery`)).payable).toBe(false); // never payable
    expect((await notice({ hash: lh, offerHash }, second, "confirmed")).status).toBeGreaterThanOrEqual(400); // a disputed handover stays disputed
    await new Promise((r2) => setTimeout(r2, 3_000));
    expect(pairOf(second, seller)).toBe("0"); // the buyer never signed a voucher for the disputed deal
    console.log(["UM-097", `epoch ${E}`, `airtime pair ${pairOf(buyer, seller)}`, `points pair ${pairOf(second, seller)}`, `bond slashed ${bond.toString()}`].join(" | "));
  }, 1_800_000);
});
