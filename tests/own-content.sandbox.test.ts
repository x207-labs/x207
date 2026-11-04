// UM-110 (P7, pattern of UM-088): two catalog items of the file license in near-sandbox, #82 own work (an article, a photo, a design: `content:own-work`) and #89 own data, anonymised
// (`data:own-anonymized`). A seller and two buyers are members of a real circle on a real contract, and a fake internet serves the ciphertext:
//   - #82: the seller sells a work it made with the license `own-work`: the voucher is held, the seller releases the key sealed to the buyer, the buyer opens the file, checks its hash and confirms,
//     and only then the voucher is registered (pair 15 credit); the exclusive license of another work to one buyer closes the way to a second buyer;
//   - #89: a dataset whose preview holds an e-mail address is refused by the book (`preview_contains_pii`) before anything is listed; the same dataset with a clean preview is sold and registered
//     (pair 15 + 25 credit); and a dataset whose delivered file is not the one that the listing promised is disputed by the proof of the buyer and never paid.
import { afterAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { contentHash, createCircleViewFn, httpsSource, onboardMember, type ContentRef, type ContentSource, type ContractAbi, type ContractCall } from "@x207/core";
import { FailoverRpcClient, Indexer, RpcBlockSource, createApiServer, openDatabase, rpcChainReader } from "../backend/src/index.ts";
import { viewClearedEdges } from "../backend/src/indexer/view-edges.ts";
import { marketplaceRoutes } from "../backend/src/marketplace/index.ts";
import { TERMS_HASH, deployCircle, type CircleFixture } from "../sdk/test-support/circle.ts";
import { sandboxAvailable, type SandboxAccount } from "../sdk/test-support/sandbox.ts";
import { LicenseBook, buyLicense, listLicense, receiveLicense, serveLicense, type LicenseActor } from "../agents/scenario/license.ts";

const credit = (n: number): string => (BigInt(n) * 1_000_000n).toString();
const text = (s: string) => new TextEncoder().encode(s);
type Member = { account: SandboxAccount; secretKey: `ed25519:${string}`; publicKey: string };

describe.skipIf(!sandboxAvailable)("UM-110 own work (#82) and own anonymised data (#89): the file license pattern", () => {
  let fx: CircleFixture;
  let api: Server | undefined;
  afterAll(async () => {
    api?.close();
    await fx?.stop();
  });
  /** What the "internet" serves: https://store.example.com/<path> -> bytes. */
  const files = new Map<string, Uint8Array>();
  const transport = async ({ host, path, method, onChunk }: any) => {
    const bytes = files.get(`${host}${path}`);
    if (!bytes) return { status: 404, body: Buffer.alloc(0), truncated: false };
    if (method === "HEAD") return { status: 200, body: Buffer.alloc(0), truncated: false };
    if (onChunk) {
      for (let i = 0; i < bytes.length; i += 16_384) onChunk(Buffer.from(bytes.subarray(i, i + 16_384)));
      return { status: 200, body: Buffer.alloc(0), truncated: false };
    }
    return { status: 200, body: Buffer.from(bytes), truncated: false };
  };
  const resolver = async () => ["93.184.216.34"];
  const sources: Partial<Record<ContentRef["kind"], ContentSource>> = {
    https: httpsSource({ fetch: async (url: string) => {
      const bytes = files.get(url.replace("https://", ""));
      return bytes ? new Response(Buffer.from(bytes), { status: 200 }) : new Response("not found", { status: 404 });
    } }),
  };

  it("TC-UM-110-01 own work is sold and registered, an exclusive license is taken by one buyer; anonymised data with personal data in the preview is refused, a clean one is sold, a wrong file is disputed", async () => {
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
    api = createApiServer({ db, extraRoutes: marketplaceRoutes(db, { chainView: (_contract: string, method: string, args: object) => view_(method, args), sourceFetch: { resolver, transport } }) });
    await new Promise<void>((resolve) => api!.listen(0, "127.0.0.1", resolve));
    const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    const base = `${apiUrl}/x207/circles/agents-main`;
    const book = new LicenseBook(apiUrl, "agents-main", contract);
    await catchUp(() => (db.prepare("select count(*) as n from members").get() as { n: number }).n === 3);
    const E = (await view_<ContractAbi.EpochView>("get_epoch", {})).epoch;
    const actor = (m: Member): LicenseActor => ({ account: m.account.accountId, secretKey: m.secretKey, publicKey: m.publicKey });
    const [sellerA, buyerA, secondA] = [actor(seller), actor(buyer), actor(second)];
    const expiresAt = Math.floor(Date.now() / 1000) + 86_400;
    const pairOf = (debtor: Member, creditor: Member) => {
      const row = db.prepare("SELECT cumulative_amount FROM obligations WHERE circle_id = 'agents-main' AND epoch = ? AND debtor = ? AND creditor = ?").get(E, debtor.account.accountId, creditor.account.accountId) as { cumulative_amount: string } | undefined;
      return String(row?.cumulative_amount ?? "0");
    };

    const errorCode = async (p: Promise<unknown>): Promise<string> => {
      try {
        await p;
        return "no error";
      } catch (e) {
        return (e as { code?: string }).code ?? String(e);
      }
    };
    const publish = (path: string, bytes: Uint8Array): ContentRef => {
      files.set(`store.example.com/${path}`, bytes);
      return { kind: "https", ref: `https://store.example.com/${path}` };
    };
    const register = async (voucher: unknown, signature: unknown) => {
      const r = await seller.account.call({ receiverId: contract, methodName: "register_cumulative", args: { voucher, signature }, deposit: 0n, gas: 100_000_000_000_000n }, "FINAL");
      expect(r.failures).toEqual([]);
    };
    const state = { seq: 0, cumulative: "0" };
    /** list, buy, serve, open and confirm one license; returns the confirmed purchase. */
    const sellAndConfirm = async (o: { plain: Uint8Array; assetType: string; licenseId: string; nonce: string; price: number; path: string; preview?: string; buyerA?: LicenseActor }) => {
      const who = o.buyerA ?? buyerA;
      const sold = await listLicense(book, sellerA, { plain: o.plain, assetType: o.assetType, licenseId: o.licenseId, nonce: o.nonce, price: credit(o.price), expiresAt, ...(o.preview === undefined ? {} : { preview: o.preview }) });
      const bought = await buyLicense(book, who, sold, E, { seq: state.seq, cumulative: state.cumulative });
      state.seq += 1;
      state.cumulative = (BigInt(state.cumulative) + BigInt(credit(o.price))).toString();
      expect(bought.status).toBe("paid_held");
      expect(bought.voucher).toBeUndefined();
      const served = await serveLicense(book, sellerA, bought.purchaseId, sold, publish(o.path, sold.ciphertext), who);
      expect(served.status).toBe("key_released");
      const got = await receiveLicense(book, who, bought.purchaseId, sellerA.publicKey, sources);
      expect(got).toMatchObject({ outcome: "confirmed", status: "confirmed" });
      expect(Array.from(got.content!)).toEqual(Array.from(o.plain));
      const done = await book.get(bought.purchaseId);
      await register(done.voucher, done.voucherSignature);
      return done;
    };

    // --- 1. #82 own work: an article, license `own-work`, 15 credit
    const article = text("# On mutual credit\nA short article that the seller wrote.\n");
    const first = await sellAndConfirm({ plain: article, assetType: "content:own-work", licenseId: "own-work", nonce: "um110-article", price: 15, path: "article.bin" });
    expect(first.voucher).toMatchObject({ payer: buyerA.account, payee: sellerA.account, cumulativeAmount: credit(15), epoch: E });
    await catchUp(() => pairOf(buyer, seller) === credit(15));
    expect(pairOf(buyer, seller)).toBe(credit(15));

    // --- 2. #82 exclusive license of a photo: the first buyer holds it, a second buyer cannot take it
    const photo = text("jpeg bytes of a photo that the seller took");
    const exclusive = await listLicense(book, sellerA, { plain: photo, assetType: "content:own-work", licenseId: "own-work", exclusive: true, nonce: "um110-photo", price: credit(20), expiresAt });
    const held = await buyLicense(book, buyerA, exclusive, E, { seq: state.seq, cumulative: state.cumulative });
    expect(held.status).toBe("paid_held");
    const tooLate = await errorCode(buyLicense(book, secondA, exclusive, E, { seq: 0, cumulative: "0" }));
    expect(tooLate).not.toBe("no error"); // an exclusive license is taken by one buyer; the second purchase is refused
    expect(pairOf(second, seller)).toBe("0");
    // the sale of the photo is finished too, so that the pair state of the buyer goes on
    state.seq += 1;
    state.cumulative = (BigInt(state.cumulative) + BigInt(credit(20))).toString();
    const photoServed = await serveLicense(book, sellerA, held.purchaseId, exclusive, publish("photo.bin", exclusive.ciphertext), buyerA);
    expect(photoServed.status).toBe("key_released");
    expect(await receiveLicense(book, buyerA, held.purchaseId, sellerA.publicKey, sources)).toMatchObject({ outcome: "confirmed" });
    const photoDone = await book.get(held.purchaseId);
    await register(photoDone.voucher, photoDone.voucherSignature);
    await catchUp(() => pairOf(buyer, seller) === credit(35));

    // --- 3. #89 own anonymised data: a preview with an e-mail address is refused, before anything is listed
    const dataset = text("age_band,region,count\n30-39,east,412\n40-49,east,377\n30-39,west,298\n");
    const dirty = await errorCode(listLicense(book, sellerA, { plain: dataset, assetType: "data:own-anonymized", licenseId: "research", nonce: "um110-dirty", price: credit(25), expiresAt, preview: "age_band,region,count\n30-39,east,412\ncontact: jane.doe@example.com" }));
    expect(dirty).toBe("preview_contains_pii");
    const clean = await sellAndConfirm({ plain: dataset, assetType: "data:own-anonymized", licenseId: "research", nonce: "um110-clean", price: 25, path: "dataset.bin", preview: "age_band,region,count\n30-39,east,412\n40-49,east,377" });
    expect(clean.voucher).toMatchObject({ cumulativeAmount: credit(60) });
    await catchUp(() => pairOf(buyer, seller) === credit(60));
    expect(pairOf(buyer, seller)).toBe(credit(60));

    // --- 4. #89 the delivered file is not the one that the listing promised: the buyer proves it, the purchase is disputed and nothing is registered
    const bad = await listLicense(book, sellerA, { plain: text("a different file with the names of real people: jane doe, john roe"), claimedPlain: dataset, assetType: "data:own-anonymized", licenseId: "research", nonce: "um110-bad", price: credit(25), expiresAt });
    const boughtBad = await buyLicense(book, secondA, bad, E, { seq: 0, cumulative: "0" });
    await serveLicense(book, sellerA, boughtBad.purchaseId, bad, publish("bad.bin", bad.ciphertext), secondA);
    const disputed = await receiveLicense(book, secondA, boughtBad.purchaseId, sellerA.publicKey, sources);
    expect(disputed).toMatchObject({ outcome: "disputed", reason: "content_mismatch" });
    const after = await book.get(boughtBad.purchaseId);
    expect(after.status).toBe("disputed");
    expect(after.voucher).toBeUndefined();
    expect(JSON.stringify(after)).not.toContain(Buffer.from(bad.key).toString("hex"));
    await new Promise((r2) => setTimeout(r2, 3_000));
    expect(pairOf(second, seller)).toBe("0");
    console.log(["UM-110", `epoch ${E}`, `pair after own work, photo and clean dataset ${pairOf(buyer, seller)}`, `pii preview ${dirty}`, `wrong file ${after.status}`, `exclusive second ${tooLate}`].join(" | "));
  }, 1_800_000);
});
