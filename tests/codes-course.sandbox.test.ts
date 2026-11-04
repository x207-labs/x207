// UM-113 (#72): a course gift code from a platform, the pattern of UM-094 (tests/codes.sandbox.test.ts): a `secret_release` that is sold once, with a mock issuer standing for the platform.
//   - the platform is asked BEFORE the key leaves the seller; the handover does not use the code; the buyer redeems it on the platform (AFTER), and only then is the voucher in the answer and the
//     price registered on the contract;
//   - a code that was redeemed before the sale (`used`) and a code that the platform voided, for instance after a refund (`unknown`), are refused before the handover: no key, no payment;
//   - a course code that is bound to the account of its recipient (`identity_bound`) is not sold at all (`code_bound_to_identity`): the platforms that bind a gift code to an e-mail forbid resale;
//   - the code, its salt and the key of the file are in no table of the read model (D9) and in no console line.
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
import { MockCodeIssuer } from "../backend/src/marketplace/code-issuers.ts";

const credit = (n: number): string => (BigInt(n) * 1_000_000n).toString();
const text = (s: string) => new TextEncoder().encode(s);
type Member = { account: SandboxAccount; secretKey: `ed25519:${string}`; publicKey: string };

const COURSE = "COURSE-GIFT-7H2K-93QD-41LP";
const VOIDED = "COURSE-GIFT-VOID-2288-ZZ10";
const PREUSED = "COURSE-GIFT-USED-0000-AAAA";
/** The issuer of the backend only checks and marks; the buyer agent redeems: ask, and mark used when valid. */
const redeemAt = async (issuer: MockCodeIssuer, c: string): Promise<boolean> => ((await issuer.checkCode(c)) === "valid" ? (issuer.markUsed(c), true) : false);

describe.skipIf(!sandboxAvailable)("UM-113 one-time code #72: a course gift code from a platform is handed over once, a code that the platform does not honour is refused before the handover", () => {
  let fx: CircleFixture;
  let api: Server | undefined;
  afterAll(async () => {
    api?.close();
    await fx?.stop();
  });
  const courseIssuer = new MockCodeIssuer();
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

  it("TC-UM-113-01 a course gift code is checked at the platform before and after the handover and paid after the buyer redeems it; a redeemed code, a voided code and a code bound to the recipient are refused", async () => {
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
    api = createApiServer({ db, extraRoutes: marketplaceRoutes(db, { chainView: (_contract: string, method: string, args: object) => view_(method, args), sourceFetch: { resolver, transport }, codeIssuers: { "courses.example": courseIssuer } }) });
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

    // --- 1. a course gift code worth 8 credit on the platform, sold for 8 credit: nothing is registered before the buyer redeems it
    courseIssuer.issue(COURSE);
    const course = await listCode(book, sellerA, { code: COURSE, issuer: "courses.example", verifiable: true, price: credit(8), nonce: "um113-course", expiresAt, assetType: "course:gift-code" });
    const bought = await buyCode(book, buyerA, course, E, { seq: 0, cumulative: "0" });
    expect(bought.status).toBe("paid_held");
    expect((bought as any).voucher).toBeUndefined();
    expect(pairOf(buyer, seller)).toBe("0");
    publish(ref("course"), course.ciphertext);
    expect((await serveCode(book, sellerA, bought.purchaseId, course, ref("course"), buyerA)).status).toBe("key_released");
    expect(courseIssuer.calls).toBe(1); // BEFORE the handover the platform was asked once and the code was valid
    expect(await courseIssuer.checkCode(COURSE)).toBe("valid"); // the handover alone did not redeem it
    expect(pairOf(buyer, seller)).toBe("0");
    const got = await receiveCode(book, buyerA, bought.purchaseId, sellerA.publicKey, sources, { doc: course.doc, redeem: async (c) => redeemAt(courseIssuer, c) });
    expect(got).toMatchObject({ outcome: "confirmed", code: COURSE, status: "confirmed" });
    expect(await courseIssuer.checkCode(COURSE)).toBe("used"); // AFTER: the buyer redeemed it on the platform
    const done = await book.get(bought.purchaseId);
    expect(done.voucher).toMatchObject({ payer: buyerA.account, payee: sellerA.account, cumulativeAmount: credit(8), epoch: E });
    await registerHeld(done.voucher, done.voucherSignature);
    await catchUp(() => pairOf(buyer, seller) === credit(8));

    // --- 2. a code that was redeemed before the sale: refused before the handover (`code_used`), cancelled, no key, no payment
    courseIssuer.issue(PREUSED);
    courseIssuer.markUsed(PREUSED);
    const used = await listCode(book, sellerA, { code: PREUSED, issuer: "courses.example", verifiable: true, price: credit(8), nonce: "um113-used", expiresAt, assetType: "course:gift-code" });
    const usedBought = await buyCode(book, secondA, used, E, { seq: 0, cumulative: "0" });
    publish(ref("used"), used.ciphertext);
    expect(await errorCode(serveCode(book, sellerA, usedBought.purchaseId, used, ref("used"), secondA))).toBe("code_used");
    const usedRefused = await book.get(usedBought.purchaseId);
    expect(usedRefused.status).toBe("cancelled");
    expect(usedRefused.release).toBeNull();
    expect((usedRefused as any).voucher).toBeUndefined();
    expect(pairOf(second, seller)).toBe("0");

    // --- 3. a code that the platform does not know any more (voided after a refund): `code_unknown`, the key is not released, no voucher leaves
    const voided = await listCode(book, sellerA, { code: VOIDED, issuer: "courses.example", verifiable: true, price: credit(8), nonce: "um113-void", expiresAt, assetType: "course:gift-code" }); // never issued: the platform has no such code
    const voidedBought = await buyCode(book, secondA, voided, E, { seq: 0, cumulative: "0" });
    publish(ref("voided"), voided.ciphertext);
    expect(await errorCode(serveCode(book, sellerA, voidedBought.purchaseId, voided, ref("voided"), secondA))).toBe("code_unknown");
    const voidedRefused = await book.get(voidedBought.purchaseId);
    expect(voidedRefused.release).toBeNull();
    expect((voidedRefused as any).voucher).toBeUndefined();
    expect(pairOf(second, seller)).toBe("0");

    // --- 4. a gift code bound to the account of its recipient is not sold (the platform forbids resale): refused at the listing, nothing in the book
    const boundCode = "COURSE-GIFT-BOUND-EMAIL-01";
    courseIssuer.issue(boundCode);
    const bound = await listCode({ ...book, postListing: async () => undefined } as never, sellerA, { code: boundCode, issuer: "courses.example", verifiable: true, price: credit(8), nonce: "um113-bound", expiresAt, assetType: "course:gift-code" }); // prepared, not posted
    const boundListing = { ...bound.listing, nonce: "code-um113-bound-id", detail: JSON.stringify({ ...JSON.parse(bound.listing.detail), identity_bound: true }) };
    expect(await errorCode(book.postListing(boundListing, sellerA.secretKey))).toBe("code_bound_to_identity");
    expect(db.prepare("SELECT count(*) AS n FROM listings WHERE nonce = ?").get(boundListing.nonce)).toMatchObject({ n: 0 });

    // --- 5. the codes, the salts and the file keys are not in the read model (D9) and not in the console
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t: any) => t.name as string);
    const stored = JSON.stringify(tables.map((t: string) => db.prepare(`SELECT * FROM "${t}"`).all()), (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    const output = logged.join("\n");
    for (const secret of [COURSE, VOIDED, PREUSED, boundCode, Buffer.from(course.salt).toString("hex"), Buffer.from(course.key).toString("hex")]) {
      expect(stored).not.toContain(secret);
      expect(output).not.toContain(secret);
    }
    vi.restoreAllMocks();
    console.log(["UM-113", `epoch ${E}`, `pair after the course code ${pairOf(buyer, seller)}`, `redeemed code ${usedRefused.status}`, `voided code ${voidedRefused.status}`].join(" | "));
  }, 1_800_000);
});
