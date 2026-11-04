// UM-109: the last two items of pipeline P3 that run through the class C proxy of the broker, in near-sandbox with mock providers (the pattern of BK-008, tests/broker-class-c.sandbox.test.ts):
//   #61 `ai-credit:api`: the credit of an AI model API. The grantor keeps the key in the environment of the broker; a lessee pays 0.015 credit a call and the broker calls the model with the key.
//   #64 `maps:geocoding-quota`: the quota of a map and geocoding API, with the key in another header (`x-api-key`) and a GET with a query string, 0.005 credit a call.
// What each scenario shows, with a mock provider that keeps its own books:
//   - the key never leaves the broker: not in an answer, not in a header, not in the log of the broker, not in what the facilitator settled; a provider that echoes the request headers gets the key
//     taken out of its answer; an `authorization` header that the lessee sends is not forwarded (the provider sees the key of the grantor, not the header of the lessee);
//   - the meter is the `call`: every paid call is one unit of the quota of the grant, one voucher, and one use of the provider; a call that fails at the provider is not paid and not counted;
//   - when the quota is used up the call is refused (429 `grant_quota_exceeded`) before the provider is asked and before anything is paid;
//   - the scope holds: a path or a method outside it is refused before payment.
// Needs the near-sandbox (X207_SANDBOX=1). Run: X207_SANDBOX=1 npx vitest run tests/proxy-credit-quota.sandbox.test.ts
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { startBroker, type RunningBroker } from "../backend/broker/src/index.ts";
import { createAgentBuyer } from "../agents/shared/x207.ts";
import { startStack, type Stack } from "../agents/test/stack.ts";
import { sandboxAvailable } from "../sdk/test-support/sandbox.ts";

const AI_KEY = "sk-um109-0123456789abcdefAIKEYSECRET";
const MAPS_KEY = "maps-um109-fedcba9876543210MAPSKEYSECRET";
const AI_PRICE = "15000"; // 0.015 credit a call
const MAPS_PRICE = "5000"; // 0.005 credit a call

const listen = (server: Server) => new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));

describe.skipIf(!sandboxAvailable)("UM-109 class C proxy: the credit of an AI API (#61) and the quota of a map API (#64)", () => {
  let stack: Stack | undefined;
  let broker: RunningBroker | undefined;
  const servers: Server[] = [];
  afterAll(async () => {
    await broker?.stop();
    for (const s of servers) {
      s.closeAllConnections?.();
      s.close();
    }
    await stack?.stop();
  });

  it("TC-UM-109-01 the key stays in the broker, every paid call is one unit of the meter, a failed call is not paid, and a used-up quota refuses the call before the provider and before payment", async () => {
    stack = await startStack();
    const { fx, identity: id } = stack;
    const contract = fx.circle.accountId;
    const sandbox = fx.sandbox;

    // ---- two mock providers that keep their own books: the AI provider has a credit of its own (two model calls), the map provider counts its requests
    const ai = { seen: [] as Array<{ method: string; path: string; auth: string | undefined; payment: boolean }>, credit: 2 };
    const aiProvider = createServer((req, res) => {
      ai.seen.push({ method: req.method ?? "", path: req.url ?? "", auth: req.headers.authorization, payment: "payment-signature" in req.headers });
      if (req.headers.authorization !== `Bearer ${AI_KEY}`) return void res.writeHead(401).end("unauthorized");
      if (req.url?.endsWith("/debug")) return void res.writeHead(200, { "content-type": "application/json", "x-echo-auth": String(req.headers.authorization) }).end(JSON.stringify({ headers: req.headers }));
      if (ai.credit <= 0) return void res.writeHead(402).end("insufficient credit at the provider");
      ai.credit -= 1;
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content: "ok" } }], creditLeft: ai.credit }));
    });
    const maps = { seen: [] as Array<{ method: string; url: string; key: string | undefined; auth: string | undefined }> };
    const mapsProvider = createServer((req, res) => {
      maps.seen.push({ method: req.method ?? "", url: req.url ?? "", key: req.headers["x-api-key"] as string | undefined, auth: req.headers.authorization });
      if (req.headers["x-api-key"] !== MAPS_KEY) return void res.writeHead(403).end("bad key");
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ results: [{ lat: -6.2, lon: 106.8, q: new URL(req.url ?? "/", "http://x").searchParams.get("q") }] }));
    });
    servers.push(aiProvider, mapsProvider);
    const aiUrl = await listen(aiProvider);
    const mapsUrl = await listen(mapsProvider);

    // ---- the owner registers both asset types as class C; the grantor offers two grants (the quota of each is the meter), the lessee accepts
    const dao = await sandbox.createAccount("dao", "10");
    for (const assetType of ["ai-credit:api", "maps:geocoding-quota"]) {
      const entry = { asset_type: assetType, class: "C", delivery_methods: ["proxy"], accepted_proofs: [], terms_hash: "c1".repeat(32) };
      expect((await dao.call({ receiverId: contract, methodName: "set_asset_class", args: { asset_type: assetType, entry }, deposit: 0n })).failures).toEqual([]);
    }
    const now = await sandbox.blockTimestampMs();
    const offerGrant = async (assetType: string, scope: object, quota: string, price: string) => {
      const offer = await fx.members.get("scraper")!.call({
        receiverId: contract, methodName: "offer_grant", deposit: 0n,
        args: { input: { asset_type: assetType, delivery_method: "proxy", limits: { scope: JSON.stringify(scope), quota, expires_at: (BigInt(now + 3_600_000) * 1_000_000n).toString() }, unit: "call", unit_price: price, operator: null, proof_hash: null, proof_kind: null } },
      });
      expect(offer.failures).toEqual([]);
      const grantId = Number(offer.value);
      expect((await fx.members.get("gpu")!.call({ receiverId: contract, methodName: "accept_grant", args: { grant_id: grantId, delivery_pubkey: null }, deposit: 0n })).failures).toEqual([]);
      return grantId;
    };
    const aiGrant = await offerGrant("ai-credit:api", { path_prefixes: ["/v1/chat"], methods: ["POST"] }, "3", AI_PRICE);
    const mapsGrant = await offerGrant("maps:geocoding-quota", { path_prefixes: ["/geocode"], methods: ["GET"] }, "3", MAPS_PRICE);

    const brokerAccount = await sandbox.createAccount("broker", "10");
    const lease = await sandbox.createAccount("lease", "10");
    const log: string[] = [];
    broker = await startBroker({
      config: {
        readApiUrl: "http://127.0.0.1:1", circleId: "agents-main", contractId: contract, facilitatorUrl: stack.facilitatorUrl, rpcUrl: sandbox.rpcUrl,
        brokerAccount: brokerAccount.accountId, brokerKey: brokerAccount.secretKey, secretOwner: id.scraper.accountId,
        leaseAccount: lease.accountId, leaseKey: lease.secretKey, port: 0, dbPath: ":memory:", pollSeconds: 15,
        providers: [
          { assetType: "ai-credit:api", baseUrl: aiUrl, secretEnv: "UM109_AI_KEY" },
          { assetType: "maps:geocoding-quota", baseUrl: mapsUrl, secretEnv: "UM109_MAPS_KEY", header: "x-api-key", prefix: "" },
        ],
      },
      env: { UM109_AI_KEY: AI_KEY, UM109_MAPS_KEY: MAPS_KEY }, poll: false, extraCacheMs: 0, log: (line) => log.push(line),
    });
    const buy = createAgentBuyer(id.gpu, { rpcUrls: [sandbox.rpcUrl] });
    // the lessee also sends an `authorization` header of its own and a header that names the key of the maps provider: neither may reach a provider
    const ownHeaders = { authorization: "Bearer lessee-own-token", "x-api-key": "lessee-own-key" };
    const aiCall = (path: string, method = "POST") => buy(`${broker!.url}/grants/${aiGrant}/proxy${path}`, { method, headers: ownHeaders, body: method === "GET" ? undefined : JSON.stringify({ model: "m", messages: [] }) });
    const mapsCall = (path: string, method = "GET") => buy(`${broker!.url}/grants/${mapsGrant}/proxy${path}`, { method, headers: ownHeaders, body: method === "GET" ? undefined : "{}" });
    // what the broker, the facilitator and the lessee can see; the providers themselves are NOT in this list: a provider receives the key, that is what the key is for
    const everything = (): string => [log.join("\n"), JSON.stringify(stack!.settled)].join("\n");

    // ---- #61 the credit of an AI API
    const first = await aiCall("/v1/chat/completions");
    const firstText = await first.text();
    expect(first.status, firstText).toBe(200);
    expect(JSON.parse(firstText)).toMatchObject({ creditLeft: 1 });
    expect(ai.seen).toEqual([{ method: "POST", path: "/v1/chat/completions", auth: `Bearer ${AI_KEY}`, payment: false }]); // the provider saw the key of the grantor, not the header of the lessee, and no voucher
    expect(first.headers.get("PAYMENT-RESPONSE")).toBeTruthy();
    expect(stack.settled).toHaveLength(1);

    // a path and a method outside the scope: refused before payment, nothing reaches the provider
    const outsidePath = await aiCall("/v1/models");
    expect([outsidePath.status, ((await outsidePath.json()) as { error: string }).error]).toEqual([403, "grant_scope_denied"]);
    expect((await aiCall("/v1/chat/completions", "GET")).status).toBe(403);
    expect(ai.seen).toHaveLength(1);
    expect(stack.settled).toHaveLength(1);

    // the model call counts one unit; the second passes too, and the provider has used its two units of credit
    expect((await aiCall("/v1/chat/ping")).status).toBe(200);
    expect(ai.credit).toBe(0);
    expect(stack.settled).toHaveLength(2);

    // the provider is out of credit (402 at the provider): the answer is passed on, it is not paid, the grant keeps its last unit
    const dry = await aiCall("/v1/chat/more");
    expect(dry.status).toBe(402);
    expect(await dry.text()).toBe("insufficient credit at the provider");
    expect(stack.settled).toHaveLength(2);
    ai.credit = 5; // the grantor tops the provider up; the third and last unit of the quota is used by the next call
    expect((await aiCall("/v1/chat/three")).status).toBe(200);
    expect(stack.settled).toHaveLength(3);
    const used = ai.seen.length;

    // the quota of the grant is used up: refused before the provider is asked and before payment
    const over = await aiCall("/v1/chat/four");
    expect([over.status, ((await over.json()) as { error: string }).error]).toEqual([429, "grant_quota_exceeded"]);
    expect(ai.seen).toHaveLength(used);
    expect(stack.settled).toHaveLength(3);
    expect(ai.credit).toBe(4); // three units were bought, three used; the provider credit that the grantor added stays with the grantor

    // ---- #64 the quota of a map API: another header for the key, a GET with a query string
    const geocode = await mapsCall("/geocode?q=monas");
    const geocodeText = await geocode.text();
    expect(geocode.status, geocodeText).toBe(200);
    expect(JSON.parse(geocodeText).results[0].q).toBe("monas");
    expect(maps.seen).toEqual([{ method: "GET", url: "/geocode?q=monas", key: MAPS_KEY, auth: undefined }]); // the key in its header; the header of the lessee did not get through
    expect((await mapsCall("/admin/keys")).status).toBe(403);
    expect((await mapsCall("/geocode?q=x", "POST")).status).toBe(403);
    expect(maps.seen).toHaveLength(1);
    expect((await mapsCall("/geocode?q=bandung")).status).toBe(200);
    expect((await mapsCall("/geocode?q=medan")).status).toBe(200);
    const settledBefore = stack.settled.length;
    const mapsOver = await mapsCall("/geocode?q=surabaya");
    expect([mapsOver.status, ((await mapsOver.json()) as { error: string }).error]).toEqual([429, "grant_quota_exceeded"]);
    expect(maps.seen).toHaveLength(3);
    expect(stack.settled).toHaveLength(settledBefore);
    expect(stack.settled).toHaveLength(6); // three AI calls and three map calls: one voucher per call

    // ---- the keys are nowhere the lessee, the facilitator or a log can see them
    expect(everything()).not.toContain(AI_KEY);
    expect(everything()).not.toContain(MAPS_KEY);
    for (const response of [first, geocode, over, mapsOver]) expect(JSON.stringify([...response.headers])).not.toMatch(/AIKEYSECRET|MAPSKEYSECRET/);
    expect(firstText + geocodeText).not.toMatch(/AIKEYSECRET|MAPSKEYSECRET/);
    console.log(["UM-109", `ai units ${3} of 3`, `maps units ${3} of 3`, `vouchers settled ${stack.settled.length}`].join(" | "));
  }, 900_000);

  it("TC-UM-109-02 a provider that echoes the request headers gets the key taken out of its answer, in the body and in a header", async () => {
    expect(stack).toBeDefined();
    const { identity: id, fx } = stack!;
    const echo = createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json", "x-echo-auth": String(req.headers.authorization) }).end(JSON.stringify({ headers: req.headers }));
    });
    servers.push(echo);
    const echoUrl = await listen(echo);
    const sandbox = fx.sandbox;
    // the asset type is registered by the first test; the echo goes through a second broker whose provider echoes the request headers
    const brokerAccount = await sandbox.createAccount("broker2", "10");
    const lease = await sandbox.createAccount("lease2", "10");
    const log: string[] = [];
    const now = await sandbox.blockTimestampMs();
    const offer = await fx.members.get("scraper")!.call({
      receiverId: fx.circle.accountId, methodName: "offer_grant", deposit: 0n,
      args: { input: { asset_type: "ai-credit:api", delivery_method: "proxy", limits: { scope: JSON.stringify({ path_prefixes: ["/v1/chat"], methods: ["POST"] }), quota: "1", expires_at: (BigInt(now + 3_600_000) * 1_000_000n).toString() }, unit: "call", unit_price: AI_PRICE, operator: null, proof_hash: null, proof_kind: null } },
    });
    expect(offer.failures).toEqual([]);
    const grantId = Number(offer.value);
    expect((await fx.members.get("gpu")!.call({ receiverId: fx.circle.accountId, methodName: "accept_grant", args: { grant_id: grantId, delivery_pubkey: null }, deposit: 0n })).failures).toEqual([]);
    const second = await startBroker({
      config: {
        readApiUrl: "http://127.0.0.1:1", circleId: "agents-main", contractId: fx.circle.accountId, facilitatorUrl: stack!.facilitatorUrl, rpcUrl: sandbox.rpcUrl,
        brokerAccount: brokerAccount.accountId, brokerKey: brokerAccount.secretKey, secretOwner: id.scraper.accountId, leaseAccount: lease.accountId, leaseKey: lease.secretKey,
        port: 0, dbPath: ":memory:", pollSeconds: 15, providers: [{ assetType: "ai-credit:api", baseUrl: echoUrl, secretEnv: "UM109_AI_KEY" }],
      },
      env: { UM109_AI_KEY: AI_KEY }, poll: false, extraCacheMs: 0, log: (line) => log.push(line),
    });
    try {
      const buy = createAgentBuyer(id.gpu, { rpcUrls: [sandbox.rpcUrl] });
      const response = await buy(`${second.url}/grants/${grantId}/proxy/v1/chat/echo`, { method: "POST", body: "{}" });
      const body = await response.text();
      expect(response.status, body).toBe(200);
      expect(body).toContain("[redacted]"); // the provider echoed `authorization`; the broker took the key out
      expect(body).not.toContain(AI_KEY);
      expect(JSON.stringify([...response.headers])).not.toContain(AI_KEY);
      expect(log.join("\n")).not.toContain(AI_KEY);
    } finally {
      await second.stop();
    }
  }, 600_000);
});
