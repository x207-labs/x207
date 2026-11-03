// Second security review (facilitator, chainCache, replay). Read as an attacker, no SDK file is changed. A test with `it.fails` documents a
// finding that is open today: it asserts the safe behaviour, and vitest counts it as passing while the behaviour is wrong. When the SDK is
// fixed the test turns red and `.fails` is removed. Findings are written in docs/security-review-2.md.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { signVoucher } from "@x207/core";
import { defineCircleConfig, x207Middleware } from "@x207/scheme";
import { PendingStore, createApp, createFacilitatorService, type NearRpc } from "@x207/facilitator";

const kA = Buffer.from(JSON.parse(readFileSync(new URL("../sdk/spec/test-vectors/keys.json", import.meta.url), "utf8")).keys.kA.seed, "hex");
const KA_PUB = "ed25519:AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9";
const CIRCLE_ACCOUNT = "x207-circle.near";
const A = "a.x207-circle.near";
const B = "b.x207-circle.near";
const CIRCLE = defineCircleConfig({ network: "x207:agents-main", circleContract: CIRCLE_ACCOUNT });
const PRICE = 20_000;
const REQ = { scheme: "batch-settlement", network: "x207:agents-main", amount: String(PRICE), asset: "USD", payTo: B, maxTimeoutSeconds: 60, extra: { circleContract: CIRCLE_ACCOUNT, unit: "credit", decimals: 6, epoch: 42 } };

const voucherBody = (seq: number) => {
  const { signature, ...voucher } = signVoucher(
    { circle: CIRCLE_ACCOUNT, payer: A, payee: B, epoch: 42, seq, cumulativeAmount: String(seq * PRICE), unit: "credit", resource: "https://s.example/api" }, kA,
  );
  return { x402Version: 2, paymentPayload: { x402Version: 2, resource: { url: "https://s.example/api" }, accepted: REQ, payload: { voucher, signature } }, paymentRequirements: REQ };
};

type World = { status: string; headroom: string; registered: { cumulative: string; last_seq: number } | null; cutoffMs: number };
function world(): World {
  return { status: "active", headroom: "1000000", registered: null, cutoffMs: Date.now() + 3_600_000 };
}
const member = (account: string, status: string) => ({
  account_id: account, admitted: false, exit_requested_epoch: null, joined_at: "1", last_active_epoch: 42, limit: "1000000",
  pubkey_voucher: account === A ? KA_PUB : "ed25519:9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu", settled_history: "0", stake: "1000000", status, terms_hash: "0".repeat(64),
});
const rpcOf = (w: World) => ({
  view: async (_c: string, method: string, args: any) => {
    if (method === "get_epoch") return { epoch: 42, cutoff_at: String(BigInt(w.cutoffMs) * 1_000_000n), phase: "open" };
    if (method === "member") return member(args.account_id, args.account_id === A ? w.status : "active");
    if (method === "headroom") return w.status === "active" ? w.headroom : "0"; // the contract answers "0" when the member is not active
    if (method === "obligation") return w.registered;
    throw new Error(`unexpected view ${method}`);
  },
}) as unknown as NearRpc;

function stack(w: World, options: { pendingPath?: string; cache?: boolean; clock?: { ms: number }; verifyNow?: () => number } = {}) {
  const pending = new PendingStore(options.pendingPath ?? ":memory:");
  const service = createFacilitatorService({
    circles: [CIRCLE], rpc: rpcOf(w), pending, ...(options.verifyNow ? { verify: { now: options.verifyNow } } : {}),
    ...(options.cache ? { chainCache: { now: () => options.clock!.ms } } : {}),
  });
  const app = createApp(service);
  const post = (path: string, body: unknown) => app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<any>);
  return { pending, app, post };
}

describe("security review 2: replay of a voucher at /verify and /settle", () => {
  it("TC-SR2-01 the same voucher cannot be used for a second request after /settle", async () => {
    const { post } = stack(world());
    expect((await post("/verify", voucherBody(1))).isValid).toBe(true);
    expect((await post("/settle", voucherBody(1))).success).toBe(true);
    expect(await post("/verify", voucherBody(1))).toMatchObject({ isValid: false, invalidReason: "seq_not_increasing" });
  });

  it("TC-SR2-02 a restart of the facilitator keeps the seq: the pending store is a file", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "sr2-")), "pending.sqlite");
    const first = stack(world(), { pendingPath: path });
    expect((await first.post("/settle", voucherBody(1))).success).toBe(true);
    first.pending.close();
    const restarted = stack(world(), { pendingPath: path });
    expect(await restarted.post("/verify", voucherBody(1))).toMatchObject({ isValid: false, invalidReason: "seq_not_increasing" });
    expect((await restarted.post("/verify", voucherBody(2))).isValid).toBe(true);
  });

  it("TC-SR2-03 a restart with an EMPTY pending store falls back to the chain, so a voucher the chain already counts is refused", async () => {
    const w = world();
    w.registered = { cumulative: String(PRICE), last_seq: 1 };
    const { post } = stack(w);
    expect(await post("/verify", voucherBody(1))).toMatchObject({ isValid: false, invalidReason: "seq_not_increasing" });
  });

  // Finding R1 (fixed in the middleware by the in-flight guard, `voucher_in_flight`): /verify reserves nothing and /settle answers success to the same payload again, so n parallel requests with one voucher pass /verify, run the seller's handler n times, and all settle OK.
  it("TC-SR2-04 n parallel requests with one voucher serve the resource once", async () => {
    const w = world();
    const { app } = stack(w);
    const fetchToApp = ((input: string | URL | Request, init?: RequestInit) => app.request(new URL(String(input)).pathname + new URL(String(input)).search, init)) as unknown as typeof fetch;
    const middleware = x207Middleware({
      routes: { "/api": { price: "$0.02" } }, facilitatorUrl: "http://facilitator.test", circleId: "agents-main", payTo: B, fetch: fetchToApp,
    });
    const handler = vi.fn(async () => new Response("served", { status: 200 }));
    const body = voucherBody(1);
    const header = Buffer.from(JSON.stringify(body.paymentPayload)).toString("base64");
    const responses = await Promise.all(Array.from({ length: 5 }, () => middleware(new Request("https://s.example/api", { headers: { "PAYMENT-SIGNATURE": header } }), handler)));
    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("security review 2: chainCache windows (SD-032, a2aae7a)", () => {
  it("TC-SR2-05 without the cache a payer that was suspended is refused at once", async () => {
    const w = world();
    const { post } = stack(w);
    expect((await post("/verify", voucherBody(1))).isValid).toBe(true);
    w.status = "suspended";
    expect(await post("/verify", voucherBody(2))).toMatchObject({ isValid: false, invalidReason: "member_not_active" });
  });

  // Finding C1 (fixed by shortening `member` to 10 s, the same as `headroom`): a payer suspended inside the window still passes /verify, but only up to the headroom
  // that was cached (TC-SR2-07), and from the end of the window it is refused. The contract refuses the registration, so the loss is the seller's, once per event.
  it("TC-SR2-06 with the cache a payer that was suspended is accepted inside the 10 s window and refused when the window ends", async () => {
    const w = world();
    const clock = { ms: 1_000_000 };
    const { post } = stack(w, { cache: true, clock });
    expect((await post("/verify", voucherBody(1))).isValid).toBe(true);
    w.status = "suspended";
    clock.ms += 9_999;
    expect((await post("/verify", voucherBody(1))).isValid).toBe(true); // inside the window: the documented, bounded loss
    clock.ms += 2;
    expect(await post("/verify", voucherBody(1))).toMatchObject({ isValid: false, invalidReason: "member_not_active" });
  });

  it("TC-SR2-07 the worst loss per payer and window is bounded by the cached headroom: later vouchers are refused as insufficient_credit", async () => {
    const w = world();
    w.headroom = String(5 * PRICE);
    const clock = { ms: 1_000_000 };
    const { post } = stack(w, { cache: true, clock });
    let accepted = 0;
    for (let seq = 1; seq <= 10; seq += 1) {
      const settled = await post("/settle", voucherBody(seq));
      if (settled.success) accepted += 1;
      w.headroom = "0"; // a commit_bundle by the payer reserved all of it after the first read
      clock.ms += 100;
    }
    expect(accepted * PRICE).toBeLessThanOrEqual(5 * PRICE);
    expect(accepted).toBe(5);
  });

  it("TC-SR2-08 after the window the real headroom is read again", async () => {
    const w = world();
    const clock = { ms: 1_000_000 };
    const { post } = stack(w, { cache: true, clock });
    expect((await post("/verify", voucherBody(1))).isValid).toBe(true);
    w.headroom = "0";
    clock.ms += 10_001;
    expect(await post("/verify", voucherBody(1))).toMatchObject({ isValid: false, invalidReason: "insufficient_credit" });
  });

  // Finding C2 (documented, not fixed): the assumption is one relayer per pair (sdk/docs/rpc-load.md, chain-cache.ts). With no pending row the base is the cached `obligation`. A registration by another relayer is not seen for 10 s, so vouchers the chain already counts pass /verify once each.
  it.fails("TC-SR2-09 a voucher that another relayer already registered is refused inside the window", async () => {
    const w = world();
    const clock = { ms: 1_000_000 };
    const { post } = stack(w, { cache: true, clock });
    expect((await post("/verify", voucherBody(1))).isValid).toBe(true); // loads obligation = null into the cache; nothing is settled, so there is no pending row
    w.registered = { cumulative: String(3 * PRICE), last_seq: 3 }; // another relayer registered seq 3
    clock.ms += 5_000;
    expect(await post("/verify", voucherBody(1))).toMatchObject({ isValid: false, invalidReason: "seq_not_increasing" });
  });

  it("TC-SR2-10 the clock check closes the epoch from cutoff - 120 s even when get_epoch is cached for 30 s", async () => {
    const w = world();
    const clock = { ms: 1_000_000 };
    const verifyClock = { ms: Date.now() };
    w.cutoffMs = verifyClock.ms + 130_000;
    const { post } = stack(w, { cache: true, clock, verifyNow: () => verifyClock.ms });
    expect((await post("/verify", voucherBody(1))).isValid).toBe(true);
    verifyClock.ms += 20_000; // the cached epoch still says "open", but the cutoff is 110 s away
    clock.ms += 20_000;
    expect(await post("/verify", voucherBody(1))).toMatchObject({ isValid: false, invalidReason: "epoch_closing" });
  });
});
