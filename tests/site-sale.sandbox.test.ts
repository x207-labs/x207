// UM-098 (#67 website or online shop, P4, ADR-49): the site is sold in two parts with their own proofs, in near-sandbox. The domain goes through the transfer ledger (the voucher is held until the
// registry shows the domain moved); the admin credentials go once through `secret_release` (sealed to the buyer, who logs in, changes the password and only then confirms). The order is the rule:
//   - the seller hands over the credentials only after the domain is proven; the buyer confirms them only after it took control of the panel; the vouchers are registered only then, and the pair holds the price;
//   - a site whose domain never moves: the window of 7 days passes, the domain transfer is cancelled, the seller never hands over the credentials and gives up that sale: nothing is paid, nothing is registered.
import { afterAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { TRANSFER_WINDOW_SECONDS, createCircleViewFn, httpsSource, onboardMember, type ContentRef, type ContentSource, type ContractAbi, type ContractCall } from "@x207/core";
import { FailoverRpcClient, Indexer, RpcBlockSource, createApiServer, openDatabase, rpcChainReader } from "../backend/src/index.ts";
import { viewClearedEdges } from "../backend/src/indexer/view-edges.ts";
import { marketplaceRoutes } from "../backend/src/marketplace/index.ts";
import { TERMS_HASH, deployCircle, type CircleFixture } from "../sdk/test-support/circle.ts";
import { sandboxAvailable, type SandboxAccount } from "../sdk/test-support/sandbox.ts";
import { HttpCodeBook, type CodeActor } from "../agents/scenario/code.ts";
import { HttpTransferBook, buyerTxt, postTransfer, releasedVoucher, waitForProof, type PairState } from "../agents/scenario/transfer.ts";
import { buySite, cancelCredentials, handOverCredentials, prepareSite, takeOverSite } from "../agents/scenario/site.ts";
import { DnsTxtProof } from "../backend/src/marketplace/transfer-proofs.ts";

const credit = (n: number): string => (BigInt(n) * 1_000_000n).toString();
const text = (s: string) => new TextEncoder().encode(s);
type Member = { account: SandboxAccount; secretKey: `ed25519:${string}`; publicKey: string };

describe.skipIf(!sandboxAvailable)("UM-098 website (#67): the domain is proven, then the credentials are handed over once and taken over, then paid; a domain that never moves pays nothing", () => {
  let fx: CircleFixture;
  let api: Server | undefined;
  afterAll(async () => {
    api?.close();
    await fx?.stop();
  });
  // the platforms: DNS over HTTPS and the RDAP of the registry; the clock of the backend is moved instead of waiting 7 days
  const dns = new Map<string, string[]>();
  const rdap = new Map<string, unknown>();
  const clock = { now: Date.now() };
  /** What the "internet" serves: https://store.example.com/<path> -> bytes. */
  const files = new Map<string, Uint8Array>();
  const reply = (status: number, b: unknown) => ({ status, body: Buffer.from(JSON.stringify(b)), truncated: false });
  const transport = async ({ host, path, method, onChunk }: any) => {
    if (host === "dns.google") {
      const name = new URL(`https://x${path}`).searchParams.get("name") ?? "";
      const records = dns.get(name);
      return records === undefined ? reply(200, { Status: 3 }) : reply(200, { Status: 0, Answer: records.map((r) => ({ name, type: 16, TTL: 60, data: `"${r}"` })) });
    }
    if (host === "rdap.verisign.com") return rdap.has(path.split("/").pop() ?? "") ? reply(200, rdap.get(path.split("/").pop() ?? "")) : reply(404, null);
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

  it("TC-UM-098-02 a site is paid after the domain is proven and the credentials are taken over; a site whose domain never moves is not paid and its credentials are never handed over", async () => {
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
    api = createApiServer({ db, now: () => clock.now, extraRoutes: marketplaceRoutes(db, { chainView: (_contract: string, method: string, args: object) => view_(method, args), sourceFetch: { resolver, transport }, dnsTxt: new DnsTxtProof({ resolver, transport }), proofMinSeconds: 0 }) });
    await new Promise<void>((resolve) => api!.listen(0, "127.0.0.1", resolve));
    const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    const base = `${apiUrl}/x207/circles/agents-main`;
    const clockS = () => Math.floor(clock.now / 1000);
    const codes = new HttpCodeBook(apiUrl, "agents-main", contract, clockS);
    const transfers = new HttpTransferBook(apiUrl, "agents-main", contract, clockS);
    await catchUp(() => (db.prepare("select count(*) as n from members").get() as { n: number }).n === 3);
    const E = (await view_<ContractAbi.EpochView>("get_epoch", {})).epoch;
    const actor = (m: Member): CodeActor => ({ account: m.account.accountId, secretKey: m.secretKey, publicKey: m.publicKey });
    const [sellerA, buyerA, secondA] = [actor(seller), actor(buyer), actor(second)];
    const expiresAt = clockS() + 30 * 86_400;
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

    const DOMAIN = "agent-shop.com";
    const wait = async () => { clock.now += 1_000; };
    const pair = (): PairState => ({ seq: 0, cumulative: "0" });
    const ADMIN = "admin-user=shop-admin admin-password=Zx9-hQ4r-7Lm2-Pv8w";
    /** The admin panel of the shop (a fake): the credentials work once, the buyer logs in and changes the password, and the old credentials stop working. */
    const panel = { password: "Zx9-hQ4r-7Lm2-Pv8w", rotated: false };
    const takeControl = async (credentials: string): Promise<boolean> => {
      if (!credentials.endsWith(panel.password)) return false;
      panel.password = "new-password-of-the-buyer";
      panel.rotated = true;
      return true;
    };

    // --- 1. a site sold in two parts: the domain 70 credit, the admin credentials 20 credit
    const sale = await prepareSite(transfers, codes, sellerA, { domain: DOMAIN, domainPrice: credit(70), credentials: ADMIN, credentialsPrice: credit(20), nonce: "um098-site", expiresAt });
    expect(await errorCode(postTransfer(transfers, sellerA, sale.domain))).toBe("transfer_seller_unproven"); // the seller must control the domain before the listing
    dns.set(DOMAIN, [sale.domain.sellerTxt!]);
    await postTransfer(transfers, sellerA, sale.domain);
    const p = pair();
    const bought = await buySite(transfers, codes, buyerA, sale, E, p);
    expect([bought.transfer.status, bought.credentials.status]).toEqual(["paid_held", "paid_held"]);
    expect(p).toEqual({ seq: 2, cumulative: credit(90) });
    // the domain is not proven: the seller does not hand over the credentials, and nothing is registered
    expect((await errorCode(handOverCredentials(transfers, codes, sellerA, sale, bought, ref("site"), buyerA)))).toBe("domain_not_proven");
    expect((await codes.get(bought.credentials.purchaseId)).status).toBe("paid_held");
    // the registrar moves the domain, the registry settles; the buyer asks for the proof
    dns.set(DOMAIN, [sale.domain.sellerTxt!, buyerTxt(bought.transfer)]);
    rdap.set(DOMAIN, { ldhName: DOMAIN, status: ["active"] });
    const proved = await waitForProof(transfers, bought.transfer.transferId, { tries: 2, wait });
    expect(proved.outcome).toBe("confirmed");
    const domainVoucher = releasedVoucher((proved as { transfer: any }).transfer);
    expect(domainVoucher.voucher).toMatchObject({ seq: 1, cumulativeAmount: credit(70) });
    // now the credentials are handed over once: sealed to the buyer
    publish(ref("site"), sale.credentials.ciphertext);
    expect((await handOverCredentials(transfers, codes, sellerA, sale, bought, ref("site"), buyerA)).status).toBe("key_released");
    expect(panel.rotated).toBe(false);
    // the buyer takes control of the panel (log in, change the password) and only then confirms
    const taken = await takeOverSite(codes, buyerA, bought, sale, sellerA.publicKey, sources, takeControl);
    expect(taken).toMatchObject({ outcome: "confirmed", status: "confirmed" });
    expect(panel.rotated).toBe(true);
    expect(await takeControl(ADMIN)).toBe(false); // the old credentials no longer work
    const credentialsDone = await codes.get(bought.credentials.purchaseId);
    expect(credentialsDone.voucher).toMatchObject({ payer: buyerA.account, payee: sellerA.account, seq: 2, cumulativeAmount: credit(90), epoch: E });
    expect(pairOf(buyer, seller)).toBe("0"); // both are released, none is registered yet
    await registerHeld(domainVoucher.voucher, domainVoucher.signature);
    await registerHeld(credentialsDone.voucher, credentialsDone.voucherSignature);
    await catchUp(() => pairOf(buyer, seller) === credit(90));
    expect(pairOf(buyer, seller)).toBe(credit(90));

    // --- 2. a site whose domain never moves: the window passes, the domain transfer is cancelled, the credentials are never handed over and that sale is given up
    const lost = await prepareSite(transfers, codes, sellerA, { domain: "slow-shop.com", domainPrice: credit(60), credentials: "admin-user=slow-admin admin-password=Qw3-eR5t-Yu7i-Op9a", credentialsPrice: credit(20), nonce: "um098-lost", expiresAt });
    dns.set("slow-shop.com", [lost.domain.sellerTxt!]);
    await postTransfer(transfers, sellerA, lost.domain);
    const bought2 = await buySite(transfers, codes, secondA, lost, E, pair());
    clock.now += (TRANSFER_WINDOW_SECONDS.domain + 60) * 1000;
    const late = await transfers.getTransfer(bought2.transfer.transferId);
    expect([late.status, late.cancelReason, late.voucher]).toEqual(["cancelled", "transfer_window_passed", undefined]);
    expect((await errorCode(handOverCredentials(transfers, codes, sellerA, lost, bought2, ref("lost"), secondA)))).toBe("domain_not_proven");
    const cancelled = await cancelCredentials(codes, sellerA, bought2.credentials.purchaseId);
    expect([cancelled.status, (cancelled as any).voucher]).toEqual(["cancelled", undefined]);
    await new Promise((r) => setTimeout(r, 3_000));
    expect(pairOf(second, seller)).toBe("0"); // nothing was registered for the site whose domain did not move

    // --- 3. the credentials, their salt and the key of the file are in no table of the read model (D9)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t: any) => t.name as string);
    const stored = JSON.stringify(tables.map((t: string) => db.prepare(`SELECT * FROM "${t}"`).all()), (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    for (const secret of [ADMIN, "Zx9-hQ4r-7Lm2-Pv8w", Buffer.from(sale.credentials.salt).toString("hex"), Buffer.from(sale.credentials.key).toString("hex")]) expect(stored).not.toContain(secret);
    console.log(["UM-098", "#67", `epoch ${E}`, `site pair ${pairOf(buyer, seller)}`, `lost site pair ${pairOf(second, seller)}`, `lost domain ${late.cancelReason}`].join(" | "));
  }, 1_800_000);
});
