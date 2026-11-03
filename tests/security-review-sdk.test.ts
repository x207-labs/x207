// Cross review of the newest SDK code as an attacker (SD-017 InFlightGuard, SD-031 gas key lanes, SD-010 mock Intents fixture). No SDK file is changed. A test with
// `it.fails` asserts the safe behaviour and passes only while the bug exists; G1, G2 and L1 are fixed, so their tests are plain `it` now. Findings are written in backend/docs/security-review-2.md (section "Cross review of the SDK").
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { x207Middleware } from "@x207/scheme";
import { GasKeyLanes } from "@x207/facilitator";

const A = "a.x207-circle.near";
const B = "b.x207-circle.near";
const EXTRA = { circleContract: "x207-circle.near", unit: "credit", decimals: 6, epoch: 42 };
const REQ = { scheme: "batch-settlement", network: "x207:agents-main", amount: "20000", asset: "USD", payTo: B, maxTimeoutSeconds: 60, extra: EXTRA };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const header = (signature: string, payer = A) =>
  Buffer.from(JSON.stringify({
    x402Version: 2, resource: { url: "https://s.example/api/x" }, accepted: REQ,
    payload: { voucher: { circle: "x207-circle.near", payer, payee: B, epoch: 42, seq: 7, cumulativeAmount: "140000", unit: "credit", resource: "https://s.example/api/x" }, signature },
  })).toString("base64");

/** A facilitator that takes `verifyMs` to answer /verify and calls a voucher valid unless its signature is "forged". */
function stack(verifyMs: number, handler: (request: Request) => Promise<Response>, extraOptions: { maxHoldMs?: number } = {}) {
  const fetchFn = (async (input: string | URL) => {
    const url = new URL(String(input));
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (url.pathname === "/supported") return json({ kinds: [{ x402Version: 2, scheme: "batch-settlement", network: "x207:agents-main", extra: EXTRA }], extensions: [], signers: {} });
    if (url.pathname === "/verify") {
      await sleep(verifyMs);
      return json({ isValid: true, payer: A });
    }
    if (url.pathname === "/settle") return json({ success: true, transaction: `${A}:${B}:42:7`, network: "x207:agents-main", payer: A });
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  const middleware = x207Middleware({ routes: { "/api/x": { price: "$0.02" } }, facilitatorUrl: "http://facilitator.test", circleId: "agents-main", payTo: B, fetch: fetchFn, ...extraOptions });
  return (signature: string, signal?: AbortSignal) =>
    middleware(new Request("https://s.example/api/x", { headers: { "PAYMENT-SIGNATURE": header(signature) }, ...(signal ? { signal } : {}) }), handler);
}

describe("cross review: SD-017 InFlightGuard", () => {
  const ok = async () => new Response("served", { status: 200 });

  it("TC-SR3-01 a second request with a held voucher is 409 and the handler runs once (the fix of R1 works)", async () => {
    let ran = 0;
    const call = stack(40, async () => (ran += 1, await sleep(20), new Response("served")));
    const responses = await Promise.all([call("good"), call("good"), call("good")]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(ran).toBe(1);
  });

  // Finding G1 (fixed): the id was taken before /verify. Anybody can send a request with the id of a victim's next voucher (payer, payee, epoch, seq are public: pair-state gives lastSeq)
  // and a signature that /verify will refuse; while that request waits for /verify the real voucher is 409.
  it("TC-SR3-02 a forged request with the id of the real voucher does not block the real one", async () => {
    const call = stack(80, ok);
    const forged = call("forged");
    await sleep(10);
    const real = await call("real");
    await forged;
    expect(real.status).toBe(200);
  });

  // Finding G2 (fixed): a handler that never answers keeps the id for the life of the process, also after the client went away.
  it("TC-SR3-03 the id is given back when the client aborts the request", async () => {
    let hangs = true;
    const call = stack(5, () => (hangs ? new Promise<Response>(() => {}) : Promise.resolve(new Response("served"))));
    const controller = new AbortController();
    void call("good", controller.signal);
    await sleep(60);
    controller.abort();
    hangs = false;
    await sleep(20);
    const again = await call("good");
    expect(again.status).not.toBe(409);
  });

  it("TC-SR3-03b the id is given back after maxHoldMs although the handler never answers and the client stays", async () => {
    const hold = stack(5, () => new Promise<Response>(() => {}), { maxHoldMs: 40 });
    void hold("good");
    await sleep(15);
    expect((await hold("good")).status).toBe(409);
    await sleep(60);
    const again = hold("good");
    expect(await Promise.race([again.then((r) => r.status), sleep(30).then(() => "hanging")])).toBe("hanging"); // the id was free, so the handler runs (and hangs)
  });

  it("TC-SR3-04 a voucher whose seq or epoch is not a number is refused by the payload schema, so it cannot slip past the guard by a missing id", async () => {
    const { validateX207Payload } = await import("@x207/core");
    const base = { circle: "c.near", payer: "a.near", payee: "b.near", epoch: 1, seq: 5, cumulativeAmount: "100", unit: "credit", resource: "r" };
    for (const patch of [{ seq: "5" }, { epoch: "1" }, { seq: 1e21 }, { payer: " a.near" }]) expect(validateX207Payload({ voucher: { ...base, ...patch }, signature: "ed25519:x" }).ok, JSON.stringify(patch)).toBe(false);
  });
});

describe("cross review: SD-031 gas key lanes", () => {
  it("TC-SR3-05 two parallel calls never use one lane, and a failed call makes the lane read its nonce again", async () => {
    const lanes = new GasKeyLanes(2);
    const used: number[] = [];
    let reads = 0;
    const read = async () => (reads += 1, 100n);
    await Promise.all([0, 1].map(() => lanes.run(read, async (lane, nonce) => (used.push(lane), await sleep(20), nonce))));
    expect(new Set(used).size).toBe(2);
    await expect(lanes.run(read, async () => { throw new Error("rpc down"); })).rejects.toThrow("rpc down");
    const before = reads;
    await lanes.run(read, async (_lane, nonce) => nonce);
    await lanes.run(read, async (_lane, nonce) => nonce);
    expect(reads).toBeGreaterThan(before);
  });

  // Finding L1 (fixed): there was no timeout on `work` or `readNonce`; one call that never returned kept its lane for good.
  it("TC-SR3-06 a call that never returns does not stop the next one for good", async () => {
    const lanes = new GasKeyLanes(1, 50);
    void lanes.run(async () => 1n, () => new Promise<never>(() => {})).catch(() => undefined);
    await sleep(10);
    const next = lanes.run(async () => 1n, async (_l, n) => n);
    const result = await Promise.race([next, sleep(300).then(() => "stuck")]);
    expect(result).not.toBe("stuck");
  });

  it("TC-SR3-07 a nonce read that never returns does not hold the lane for good", async () => {
    const lanes = new GasKeyLanes(1, 50);
    void lanes.run(() => new Promise<bigint>(() => {}), async (_l, n) => n).catch(() => undefined);
    await sleep(10);
    const result = await Promise.race([lanes.run(async () => 1n, async (_l, n) => n), sleep(300).then(() => "stuck")]);
    expect(result).not.toBe("stuck");
  });
});

describe("cross review: SD-010 fixture and builder", () => {
  it("TC-SR3-08 the gas of buildWithdrawIntentsBalanceCall covers the minimum the contract asks (130 Tgas) with room for the call itself", async () => {
    const { buildWithdrawIntentsBalanceCall } = await import("../sdk/packages/core/src/index.ts");
    const call = buildWithdrawIntentsBalanceCall("circle.near");
    expect(call.gas).toBeGreaterThanOrEqual(130_000_000_000_000n + 10_000_000_000_000n);
    expect(call.deposit).toBe(0n);
  });

  it("TC-SR3-09 the mock_intents wasm that deployCircle({ mockIntents: true }) deploys has the methods the tests call", () => {
    const path = resolve(import.meta.dirname, "../contracts/target/near/mock_intents/mock_intents.wasm");
    if (!existsSync(path)) return; // a fresh checkout builds it on demand
    const bytes = readFileSync(path).toString("latin1");
    const missing = ["mt_transfer_call", "ft_withdraw", "balance_of", "mt_resolve"].filter((name) => !bytes.includes(name));
    expect(missing, "the wasm is older than probes/mock_intents/src/lib.rs: delete it and build again").toEqual([]);
  });
});
