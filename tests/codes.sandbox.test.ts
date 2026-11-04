// UM-094: one-time codes (P3) in near-sandbox. Two catalog items, both `secret_release` with a mock issuer (AG-030): #27 a gift card code and #87 a beta invitation code.
// A seller and two buyers are members of a real circle on a real contract; the backend runs the code book with two mock issuers and a fake internet serves the ciphertext.
//   - each code is handed over once: the purchase voucher is held, the issuer is asked before the key leaves, the buyer opens the ciphertext, redeems the code at the issuer, confirms,
//     and only then the voucher is released; the seller registers it on the contract and the pair holds the price;
//   - the same code sold a second time (another salt) is refused through the issuer (`code_used`): no key is released, nothing is registered, the pair stays at 0;
//   - a code, its salt and the key of the file are in no table of the read model (D9) and in no console line of the run.
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

const GIFT = "GIFT-7QK2-M9XD-41LP";
const INVITE = "BETA-INV-X3F9-82KD-0QZ7";
/** The issuer of the backend only checks and marks; the buyer agent redeems: ask, and mark used when valid. */
const redeemAt = async (issuer: MockCodeIssuer, c: string): Promise<boolean> => ((await issuer.checkCode(c)) === "valid" ? (issuer.markUsed(c), true) : false);

describe.skipIf(!sandboxAvailable)("UM-094 one-time codes: a gift card code and a beta invitation code are handed over once, a used code is refused through the issuer", () => {
  let fx: CircleFixture;
  let api: Server | undefined;
  afterAll(async () => {
    api?.close();
    await fx?.stop();
  });
  const giftIssuer = new MockCodeIssuer();
  const betaIssuer = new MockCodeIssuer();
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

  it("TC-UM-094-01 a gift card (#27) and a beta invitation (#87) are sold once each and paid on the contract; a code that is already used is refused with no key and no payment", async () => {
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
    api = createApiServer({ db, extraRoutes: marketplaceRoutes(db, { chainView: (_contract: string, method: string, args: object) => view_(method, args), sourceFetch: { resolver, transport }, codeIssuers: { "shop.example": giftIssuer, "beta.example": betaIssuer } }) });
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

    // --- 1. #27 gift card code: 5 credit, checkable at its issuer
    giftIssuer.issue(GIFT);
    const gift = await listCode(book, sellerA, { code: GIFT, issuer: "shop.example", verifiable: true, price: credit(5), nonce: "um094-gift", expiresAt });
    const giftBought = await buyCode(book, buyerA, gift, E, { seq: 0, cumulative: "0" });
    expect(giftBought.status).toBe("paid_held");
    expect((giftBought as any).voucher).toBeUndefined();
    publish(ref("gift"), gift.ciphertext);
    const giftServed = await serveCode(book, sellerA, giftBought.purchaseId, gift, ref("gift"), buyerA);
    expect(giftServed.status).toBe("key_released");
    expect(giftIssuer.calls).toBe(1);
    const giftGot = await receiveCode(book, buyerA, giftBought.purchaseId, sellerA.publicKey, sources, { doc: gift.doc, redeem: async (c) => redeemAt(giftIssuer, c) });
    expect(giftGot).toMatchObject({ outcome: "confirmed", code: GIFT, status: "confirmed" });
    const giftDone = await book.get(giftBought.purchaseId);
    expect(giftDone.voucher).toMatchObject({ payer: buyerA.account, payee: sellerA.account, cumulativeAmount: credit(5), epoch: E });
    await registerHeld(giftDone.voucher, giftDone.voucherSignature);
    await catchUp(() => pairOf(buyer, seller) === credit(5));

    // --- 2. #87 beta invitation code: 3 credit, another issuer, the next voucher of the same pair continues from the held one
    betaIssuer.issue(INVITE);
    const invite = await listCode(book, sellerA, { code: INVITE, issuer: "beta.example", verifiable: true, price: credit(3), nonce: "um094-beta", expiresAt });
    const inviteBought = await buyCode(book, buyerA, invite, E, { seq: 1, cumulative: credit(5) });
    expect(inviteBought.status).toBe("paid_held");
    publish(ref("invite"), invite.ciphertext);
    expect((await serveCode(book, sellerA, inviteBought.purchaseId, invite, ref("invite"), buyerA)).status).toBe("key_released");
    const inviteGot = await receiveCode(book, buyerA, inviteBought.purchaseId, sellerA.publicKey, sources, { doc: invite.doc, redeem: async (c) => redeemAt(betaIssuer, c) });
    expect(inviteGot).toMatchObject({ outcome: "confirmed", code: INVITE, status: "confirmed" });
    const inviteDone = await book.get(inviteBought.purchaseId);
    expect(inviteDone.voucher).toMatchObject({ cumulativeAmount: credit(8) });
    await registerHeld(inviteDone.voucher, inviteDone.voucherSignature);
    await catchUp(() => pairOf(buyer, seller) === credit(8));
    expect(pairOf(buyer, seller)).toBe(credit(8));

    // --- 3. a used code: the same gift code is listed again (another salt) and sold to the second buyer; the issuer says it is used
    const again = await listCode(book, sellerA, { code: GIFT, issuer: "shop.example", verifiable: true, price: credit(5), nonce: "um094-gift-again", expiresAt });
    expect(again.doc.code_commitment).not.toBe(gift.doc.code_commitment);
    const againBought = await buyCode(book, secondA, again, E, { seq: 0, cumulative: "0" });
    publish(ref("again"), again.ciphertext);
    expect(await errorCode(serveCode(book, sellerA, againBought.purchaseId, again, ref("again"), secondA))).toBe("code_used");
    const refused = await book.get(againBought.purchaseId);
    expect(refused.status).toBe("cancelled");
    expect(refused.release).toBeNull();
    expect((refused as any).voucher).toBeUndefined();
    expect(pairOf(second, seller)).toBe("0"); // nothing was registered for the refused sale

    // --- 4. the codes, the salts and the keys of the files are not in the read model (D9) and not in the console
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t: any) => t.name as string);
    const stored = JSON.stringify(tables.map((t: string) => db.prepare(`SELECT * FROM "${t}"`).all()), (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    const output = logged.join("\n");
    for (const secret of [GIFT, INVITE, Buffer.from(gift.salt).toString("hex"), Buffer.from(gift.key).toString("hex"), Buffer.from(invite.salt).toString("hex"), Buffer.from(invite.key).toString("hex")]) {
      expect(stored).not.toContain(secret);
      expect(output).not.toContain(secret);
    }
    vi.restoreAllMocks();
    console.log(["UM-094", `epoch ${E}`, `pair after two codes ${pairOf(buyer, seller)}`, `used code status ${refused.status}`, `used code pair ${pairOf(second, seller)}`].join(" | "));
  }, 1_800_000);
});
