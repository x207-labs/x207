// UM-088: licenses of content (P7) in near-sandbox. A seller and two buyers, members of a real circle on a real contract, and a fake internet that serves the ciphertext (the backend
// refuses a loopback address, so the hosting is injected the way the agent tests do it):
//   - a dataset is sold with the hash that the listing promised: the purchase voucher is held by the backend, the seller posts the ciphertext and releases the key sealed to the buyer, the
//     buyer opens it and confirms, and only then the voucher is in the answer; the seller registers it on the contract and the pair holds the price;
//   - another file is sold with a hash that is not the one of the listing: the buyer's SDK makes the proof, the backend checks it by itself, the purchase is `disputed`, and the voucher is
//     never handed out: nothing is registered and nothing moves on the chain.
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

describe.skipIf(!sandboxAvailable)("UM-088 license of content: matching hash sold and paid, a different file refused without payment", () => {
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

  it("TC-UM-088-01 a dataset with the promised hash is sold and its voucher registered; a file with another hash is disputed and nothing moves on the chain", async () => {
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

    // --- 1. the dataset: the hash of the listing is the hash of the file
    const plain = text("id,name\n1,alpha\n2,beta\n3,gamma\n");
    const sold = await listLicense(book, sellerA, { plain, assetType: "data:dataset", licenseId: "commercial", nonce: "um088-ds", price: credit(50), expiresAt });
    const bought = await buyLicense(book, buyerA, sold, E, { seq: 0, cumulative: "0" });
    expect(bought.status).toBe("paid_held");
    expect(bought.voucher).toBeUndefined();
    const ref: ContentRef = { kind: "https", ref: "https://store.example.com/ds.bin" };
    files.set("store.example.com/ds.bin", sold.ciphertext);
    const served = await serveLicense(book, sellerA, bought.purchaseId, sold, ref, buyerA);
    expect(served.status).toBe("key_released");
    expect(served.cipherHash).toBe(contentHash(sold.ciphertext));
    expect(served.voucher).toBeUndefined();
    const received = await receiveLicense(book, buyerA, bought.purchaseId, sellerA.publicKey, sources);
    expect(received).toMatchObject({ outcome: "confirmed", status: "confirmed" });
    expect(Array.from(received.content!)).toEqual(Array.from(plain));
    const confirmed = await book.get(bought.purchaseId);
    expect(confirmed.voucher).toMatchObject({ payer: buyerA.account, payee: sellerA.account, cumulativeAmount: credit(50), epoch: E });
    // the seller registers the voucher that the backend handed out, on the contract
    const r = await seller.account.call({ receiverId: contract, methodName: "register_cumulative", args: { voucher: confirmed.voucher, signature: confirmed.voucherSignature }, deposit: 0n, gas: 100_000_000_000_000n }, "FINAL");
    expect(r.failures).toEqual([]);
    await catchUp(() => pairOf(buyer, seller) === credit(50));
    expect(pairOf(buyer, seller)).toBe(credit(50));

    // --- 2. the file is not the one of the listing: the buyer proves it, the voucher never leaves
    const bad = await listLicense(book, sellerA, { plain: text("not the dataset at all"), claimedPlain: text("id,name\n1,alpha\n"), assetType: "data:dataset", licenseId: "commercial", nonce: "um088-bad", price: credit(40), expiresAt });
    const boughtBad = await buyLicense(book, secondA, bad, E, { seq: 0, cumulative: "0" });
    const refBad: ContentRef = { kind: "https", ref: "https://store.example.com/bad.bin" };
    files.set("store.example.com/bad.bin", bad.ciphertext);
    await serveLicense(book, sellerA, boughtBad.purchaseId, bad, refBad, secondA);
    const disputed = await receiveLicense(book, secondA, boughtBad.purchaseId, sellerA.publicKey, sources);
    expect(disputed).toMatchObject({ outcome: "disputed", reason: "content_mismatch" });
    const after = await book.get(boughtBad.purchaseId);
    expect(after.status).toBe("disputed");
    expect(after.voucher).toBeUndefined();
    expect(JSON.stringify(after)).not.toContain(Buffer.from(bad.key).toString("hex")); // the backend never sees the key of the file
    expect(pairOf(second, seller)).toBe("0"); // nothing was registered for the refused file
    console.log(["UM-088", `epoch ${E}`, `dataset pair ${pairOf(buyer, seller)}`, `refused pair ${pairOf(second, seller)}`, `status ${after.status}`].join(" | "));
  }, 1_800_000);
});
