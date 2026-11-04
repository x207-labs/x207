// UM-100: two more one-time secrets of pipeline P3 in near-sandbox, both `secret_release` with a mock issuer (the pattern of UM-094, tests/codes.sandbox.test.ts):
// #28 a software license key and #74 a game code or activation key.
//   - the issuer is asked BEFORE the key leaves the seller (the backend asks once; a key that is already activated is refused `code_used`, with no key released and no payment);
//   - the buyer activates the key at the issuer AFTER the handover: before that the pair holds 0 and the purchase has no voucher, after it the issuer says `used`, the voucher is in the answer
//     and only then the seller registers it on the contract: the pair holds the price;
//   - a key bound to an account or a region (the code document says `identity_bound`) is not sold at all: `code_bound_to_identity` at the listing, nothing in the book;
//   - a key, its salt and the key of the file are in no table of the read model (D9) and in no console line of the run.
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

const LICENSE = "LIC-4F7Q-91ZD-K2MX-77PA";
const GAME = "GAME-XK3-9D2-QP7-L0M";
const PREUSED = "LIC-USED-0000-AAAA-1111";
/** The issuer of the backend only checks and marks; the buyer agent redeems: ask, and mark used when valid. */
const redeemAt = async (issuer: MockCodeIssuer, c: string): Promise<boolean> => ((await issuer.checkCode(c)) === "valid" ? (issuer.markUsed(c), true) : false);

describe.skipIf(!sandboxAvailable)("UM-100 one-time keys: a software license key (#28) and a game activation key (#74) are handed over once, an activated key is refused before the handover", () => {
  let fx: CircleFixture;
  let api: Server | undefined;
  afterAll(async () => {
    api?.close();
    await fx?.stop();
  });
  const licenseIssuer = new MockCodeIssuer();
  const gameIssuer = new MockCodeIssuer();
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

  it("TC-UM-100-01 a license key (#28) and a game key (#74) are checked at the issuer before and after the handover and paid on the contract only after the buyer activates; an activated key and an identity-bound key are refused", async () => {
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
    api = createApiServer({ db, extraRoutes: marketplaceRoutes(db, { chainView: (_contract: string, method: string, args: object) => view_(method, args), sourceFetch: { resolver, transport }, codeIssuers: { "licenses.example": licenseIssuer, "games.example": gameIssuer } }) });
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

    // --- 1. #28 software license key: 6 credit. Nothing is registered before the buyer activates.
    licenseIssuer.issue(LICENSE);
    const lic = await listCode(book, sellerA, { code: LICENSE, issuer: "licenses.example", verifiable: true, price: credit(6), nonce: "um100-license", expiresAt, assetType: "license:key" });
    const licBought = await buyCode(book, buyerA, lic, E, { seq: 0, cumulative: "0" });
    expect(licBought.status).toBe("paid_held");
    expect((licBought as any).voucher).toBeUndefined();
    expect(pairOf(buyer, seller)).toBe("0");
    publish(ref("license"), lic.ciphertext);
    const licServed = await serveCode(book, sellerA, licBought.purchaseId, lic, ref("license"), buyerA);
    expect(licServed.status).toBe("key_released");
    expect(licenseIssuer.calls).toBe(1); // BEFORE the handover: the backend asked the issuer once, and the key was valid
    expect(await licenseIssuer.checkCode(LICENSE)).toBe("valid"); // the handover alone did not use the key
    expect(pairOf(buyer, seller)).toBe("0");
    expect(((await book.get(licBought.purchaseId)) as any).voucher).toBeUndefined();
    const licGot = await receiveCode(book, buyerA, licBought.purchaseId, sellerA.publicKey, sources, { doc: lic.doc, redeem: async (c) => redeemAt(licenseIssuer, c) });
    expect(licGot).toMatchObject({ outcome: "confirmed", code: LICENSE, status: "confirmed" });
    expect(await licenseIssuer.checkCode(LICENSE)).toBe("used"); // AFTER: the buyer activated it
    const licDone = await book.get(licBought.purchaseId);
    expect(licDone.voucher).toMatchObject({ payer: buyerA.account, payee: sellerA.account, cumulativeAmount: credit(6), epoch: E });
    await registerHeld(licDone.voucher, licDone.voucherSignature);
    await catchUp(() => pairOf(buyer, seller) === credit(6));

    // --- 2. #74 game activation key: 4 credit, another issuer; the voucher of the same pair continues from the registered one
    gameIssuer.issue(GAME);
    const game = await listCode(book, sellerA, { code: GAME, issuer: "games.example", verifiable: true, price: credit(4), nonce: "um100-game", expiresAt, assetType: "game:key-code" });
    const gameBought = await buyCode(book, buyerA, game, E, { seq: 1, cumulative: credit(6) });
    expect(gameBought.status).toBe("paid_held");
    expect(pairOf(buyer, seller)).toBe(credit(6)); // the held voucher is not registered
    publish(ref("game"), game.ciphertext);
    expect((await serveCode(book, sellerA, gameBought.purchaseId, game, ref("game"), buyerA)).status).toBe("key_released");
    expect(gameIssuer.calls).toBe(1);
    expect(await gameIssuer.checkCode(GAME)).toBe("valid");
    const gameGot = await receiveCode(book, buyerA, gameBought.purchaseId, sellerA.publicKey, sources, { doc: game.doc, redeem: async (c) => redeemAt(gameIssuer, c) });
    expect(gameGot).toMatchObject({ outcome: "confirmed", code: GAME, status: "confirmed" });
    expect(await gameIssuer.checkCode(GAME)).toBe("used");
    const gameDone = await book.get(gameBought.purchaseId);
    expect(gameDone.voucher).toMatchObject({ cumulativeAmount: credit(10) });
    await registerHeld(gameDone.voucher, gameDone.voucherSignature);
    await catchUp(() => pairOf(buyer, seller) === credit(10));

    // --- 3. a key that was activated before the sale (elsewhere): refused BEFORE the handover, no key, no payment
    licenseIssuer.issue(PREUSED);
    licenseIssuer.markUsed(PREUSED);
    const used = await listCode(book, sellerA, { code: PREUSED, issuer: "licenses.example", verifiable: true, price: credit(6), nonce: "um100-used", expiresAt, assetType: "license:key" });
    const usedBought = await buyCode(book, secondA, used, E, { seq: 0, cumulative: "0" });
    publish(ref("used"), used.ciphertext);
    expect(await errorCode(serveCode(book, sellerA, usedBought.purchaseId, used, ref("used"), secondA))).toBe("code_used");
    const refused = await book.get(usedBought.purchaseId);
    expect(refused.status).toBe("cancelled");
    expect(refused.release).toBeNull();
    expect((refused as any).voucher).toBeUndefined();
    expect(pairOf(second, seller)).toBe("0");

    // --- 4. a key bound to an account or a region is not sold (it stays class X in the catalog): the listing is refused and nothing is in the book
    const boundCode = "LIC-BOUND-ACCT-0001";
    licenseIssuer.issue(boundCode);
    const bound = await listCode({ ...book, postListing: async () => undefined } as never, sellerA, { code: boundCode, issuer: "licenses.example", verifiable: true, price: credit(6), nonce: "um100-bound", expiresAt, assetType: "license:key" }); // prepared, not posted
    const boundListing = { ...bound.listing, nonce: "code-um100-bound-id", detail: JSON.stringify({ ...JSON.parse(bound.listing.detail), identity_bound: true }) };
    expect(await errorCode(book.postListing(boundListing, sellerA.secretKey))).toBe("code_bound_to_identity");
    expect(db.prepare("SELECT count(*) AS n FROM listings WHERE nonce = ?").get(boundListing.nonce)).toMatchObject({ n: 0 }); // no row in the listing book

    // --- 5. the keys, the salts and the file keys are not in the read model (D9) and not in the console
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t: any) => t.name as string);
    const stored = JSON.stringify(tables.map((t: string) => db.prepare(`SELECT * FROM "${t}"`).all()), (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    const output = logged.join("\n");
    for (const secret of [LICENSE, GAME, PREUSED, boundCode, Buffer.from(lic.salt).toString("hex"), Buffer.from(lic.key).toString("hex"), Buffer.from(game.salt).toString("hex"), Buffer.from(game.key).toString("hex")]) {
      expect(stored).not.toContain(secret);
      expect(output).not.toContain(secret);
    }
    vi.restoreAllMocks();
    console.log(["UM-100", `epoch ${E}`, `pair after two keys ${pairOf(buyer, seller)}`, `activated key status ${refused.status}`, `activated key pair ${pairOf(second, seller)}`].join(" | "));
  }, 1_800_000);
});
