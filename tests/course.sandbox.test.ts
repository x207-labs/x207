// UM-111 (#71): an online course of the seller's own, in near-sandbox. The course is sold as a license (P7) and read through an endpoint that is open for a term (30 days).
//   - the teacher sells the course package (syllabus and lesson list) with the hash the listing promised; the student buys it, opens it, checks the hash, confirms, and the teacher
//     registers the voucher: the pair holds 40 credit;
//   - the lessons are served by the teacher's endpoint to the buyer who signs the request with the voucher key of the purchase; the term starts when the teacher sees the purchase
//     confirmed; the lesson answers on day 1 and day 29, and after day 30 the answer is `410 expired`;
//   - somebody who did not buy (a member who signs with its own key), and a request for a purchase that is not confirmed, get `403` and `404`.
// The expiry is the teacher's: x207 sells the license and proves who paid; the endpoint enforces the term. The seller's clock is injected so that the test does not wait 30 days.
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { contentHash, createCircleViewFn, httpsSource, nep413SigningHash, onboardMember, signHash, verifyHash, type ContentRef, type ContentSource, type ContractAbi, type ContractCall } from "@x207/core";
import { FailoverRpcClient, Indexer, RpcBlockSource, createApiServer, openDatabase, rpcChainReader } from "../backend/src/index.ts";
import { viewClearedEdges } from "../backend/src/indexer/view-edges.ts";
import { marketplaceRoutes } from "../backend/src/marketplace/index.ts";
import { TERMS_HASH, deployCircle, type CircleFixture } from "../sdk/test-support/circle.ts";
import { sandboxAvailable, type SandboxAccount } from "../sdk/test-support/sandbox.ts";
import { LicenseBook, buyLicense, listLicense, receiveLicense, serveLicense, type LicenseActor } from "../agents/scenario/license.ts";

const credit = (n: number): string => (BigInt(n) * 1_000_000n).toString();
const text = (s: string) => new TextEncoder().encode(s);
type Member = { account: SandboxAccount; secretKey: `ed25519:${string}`; publicKey: string };

describe.skipIf(!sandboxAvailable)("UM-111 own online course (#71): sold as a license, read through an endpoint that is open for 30 days", () => {
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

  it("TC-UM-111-02 a course is sold with the hash it promised and paid; its lessons are served to the buyer for 30 days, not to somebody else, and not after the term", async () => {
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
    const teacher = await join("teacher");
    const student = await join("student");
    const outsider = await join("outsider");
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
    const [teacherA, studentA] = [actor(teacher), actor(student)];
    const expiresAt = Math.floor(Date.now() / 1000) + 86_400;
    const pairOf = (debtor: Member, creditor: Member) => {
      const row = db.prepare("SELECT cumulative_amount FROM obligations WHERE circle_id = 'agents-main' AND epoch = ? AND debtor = ? AND creditor = ?").get(E, debtor.account.accountId, creditor.account.accountId) as { cumulative_amount: string } | undefined;
      return String(row?.cumulative_amount ?? "0");
    };

    const COURSE_TERM_MS = 30 * 86_400_000;
    const clock = { nowMs: Date.now() };
    const LESSONS: Record<string, string> = { "1": "Lesson 1: what a cumulative voucher is", "2": "Lesson 2: how a cycle clears" };
    const enrolled = new Map<string, number>(); // purchase id -> when the term started (ms), set when the teacher sees the purchase confirmed
    const publicKeyOf = async (account: string): Promise<string | null> => {
      const m = await view_<{ pubkey_voucher?: string } | null>("member", { account_id: account }).catch(() => null);
      return m?.pubkey_voucher ?? null;
    };
    /** The teacher's lesson endpoint: `GET /lesson?purchase=<id>&lesson=<n>&at=<ms>` with the header `x-signature` of the buyer over `x207:course:<purchase>:<lesson>:<at>`. */
    const lessonEndpoint = async (purchase: string, lesson: string, signer: Member): Promise<{ status: number; body: string }> => {
      const started = enrolled.get(purchase);
      const state = await book.get(purchase).catch(() => null);
      if (!state || started === undefined || state.status !== "confirmed") return { status: 404, body: "no confirmed purchase" };
      const at = String(clock.nowMs);
      const message = `x207:course:${purchase}:${lesson}:${at}`;
      const hash = nep413SigningHash(message, createHash("sha256").update(message).digest(), contract);
      const signature = signHash(hash, signer.secretKey);
      const buyerKey = await publicKeyOf(state.buyer); // the voucher key of the buyer of the purchase, read from the contract
      if (buyerKey === null || !verifyHash(hash, signature, buyerKey)) return { status: 403, body: "not the buyer of this purchase" };
      if (clock.nowMs > started + COURSE_TERM_MS) return { status: 410, body: "course access expired" };
      return LESSONS[lesson] ? { status: 200, body: LESSONS[lesson]! } : { status: 404, body: "no such lesson" };
    };

    // --- 1. the teacher sells the course package; the student buys, opens, checks the hash, confirms
    const plain = text(JSON.stringify({ title: "Credit circles in 2 lessons", lessons: Object.keys(LESSONS), endpoint: "/lesson", term_days: 30 }));
    const sold = await listLicense(book, teacherA, { plain, assetType: "course:own-class", licenseId: "personal", nonce: "um111-course", price: credit(40), expiresAt });
    const bought = await buyLicense(book, studentA, sold, E, { seq: 0, cumulative: "0" });
    expect(bought.status).toBe("paid_held");
    const ref: ContentRef = { kind: "https", ref: "https://store.example.com/course.bin" };
    files.set("store.example.com/course.bin", sold.ciphertext);
    expect((await serveLicense(book, teacherA, bought.purchaseId, sold, ref, studentA)).status).toBe("key_released");
    const received = await receiveLicense(book, studentA, bought.purchaseId, teacherA.publicKey, sources);
    expect(received).toMatchObject({ outcome: "confirmed", status: "confirmed" });
    expect(Array.from(received.content!)).toEqual(Array.from(plain));
    const confirmed = await book.get(bought.purchaseId);
    expect(confirmed.voucher).toMatchObject({ payer: studentA.account, payee: teacherA.account, cumulativeAmount: credit(40), epoch: E });
    const r = await teacher.account.call({ receiverId: contract, methodName: "register_cumulative", args: { voucher: confirmed.voucher, signature: confirmed.voucherSignature }, deposit: 0n, gas: 100_000_000_000_000n }, "FINAL");
    expect(r.failures).toEqual([]);
    await catchUp(() => pairOf(student, teacher) === credit(40));

    // --- 2. before the teacher sees the purchase confirmed there is no term: 404. Then the term starts.
    expect((await lessonEndpoint(bought.purchaseId, "1", student)).status).toBe(404);
    enrolled.set(bought.purchaseId, clock.nowMs);
    expect(await lessonEndpoint(bought.purchaseId, "1", student)).toEqual({ status: 200, body: LESSONS["1"] });
    clock.nowMs += 29 * 86_400_000;
    expect(await lessonEndpoint(bought.purchaseId, "2", student)).toEqual({ status: 200, body: LESSONS["2"] });
    // --- 3. a member who did not buy signs with its own key: refused; the term ends after day 30
    expect((await lessonEndpoint(bought.purchaseId, "1", outsider)).status).toBe(403);
    clock.nowMs += 2 * 86_400_000;
    expect(await lessonEndpoint(bought.purchaseId, "1", student)).toEqual({ status: 410, body: "course access expired" });
    expect((await lessonEndpoint("0".repeat(64), "1", student)).status).toBe(404);
    console.log(["UM-111 #71", `epoch ${E}`, `pair ${pairOf(student, teacher)}`, "day 1 200", "day 29 200", "outsider 403", "day 31 410"].join(" | "));
  }, 1_800_000);
});
