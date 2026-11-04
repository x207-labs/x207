// UM-096: transfer of a digital event ticket (#73) and of a game item through the official trade system (#75), ADR-49, in near-sandbox. The same circle, ledger and fake internet as UM-095
// (the Steam trade offer API is the fake platform of the game item); the voucher of the buyer is registered on the contract only after the platform shows the transfer is done:
//   - a ticket: the seller cannot say it arrived, only the buyer confirms; the voucher is registered then and the pair holds the price;
//   - a ticket that the platform cancels: the buyer cancels the held transfer, nothing is paid and nothing is registered;
//   - a game item: the trade offer is sent (pending), accepted but held by Steam for a while (pending, with the time left), then past its hold (confirmed): paid and registered, even if the buyer who already has the item says "cancelled" (a request that the platform proof overrules);
//   - a game item whose trade offer Steam cancels: no proof ever, the buyer's cancel takes effect when the window ends (`cancelled_by_buyer`), the voucher never moves.
import { afterAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { TRANSFER_WINDOW_SECONDS, TransferError, createCircleViewFn, onboardMember, type ContractAbi, type ContractCall } from "@x207/core";
import { FailoverRpcClient, Indexer, RpcBlockSource, createApiServer, openDatabase, rpcChainReader } from "../backend/src/index.ts";
import { viewClearedEdges } from "../backend/src/indexer/view-edges.ts";
import { marketplaceRoutes } from "../backend/src/marketplace/index.ts";
import { DnsTxtProof, TradeApiProof } from "../backend/src/marketplace/transfer-proofs.ts";
import { TERMS_HASH, deployCircle, type CircleFixture } from "../sdk/test-support/circle.ts";
import { sandboxAvailable, type SandboxAccount } from "../sdk/test-support/sandbox.ts";
import { HttpTransferBook, buyTransfer, postTransfer, prepareTransfer, releasePair, releasedVoucher, waitForProof, type PairState, type TransferActor } from "../agents/scenario/transfer.ts";

const credit = (n: number): string => (BigInt(n) * 1_000_000n).toString();
type Member = { account: SandboxAccount; secretKey: `ed25519:${string}`; publicKey: string };

describe.skipIf(!sandboxAvailable)("UM-096 ticket (#73) and game item (#75) through the official transfer: paid only after the platform shows it done, a transfer the platform cancels pays nothing", () => {
  let fx: CircleFixture;
  let api: Server | undefined;
  afterAll(async () => {
    api?.close();
    await fx?.stop();
  });
  // the platforms: DNS over HTTPS and the RDAP of the registry
  const dns = new Map<string, string[]>();
  const rdap = new Map<string, unknown>();
  const steam = new Map<string, unknown>();
  const STEAM_KEY = "STEAM-KEY-UM096-TEST";
  const reply = (status: number, body: unknown) => ({ status, body: Buffer.from(JSON.stringify(body)), truncated: false });
  const transport = async ({ host, path }: { host: string; path: string }) => {
    if (host === "dns.google") {
      const name = new URL(`https://x${path}`).searchParams.get("name") ?? "";
      const records = dns.get(name);
      return records === undefined ? reply(200, { Status: 3 }) : reply(200, { Status: 0, Answer: records.map((r) => ({ name, type: 16, TTL: 60, data: `"${r}"` })) });
    }
    if (host === "api.steampowered.com") {
      const id = new URL(`https://x${path}`).searchParams.get("tradeofferid") ?? "";
      return reply(200, { response: steam.has(id) ? { offer: steam.get(id) } : {} });
    }
    if (host === "rdap.verisign.com") return rdap.has(path.split("/").pop() ?? "") ? reply(200, rdap.get(path.split("/").pop() ?? "")) : reply(404, null);
    return { status: 404, body: Buffer.alloc(0), truncated: false };
  };
  const resolver = async () => ["93.184.216.34"];
  // the clock of the backend: the window of the transfer is measured on it, so the test moves it instead of waiting 7 days
  const clock = { now: Date.now() };

  it("TC-UM-096-01 a ticket and a game item are paid and registered only after the platform shows the transfer; a transfer the platform cancels pays nothing", async () => {
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
    api = createApiServer({ db, now: () => clock.now, extraRoutes: marketplaceRoutes(db, { chainView: (_contract: string, method: string, args: object) => view_(method, args), sourceFetch: { resolver, transport }, dnsTxt: new DnsTxtProof({ resolver, transport }), tradeApi: new TradeApiProof({ apiKey: STEAM_KEY, baseUrl: "https://api.steampowered.com", resolver, transport }), proofMinSeconds: 0 }) });
    await new Promise<void>((resolve) => api!.listen(0, "127.0.0.1", resolve));
    const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    const book = new HttpTransferBook(apiUrl, "agents-main", contract, () => Math.floor(clock.now / 1000));
    await catchUp(() => (db.prepare("select count(*) as n from members").get() as { n: number }).n === 3);
    const E = (await view_<ContractAbi.EpochView>("get_epoch", {})).epoch;
    const actor = (m: Member): TransferActor => ({ account: m.account.accountId, secretKey: m.secretKey });
    const [sellerA, buyerA, secondA] = [actor(seller), actor(buyer), actor(second)];
    const expiresAt = Math.floor(clock.now / 1000) + 30 * 86_400;
    const pairOf = (debtor: Member, creditor: Member) => {
      const row = db.prepare("SELECT cumulative_amount FROM obligations WHERE circle_id = 'agents-main' AND epoch = ? AND debtor = ? AND creditor = ?").get(E, debtor.account.accountId, creditor.account.accountId) as { cumulative_amount?: string } | undefined;
      return String(row?.cumulative_amount ?? "0");
    };
    const register = async (v: { voucher: unknown; signature: string }) => {
      const r = await seller.account.call({ receiverId: contract, methodName: "register_cumulative", args: { voucher: v.voucher, signature: v.signature }, deposit: 0n, gas: 100_000_000_000_000n }, "FINAL");
      expect(r.failures).toEqual([]);
    };
    const wait = async () => { clock.now += 1_000; };
    const buyerPair: PairState = { seq: 0, cumulative: "0" };
    const secondPair: PairState = { seq: 0, cumulative: "0" };

    // --- 1. a ticket (#73): only the buyer says it arrived
    expect(() => prepareTransfer(book, sellerA, { platform: "ticket", ref: "gate-A-17", price: credit(101), estimateSeconds: 600, nonce: "um096-big", expiresAt })).toThrow(TransferError); // above 100 credit: refused before anything is sent
    const ticket = prepareTransfer(book, sellerA, { platform: "ticket", ref: "gate-A-17", price: credit(60), estimateSeconds: 600, nonce: "um096-tk", expiresAt });
    await postTransfer(book, sellerA, ticket);
    const heldTicket = await buyTransfer(book, buyerA, ticket, E, buyerPair);
    expect([heldTicket.status, heldTicket.platform, heldTicket.proofMethod]).toEqual(["paid_held", "ticket", "buyer_confirm"]);
    expect(heldTicket.windowUntil - book.at()).toBe(TRANSFER_WINDOW_SECONDS.ticket);
    expect(heldTicket.voucher).toBeUndefined();
    await expect(book.proof(heldTicket.transferId)).rejects.toMatchObject({ code: "transfer_bad_method" }); // the platform cannot prove a ticket
    await expect(book.transferNotice(heldTicket.transferId, sellerA, "confirmed")).rejects.toMatchObject({ code: "transfer_not_party" }); // the seller cannot say it arrived
    expect(pairOf(buyer, seller)).toBe("0");
    const confirmedTicket = await book.transferNotice(heldTicket.transferId, buyerA, "confirmed");
    expect(confirmedTicket.status).toBe("confirmed");
    await register(releasedVoucher(confirmedTicket));
    await catchUp(() => pairOf(buyer, seller) === credit(60));

    // --- 2. a ticket that the platform cancels: the buyer cancels the held transfer, nothing is paid
    const ticket2 = prepareTransfer(book, sellerA, { platform: "ticket", ref: "gate-B-02", price: credit(45), estimateSeconds: 600, nonce: "um096-tk2", expiresAt });
    await postTransfer(book, sellerA, ticket2);
    const beforeSecond = { ...secondPair };
    const held2 = await buyTransfer(book, secondA, ticket2, E, secondPair);
    const cancelled2 = await book.transferNotice(held2.transferId, secondA, "cancelled");
    expect([cancelled2.status, cancelled2.cancelReason, cancelled2.voucher]).toEqual(["cancelled", "cancelled_by_buyer", undefined]);
    await expect(book.transferNotice(held2.transferId, secondA, "confirmed")).rejects.toMatchObject({ status: 409 }); // a cancelled transfer cannot be confirmed afterwards
    releasePair(secondPair, beforeSecond);
    expect(pairOf(second, seller)).toBe("0");

    // --- 3. a game item (#75): nothing is paid until the trade is accepted, carries the item, goes to the buyer and its hold is over
    const item = prepareTransfer(book, sellerA, { platform: "game_item", ref: "730:1000000001", price: credit(12), estimateSeconds: 900, nonce: "um096-gi", expiresAt });
    await postTransfer(book, sellerA, item);
    const heldItem = await buyTransfer(book, buyerA, item, E, buyerPair, "555"); // a game item names the Steam account of the buyer
    expect(heldItem.windowUntil - book.at()).toBe(TRANSFER_WINDOW_SECONDS.game_item);
    const offer = { trade_offer_state: 2, accountid_other: 555, time_escrow_end: 0, items_to_give: [{ appid: 730, assetid: "1000000001" }] };
    steam.set("77001", offer);
    expect(await book.proof(heldItem.transferId, { tradeoffer_id: "77001" })).toMatchObject({ outcome: "pending", missing: { tradeOfferState: 2 } }); // sent, not accepted
    const nowS = () => Math.floor(clock.now / 1000);
    steam.set("77001", { ...offer, trade_offer_state: 3, time_escrow_end: nowS() + 600 });
    expect(await book.proof(heldItem.transferId)).toMatchObject({ outcome: "pending", missing: { retryAfterSeconds: 600 } }); // accepted, but held by Steam
    expect(pairOf(buyer, seller)).toBe(credit(60)); // nothing more is registered while it is pending
    clock.now += 601_000;
    steam.set("77001", { ...offer, trade_offer_state: 3, time_escrow_end: nowS() - 1 });
    // the buyer, who already has the item, says "cancelled": that is a request, not an end; the platform decides
    const lie = await book.transferNotice(heldItem.transferId, buyerA, "cancelled");
    expect([lie.status, lie.cancelRequested, lie.voucher]).toEqual(["paid_held", true, undefined]);
    const doneItem = await waitForProof(book, heldItem.transferId, { tries: 2, wait });
    expect(doneItem.outcome).toBe("confirmed");
    expect(JSON.stringify(doneItem)).not.toContain(STEAM_KEY); // the key of Steam is in the URL to Steam only
    const itemVoucher = releasedVoucher((doneItem as { transfer: any }).transfer);
    expect(itemVoucher.voucher).toMatchObject({ payer: buyerA.account, payee: sellerA.account, cumulativeAmount: credit(72), seq: 2 });
    await register(itemVoucher);
    await catchUp(() => pairOf(buyer, seller) === credit(72));

    // --- 4. a game item whose trade offer Steam cancels: the transfer is cancelled, the voucher never moves
    const item2 = prepareTransfer(book, sellerA, { platform: "game_item", ref: "730:1000000002", price: credit(20), estimateSeconds: 900, nonce: "um096-gi2", expiresAt });
    await postTransfer(book, sellerA, item2);
    const before2 = { ...secondPair };
    const held3 = await buyTransfer(book, secondA, item2, E, secondPair, "777");
    steam.set("77002", { trade_offer_state: 6, accountid_other: 777, time_escrow_end: 0, items_to_give: [{ appid: 730, assetid: "1000000002" }] }); // 6 = canceled
    expect(await book.proof(held3.transferId, { tradeoffer_id: "77002" })).toMatchObject({ outcome: "pending", missing: { tradeOfferState: 6 } }); // never accepted: no proof
    const request3 = await book.transferNotice(held3.transferId, secondA, "cancelled");
    expect([request3.status, request3.cancelRequested]).toEqual(["paid_held", true]); // nothing proves the transfer, so the request takes effect when the window ends
    clock.now += (TRANSFER_WINDOW_SECONDS.game_item + 60) * 1000;
    const cancelled3 = await book.getTransfer(held3.transferId);
    expect([cancelled3.status, cancelled3.cancelReason, cancelled3.voucher]).toEqual(["cancelled", "cancelled_by_buyer", undefined]);
    releasePair(secondPair, before2);
    expect(pairOf(second, seller)).toBe("0");
    console.log(["UM-096", `epoch ${E}`, `ticket+item pair ${pairOf(buyer, seller)}`, `cancelled pair ${pairOf(second, seller)}`].join(" | "));
  }, 1_800_000);
});
