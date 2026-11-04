// BK-008: one class C proxy flow with the real facilitator in near-sandbox and a local mock provider. The grantor keeps the API key of the
// provider in the environment of the broker (no TEE); the lessee pays a voucher per call, and the provider never sees a voucher nor the lessee the key.
// Run: X207_SANDBOX=1 npx vitest run tests/broker-class-c.sandbox.test.ts
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { startBroker, type RunningBroker } from "../backend/broker/src/index.ts";
import { createAgentBuyer } from "../agents/shared/x207.ts";
import { startStack, type Stack } from "../agents/test/stack.ts";
import { sandboxAvailable } from "../sdk/test-support/sandbox.ts";

const SECRET = "sk-live-0123456789abcdefSECRET";
const PRICE = "20000"; // 0.02 credit a call

describe.skipIf(!sandboxAvailable)("BK-008 class C proxy in near-sandbox", () => {
  let stack: Stack | undefined;
  let broker: RunningBroker | undefined;
  let provider: Server | undefined;
  afterAll(async () => {
    await broker?.stop();
    provider?.closeAllConnections?.();
    provider?.close();
    await stack?.stop();
  });

  it("a paid call reaches the provider with the key, a refused or failed call leaves no pending voucher", async () => {
    stack = await startStack();
    const { fx, identity: id } = stack;
    const contract = fx.circle.accountId;
    const sandbox = fx.sandbox;

    // mock provider: wants the key, fails on /v1/echo/boom
    const seen: Array<{ method: string; path: string; auth: string | undefined; payment: boolean }> = [];
    provider = createServer((req, res) => {
      seen.push({ method: req.method ?? "", path: req.url ?? "", auth: req.headers.authorization, payment: "payment-signature" in req.headers });
      if (req.headers.authorization !== `Bearer ${SECRET}`) return void res.writeHead(401).end("unauthorized");
      if (req.url?.endsWith("/boom")) return void res.writeHead(500).end("provider error");
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ echo: req.url }));
    });
    await new Promise<void>((resolve) => provider!.listen(0, "127.0.0.1", resolve));
    const providerUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;

    // owner registers the asset type as class C; the grantor offers, the lessee accepts
    const dao = await sandbox.createAccount("dao", "10");
    const entry = { asset_type: "mock:echo", class: "C", delivery_methods: ["proxy"], accepted_proofs: [], terms_hash: "c1".repeat(32) };
    expect((await dao.call({ receiverId: contract, methodName: "set_asset_class", args: { asset_type: "mock:echo", entry }, deposit: 0n })).failures).toEqual([]);
    const now = await sandbox.blockTimestampMs();
    const offer = await fx.members.get("scraper")!.call({
      receiverId: contract, methodName: "offer_grant", deposit: 0n,
      args: {
        input: {
          asset_type: "mock:echo", delivery_method: "proxy",
          limits: { scope: JSON.stringify({ path_prefixes: ["/v1/echo"], methods: ["POST"] }), quota: "2", expires_at: (BigInt(now + 3_600_000) * 1_000_000n).toString() },
          unit: "call", unit_price: PRICE, operator: null, proof_hash: null, proof_kind: null,
        },
      },
    });
    expect(offer.failures).toEqual([]);
    const grantId = Number(offer.value);
    expect((await fx.members.get("gpu")!.call({ receiverId: contract, methodName: "accept_grant", args: { grant_id: grantId, delivery_pubkey: null }, deposit: 0n })).failures).toEqual([]);

    const brokerAccount = await sandbox.createAccount("broker", "10");
    const lease = await sandbox.createAccount("lease", "10");
    const log: string[] = [];
    broker = await startBroker({
      config: {
        readApiUrl: "http://127.0.0.1:1", circleId: "agents-main", contractId: contract, facilitatorUrl: stack.facilitatorUrl, rpcUrl: sandbox.rpcUrl,
        brokerAccount: brokerAccount.accountId, brokerKey: brokerAccount.secretKey, secretOwner: id.scraper.accountId, // B7-P1: the secret belongs to the grantor of the grant, who is the owner of this broker
        leaseAccount: lease.accountId, leaseKey: lease.secretKey,
        port: 0, dbPath: ":memory:", pollSeconds: 15, providers: [{ assetType: "mock:echo", baseUrl: providerUrl, secretEnv: "MOCK_PROVIDER_KEY" }],
      },
      env: { MOCK_PROVIDER_KEY: SECRET }, poll: false, extraCacheMs: 0, log: (line) => log.push(line),
    });
    const buy = createAgentBuyer(id.gpu, { rpcUrls: [sandbox.rpcUrl] });
    const call = (path: string, method = "POST") => buy(`${broker!.url}/grants/${grantId}/proxy${path}`, { method, body: method === "GET" ? undefined : "{}" });
    const pendingFor = () => stack!.pending.listOpen(contract).filter((p: any) => JSON.stringify(p).includes(id.gpu.accountId) && JSON.stringify(p).includes(id.scraper.accountId));

    // 1: a paid call, forwarded with the key and without the voucher, then settled
    const first = await call("/v1/echo/ping");
    const firstText = await first.text();
    expect(first.status, firstText).toBe(200);
    expect(JSON.parse(firstText)).toEqual({ echo: "/v1/echo/ping" });
    expect(seen).toEqual([{ method: "POST", path: "/v1/echo/ping", auth: `Bearer ${SECRET}`, payment: false }]);
    expect(first.headers.get("PAYMENT-RESPONSE")).toBeTruthy();
    expect(stack.settled).toHaveLength(1);
    expect(pendingFor()).toHaveLength(1);

    // 2: outside the scope (path, then method): refused before payment, nothing sent to the provider, nothing settled
    const wrongPath = await call("/v1/other");
    expect([wrongPath.status, ((await wrongPath.json()) as { error: string }).error]).toEqual([403, "grant_scope_denied"]);
    const wrongMethod = await call("/v1/echo/ping", "GET");
    expect(wrongMethod.status).toBe(403);
    expect(seen).toHaveLength(1);
    expect(stack.settled).toHaveLength(1);

    // 3: the provider fails: the error is passed on, the voucher is not settled, the quota is not used
    const failed = await call("/v1/echo/boom");
    expect(failed.status).toBe(500);
    expect(await failed.text()).toBe("provider error");
    expect(stack.settled).toHaveLength(1);
    expect(pendingFor()).toHaveLength(1);

    // 4: the second call of the quota passes, the third is 429 with nothing settled
    expect((await call("/v1/echo/pong")).status).toBe(200);
    expect(stack.settled).toHaveLength(2);
    const third = await call("/v1/echo/pong");
    expect([third.status, ((await third.json()) as { error: string }).error]).toEqual([429, "grant_quota_exceeded"]);
    expect(stack.settled).toHaveLength(2);
    expect(seen.filter((s) => s.path !== "/v1/echo/boom")).toHaveLength(2);

    // the key is nowhere the lessee or the facilitator can see it
    expect(JSON.stringify(stack.settled)).not.toContain(SECRET);
    expect(log.join("\n")).not.toContain(SECRET);
    expect(first.headers.get("PAYMENT-RESPONSE")).not.toContain(SECRET);
  }, 600_000);
});
