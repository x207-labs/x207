// UM-101: the last two one-time secrets of pipeline P3 in near-sandbox, both `secret_release` with a mock issuer (the pattern of UM-094 and UM-100):
// #77 a digital store gift card and #76 a voucher or promo code.
//   - #77: the issuer holds a face value and a balance. The backend asks it before the key leaves the seller and sells the card only while the balance covers the face value;
//     a card whose balance went to zero between the listing and the sale is refused `code_used` (cancelled, no key, no payment). After the handover the buyer spends the card at the store.
//   - #76: every promo code has an end date at the issuer. A code that has expired is refused before the handover (`code_unknown`: the issuer does not know it any more), with no key and no payment;
//     a code that is still good is sold, redeemed by the buyer, and paid after that.
//   - in both: the pair holds 0 while the voucher is held, and the price only after the buyer redeemed; keys, salts and file keys are in no table of the read model (D9) and in no console line.
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { contentHash, createCircleViewFn, httpsSource, onboardMember, type ContentRef, type ContentSource, type ContractAbi, type ContractCall } from "@x207/core";
import { FailoverRpcClient, Indexer, RpcBlockSource, createApiServer, openDatabase, rpcChainReader } from "../backend/src/index.ts";
import { viewClearedEdges } from "../backend/src/indexer/view-edges.ts";
import { marketplaceRoutes } from "../backend/src/marketplace/index.ts";
import { TERMS_HASH, deployCircle, type CircleFixture } from "../sdk/test-support/circle.ts";
import { sandboxAvailable, type SandboxAccount } from "../sdk/test-support/sandbox.ts";
import { HttpCodeBook, buyCode, listCode, receiveCode, serveCode, type CodeActor } from "../agents/scenario/code.ts";
import type { CodeCheck, CodeIssuer } from "../backend/src/marketplace/code-issuers.ts";

const credit = (n: number): string => (BigInt(n) * 1_000_000n).toString();
const text = (s: string) => new TextEncoder().encode(s);
type Member = { account: SandboxAccount; secretKey: `ed25519:${string}`; publicKey: string };

const CARD = "STORE-GC-5H2K-83QD-7XMA";
const EMPTY_CARD = "STORE-GC-0000-DRAINED-ZZZZ";
const PROMO = "PROMO-SPRING-26-A91F";
const OLD_PROMO = "PROMO-WINTER-25-OLD1";
/** The issuer of a digital store: a gift card has a face value and a balance; the backend sells it only while the balance still covers the face value. A zero balance is `used`. */
class StoreIssuer implements CodeIssuer {
  readonly cards = new Map<string, { face: bigint; balance: bigint }>();
  calls = 0;
  issue(code: string, face: bigint, balance: bigint = face): this {
    this.cards.set(code, { face, balance });
    return this;
  }
  async checkCode(code: string): Promise<CodeCheck> {
    this.calls += 1;
    const c = this.cards.get(code);
    if (!c) return "unknown";
    return c.balance === 0n || c.balance < c.face ? "used" : "valid";
  }
  /** The buyer spends the whole card at the store: the balance goes to zero. */
  spendAll(code: string): boolean {
    const c = this.cards.get(code);
    if (!c || c.balance < c.face || c.balance === 0n) return false;
    c.balance = 0n;
    return true;
  }
}
/** The issuer of a promo code: every code has an end date; after it the issuer does not know the code any more (`unknown`); a spent code is `used`. */
class PromoIssuer implements CodeIssuer {
  readonly codes = new Map<string, { endsAt: number; used: boolean }>();
  calls = 0;
  clock = Date.now();
  issue(code: string, endsAt: number): this {
    this.codes.set(code, { endsAt, used: false });
    return this;
  }
  async checkCode(code: string): Promise<CodeCheck> {
    this.calls += 1;
    const c = this.codes.get(code);
    if (!c || this.clock >= c.endsAt) return "unknown";
    return c.used ? "used" : "valid";
  }
  redeem(code: string): boolean {
    const c = this.codes.get(code);
    if (!c || this.clock >= c.endsAt || c.used) return false;
    c.used = true;
    return true;
  }
}
const redeemCard = async (issuer: StoreIssuer, c: string): Promise<boolean> => ((await issuer.checkCode(c)) === "valid" ? issuer.spendAll(c) : false);
const redeemPromo = async (issuer: PromoIssuer, c: string): Promise<boolean> => ((await issuer.checkCode(c)) === "valid" ? issuer.redeem(c) : false);
/** The issuer of the backend only checks and marks; the buyer agent redeems: ask, and mark used when valid. */

describe.skipIf(!sandboxAvailable)("UM-101 one-time codes: a promo code (#76) and a digital store gift card (#77) are handed over once, an expired code and an empty card are refused before the handover", () => {
  let fx: CircleFixture;
  let api: Server | undefined;
  afterAll(async () => {
    api?.close();
    await fx?.stop();
  });
  const storeIssuer = new StoreIssuer();
  const promoIssuer = new PromoIssuer();
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

  it("TC-UM-101-01 a store gift card (#77) is checked against the balance of the issuer and a promo code (#76) against its end date, both before the handover; paid on the contract after the buyer redeems; an empty card and an expired code are refused with no key and no payment", async () => {
    const logged: string[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(" ")));
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
    api = createApiServer({ db, extraRoutes: marketplaceRoutes(db, { chainView: (_contract: string, method: string, args: object) => view_(method, args), sourceFetch: { resolver, transport }, codeIssuers: { "store.example": storeIssuer, "promo.example": promoIssuer } }) });
    await new Promise<void>((resolve) => api!.listen(0, "127.0.0.1", resolve));
    const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    const base = `${apiUrl}/x207/circles/agents-main`;
    const book = new HttpCodeBook(apiUrl, "agents-main", contract);
    await catchUp(() => (db.prepare("select count(*) as n from members").get() as { n: number }).n === 3);
    const E = (await view_<ContractAbi.EpochView>("get_epoch", {})).epoch;
    const actor = (m: Member): CodeActor => ({ account: m.account.accountId, secretKey: m.secretKey, publicKey: m.publicKey });
    const [sellerA, buyerA, secondA] = [actor(seller), actor(buyer), actor(second)];
    const expiresAt = Math.floor(Date.now() / 1000) + 86_400;
    const pairOf = (debtor: Member, creditor: Member) => {
      const row = db.prepare("SELECT cumulative_amount FROM obligations WHERE circle_id = 'agents-main' AND epoch = ? AND debtor = ? AND creditor = ?").get(E, debtor.account.accountId, creditor.account.accountId) as { cumulative_amount: string } | undefined;
      return String(row?.cumulative_amount ?? "0");
    };
    const ref = (name: string): ContentRef => ({ kind: "https", ref: `https://store.example.com/${name}.bin` });
    const publish = (r: ContentRef, bytes: Uint8Array) => files.set(r.ref.replace("https://", ""), bytes);
    const registerHeld = async (voucher: unknown, signature: unknown) => {
      const r = await seller.account.call({ receiverId: contract, methodName: "register_cumulative", args: { voucher, signature }, deposit: 0n, gas: 100_000_000_000_000n }, "FINAL");
      expect(r.failures).toEqual([]);
    };
    const errorCode = async (p: Promise<unknown>): Promise<string> => {
      try {
        await p;
        return "no error";
      } catch (e) {
        return (e as { code?: string }).code ?? String(e);
      }
    };

    // --- 1. #77 digital store gift card: face value 5 credit, balance 5, price 4 credit. Nothing is registered before the buyer spends it.
    storeIssuer.issue(CARD, 5_000_000n);
    const card = await listCode(book, sellerA, { code: CARD, issuer: "store.example", verifiable: true, price: credit(4), nonce: "um101-card", expiresAt, assetType: "giftcard:digital-store" });
    const cardBought = await buyCode(book, buyerA, card, E, { seq: 0, cumulative: "0" });
    expect(cardBought.status).toBe("paid_held");
    expect((cardBought as any).voucher).toBeUndefined();
    expect(pairOf(buyer, seller)).toBe("0");
    publish(ref("card"), card.ciphertext);
    const cardServed = await serveCode(book, sellerA, cardBought.purchaseId, card, ref("card"), buyerA);
    expect(cardServed.status).toBe("key_released");
    expect(storeIssuer.calls).toBe(1); // the balance was checked once, before the handover
    expect(storeIssuer.cards.get(CARD)!.balance).toBe(5_000_000n); // the handover did not touch the balance
    const cardGot = await receiveCode(book, buyerA, cardBought.purchaseId, sellerA.publicKey, sources, { doc: card.doc, redeem: async (c) => redeemCard(storeIssuer, c) });
    expect(cardGot).toMatchObject({ outcome: "confirmed", code: CARD, status: "confirmed" });
    expect(storeIssuer.cards.get(CARD)!.balance).toBe(0n); // the buyer spent it
    const cardDone = await book.get(cardBought.purchaseId);
    expect(cardDone.voucher).toMatchObject({ payer: buyerA.account, payee: sellerA.account, cumulativeAmount: credit(4), epoch: E });
    await registerHeld(cardDone.voucher, cardDone.voucherSignature);
    await catchUp(() => pairOf(buyer, seller) === credit(4));

    // --- 2. #77 a card whose balance is zero by the time of the sale is refused before the handover
    storeIssuer.issue(EMPTY_CARD, 5_000_000n);
    const empty = await listCode(book, sellerA, { code: EMPTY_CARD, issuer: "store.example", verifiable: true, price: credit(4), nonce: "um101-empty", expiresAt, assetType: "giftcard:digital-store" });
    const emptyBought = await buyCode(book, secondA, empty, E, { seq: 0, cumulative: "0" });
    storeIssuer.cards.get(EMPTY_CARD)!.balance = 0n; // somebody spent the card at the store after it was listed
    publish(ref("empty"), empty.ciphertext);
    expect(await errorCode(serveCode(book, sellerA, emptyBought.purchaseId, empty, ref("empty"), secondA))).toBe("code_used");
    const emptyRefused = await book.get(emptyBought.purchaseId);
    expect(emptyRefused.status).toBe("cancelled");
    expect(emptyRefused.release).toBeNull();
    expect((emptyRefused as any).voucher).toBeUndefined();
    expect(pairOf(second, seller)).toBe("0");

    // --- 3. #76 promo code with an end date: still good, sold, redeemed, paid; the voucher of the pair continues from the registered one
    const now = Date.now();
    promoIssuer.issue(PROMO, now + 3_600_000);
    const promo = await listCode(book, sellerA, { code: PROMO, issuer: "promo.example", verifiable: true, price: credit(3), nonce: "um101-promo", expiresAt, assetType: "promo:voucher-code" });
    const promoBought = await buyCode(book, buyerA, promo, E, { seq: 1, cumulative: credit(4) });
    expect(promoBought.status).toBe("paid_held");
    expect(pairOf(buyer, seller)).toBe(credit(4)); // the held voucher is not registered
    publish(ref("promo"), promo.ciphertext);
    expect((await serveCode(book, sellerA, promoBought.purchaseId, promo, ref("promo"), buyerA)).status).toBe("key_released");
    expect(promoIssuer.calls).toBe(1);
    const promoGot = await receiveCode(book, buyerA, promoBought.purchaseId, sellerA.publicKey, sources, { doc: promo.doc, redeem: async (c) => redeemPromo(promoIssuer, c) });
    expect(promoGot).toMatchObject({ outcome: "confirmed", code: PROMO, status: "confirmed" });
    const promoDone = await book.get(promoBought.purchaseId);
    expect(promoDone.voucher).toMatchObject({ cumulativeAmount: credit(7) });
    await registerHeld(promoDone.voucher, promoDone.voucherSignature);
    await catchUp(() => pairOf(buyer, seller) === credit(7));

    // --- 4. #76 a promo code that expires between the purchase and the handover is refused before the handover
    promoIssuer.issue(OLD_PROMO, now + 600_000);
    const old = await listCode(book, sellerA, { code: OLD_PROMO, issuer: "promo.example", verifiable: true, price: credit(3), nonce: "um101-old", expiresAt, assetType: "promo:voucher-code" });
    const oldBought = await buyCode(book, secondA, old, E, { seq: 0, cumulative: "0" });
    expect(oldBought.status).toBe("paid_held");
    promoIssuer.clock = now + 700_000; // the end date of the code has passed
    publish(ref("old"), old.ciphertext);
    expect(await errorCode(serveCode(book, sellerA, oldBought.purchaseId, old, ref("old"), secondA))).toBe("code_unknown");
    const oldRefused = await book.get(oldBought.purchaseId);
    expect(oldRefused.status).toBe("cipher_posted"); // `code_unknown` refuses the release but does not cancel the purchase (only a used code does)
    expect(oldRefused.release).toBeNull();
    expect((oldRefused as any).voucher).toBeUndefined();
    expect(pairOf(second, seller)).toBe("0");

    // --- 5. the codes, the salts and the file keys are not in the read model (D9) and not in the console
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t: any) => t.name as string);
    const stored = JSON.stringify(tables.map((t: string) => db.prepare(`SELECT * FROM "${t}"`).all()), (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    const output = logged.join("\n");
    for (const secret of [CARD, EMPTY_CARD, PROMO, OLD_PROMO, Buffer.from(card.salt).toString("hex"), Buffer.from(card.key).toString("hex"), Buffer.from(promo.salt).toString("hex"), Buffer.from(promo.key).toString("hex")]) {
      expect(stored).not.toContain(secret);
      expect(output).not.toContain(secret);
    }
    vi.restoreAllMocks();
    console.log(["UM-101", `epoch ${E}`, `pair after card and promo ${pairOf(buyer, seller)}`, `empty card ${emptyRefused.status}`, `expired promo ${oldRefused.status} (no key)`].join(" | "));
  }, 1_800_000);
});
