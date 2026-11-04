// UM-062 and UM-063: F8 class B against a live stack in near-sandbox (real contract, indexer, read API, facilitator, broker).
// The broker leases a function-call key on a lease sub-account; the lessee pays a day of rent with an ordinary x207 voucher.
//  - UM-063: the lessee does not pay its residual, the keeper finalizes the epoch, `member_defaulted` reaches the broker through
//    the read API, the key is deleted and the next call fails; the delay between finalize_epoch and DeleteKey is printed.
//  - UM-062: offer_grant, accept_grant, 402 lease, voucher, /verify, /settle, AddKey, an allowed call works, a deposit and another
//    method are refused, the rent is not renewed, DeleteKey, and the grant ends `expired`.
// Run: X207_SANDBOX=1 npx vitest run tests/broker-class-b.sandbox.test.ts
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { createViewAccessKeyFn, signVoucher, type AccessGrant, type ContractAbi } from "@x207/core";
import { Indexer, FailoverRpcClient, RpcBlockSource, createApiServer, openDatabase, rpcChainReader } from "../backend/src/index.ts";
import { viewClearedEdges } from "../backend/src/indexer/view-edges.ts";
import { startBroker, type RunningBroker } from "../backend/broker/src/index.ts";
import { createAgentBuyer } from "../agents/shared/x207.ts";
import { startStack, type Stack } from "../agents/test/stack.ts";
import { keeperPass } from "../scripts/lib/keeper.mjs";
import { sandboxAvailable } from "../sdk/test-support/sandbox.ts";
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from "../backend/node_modules/near-api-js/lib/index.js";

const DAY_MS = 86_400_000;
const PRICE = "50000"; // 0.05 credit a day, under the spend policy of the agents (0.1 per call)

describe.skipIf(!sandboxAvailable)("F8 class B in near-sandbox: lease, renewal, expiry and revoke on default", () => {
  let stack: Stack | undefined;
  let api: Server | undefined;
  let broker: RunningBroker | undefined;
  afterAll(async () => {
    await broker?.stop();
    api?.closeAllConnections?.();
    api?.close();
    await stack?.stop();
  });

  it("UM-063 then UM-062", async () => {
    // one clock for the facilitator and the broker that follows the block time, so the epoch caches (60 s) turn when the epoch does
    const clock = { offsetMs: 0 };
    stack = await startStack({ now: () => Date.now() + clock.offsetMs });
    const { fx, identity: id } = stack;
    const { sandbox } = fx;
    const rpcUrl = sandbox.rpcUrl;
    const contract = fx.circle.accountId;
    const view = <T>(method: string, args: object = {}) => sandbox.view<T>(contract, method, args);
    const provider = new JsonRpcProvider({ url: rpcUrl });

    // owner registers the asset type (the DAO account is the owner of the fixture)
    const dao = await sandbox.createAccount("dao", "10");
    const entry = { asset_type: "near-rpc:access", class: "B", delivery_methods: ["near_access_key"], accepted_proofs: ["rpc_access_key"], terms_hash: "ab".repeat(32) };
    expect((await dao.call({ receiverId: contract, methodName: "set_asset_class", args: { asset_type: "near-rpc:access", entry }, deposit: 0n })).failures).toEqual([]);

    // indexer and read API
    const db = openDatabase(":memory:");
    const indexer = new Indexer({
      db, source: new RpcBlockSource(rpcChainReader(new FailoverRpcClient({ endpoints: [rpcUrl] })), contract, 1), circleId: "agents-main",
      contractId: contract, startBlock: 1, fetchParams: () => view<ContractAbi.Params>("get_params"),
      fetchClearedEdges: (epoch) => viewClearedEdges(rpcUrl, contract, epoch),
    });
    await indexer.bootstrap();
    api = createApiServer({ db });
    await new Promise<void>((resolve) => api!.listen(0, "127.0.0.1", resolve));
    const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    const drain = async (until: () => boolean) => {
      for (let i = 0; i < 60; i++) {
        await indexer.drain();
        if (until()) return;
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error("indexer did not reach the expected state");
    };
    const count = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);
    await drain(() => count("select count(*) as n from members where status = 'active'") >= 6);

    // broker: its own account (operator of the grants) and the lease sub-account whose key it holds
    const brokerAccount = await sandbox.createAccount("broker", "10");
    const lease = await sandbox.createAccount("lease", "10");
    const log: string[] = [];
    broker = await startBroker({
      config: {
        readApiUrl: apiUrl, circleId: "agents-main", contractId: contract, facilitatorUrl: stack.facilitatorUrl, rpcUrl,
        brokerAccount: brokerAccount.accountId, brokerKey: brokerAccount.secretKey, leaseAccount: lease.accountId, leaseKey: lease.secretKey,
        port: 0, dbPath: ":memory:", pollSeconds: 15, providers: [],
      },
      now: () => Date.now() + clock.offsetMs, poll: false, extraCacheMs: 0, log: (line) => log.push(line),
    });
    const brokerUrl = broker.url;

    const blockMs = () => sandbox.blockTimestampMs();
    const advanceTo = async (ms: number) => {
      await sandbox.advanceTo(ms);
      clock.offsetMs = (await blockMs()) - Date.now();
    };
    const viewKey = createViewAccessKeyFn({ rpcUrls: [rpcUrl], finality: "optimistic" });
    const scope = (allowance = "1000000000000000000000000") => JSON.stringify({ receiver_id: contract, method_names: ["get_params"], allowance });
    const offer = async (grantor: "scraper" | "gpu", expiresMs: number): Promise<number> => {
      const r = await fx.members.get(grantor)!.call({
        receiverId: contract, methodName: "offer_grant", deposit: 0n,
        args: {
          input: {
            asset_type: "near-rpc:access", delivery_method: "near_access_key",
            limits: { scope: scope(), quota: null, expires_at: (BigInt(expiresMs) * 1_000_000n).toString() },
            unit: "day", unit_price: PRICE, operator: brokerAccount.accountId, proof_hash: null, proof_kind: null,
          },
        },
      });
      expect(r.failures).toEqual([]);
      return Number(r.value);
    };
    const accept = async (lessee: string, grantId: number): Promise<KeyPair> => {
      const key = KeyPair.fromRandom("ed25519");
      const r = await fx.members.get(lessee)!.call({
        receiverId: contract, methodName: "accept_grant", args: { grant_id: grantId, delivery_pubkey: key.getPublicKey().toString() }, deposit: 0n,
      });
      expect(r.failures).toEqual([]);
      return key;
    };
    const lesseeCall = async (key: KeyPair, methodName: string, deposit = 0n) => {
      const account = new Account(lease.accountId, provider, KeyPairSigner.fromSecretKey(key.toString() as never));
      return account.callFunctionRaw({ contractId: contract, methodName, args: {}, deposit, gas: 30_000_000_000_000n });
    };
    const getLease = async (lessee: "translator" | "gpu", grantId: number) => {
      const buy = createAgentBuyer(id[lessee], { rpcUrls: [rpcUrl] });
      const response = await buy(`${brokerUrl}/grants/${grantId}/lease`);
      return { response, body: (await response.json()) as Record<string, any> };
    };

    // ---------------- UM-063: revoke on default ----------------
    const now0 = await blockMs();
    const grant2 = await offer("scraper", now0 + 30 * DAY_MS);
    const key2 = await accept("translator", grant2);
    const first = await getLease("translator", grant2);
    expect(first.response.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ grantId: grant2, publicKey: key2.getPublicKey().toString(), receiverId: contract, methodNames: ["get_params"] });
    expect(first.response.headers.get("PAYMENT-RESPONSE")).toBeTruthy();
    // BK-002: the voucher is pending at the facilitator for the pair lessee -> grantor
    const pending = stack.pending.listOpen(contract);
    expect(pending.some((p: any) => JSON.stringify(p).includes(id.translator.accountId) && JSON.stringify(p).includes(id.scraper.accountId))).toBe(true);
    // BK-006: the node shows the key with exactly the permission of the grant
    const seen = await viewKey(lease.accountId, key2.getPublicKey().toString());
    expect(seen?.permission).toMatchObject({ FunctionCall: { receiver_id: contract, method_names: ["get_params"], allowance: "1000000000000000000000000" } });
    const grantView = await view<AccessGrant>("get_grant", { grant_id: grant2 });
    expect(await broker.classB.prove(grantView)).toEqual({ valid: true });
    expect((await lesseeCall(key2, "get_params")).status).toBeTruthy();

    // the lessee owes 3 credit to image and never pays: no cycle, so it is a net debtor with a residual
    const epoch = (await view<ContractAbi.EpochView>("get_epoch")).epoch;
    const { signature, ...voucher } = signVoucher(
      { circle: contract, payer: id.translator.accountId, payee: id.image.accountId, epoch, seq: 1, cumulativeAmount: "3000000", unit: "credit", resource: "https://seller.example/api" },
      id.translator.voucherSecretKey,
    );
    const registered = await fx.members.get("translator")!.call({ receiverId: contract, methodName: "register_cumulative", args: { voucher, signature }, deposit: 0n, gas: 100_000_000_000_000n });
    expect(registered.failures).toEqual([]);

    const keeperAccount = await sandbox.createAccount("keeper", "20");
    const events: string[] = [];
    const keeper = () =>
      keeperPass({
        log: () => {}, view: (m: string, a: object) => sandbox.view(contract, m, a), chainNowMs: () => blockMs(),
        send: async ({ methodName, args }: { methodName: string; args: object }) => {
          const r = await sandbox.accountFrom(keeperAccount.accountId, keeperAccount.secretKey).call({ receiverId: contract, methodName, args, deposit: 0n }, "EXECUTED_OPTIMISTIC");
          if (r.failures.length > 0) throw new Error(r.failures.join("; "));
          events.push(methodName);
          return r.hash;
        },
      });
    const epochView = (n: number) => view<ContractAbi.EpochView>("get_epoch", { epoch: n });
    const settle = () => new Promise((r) => setTimeout(r, 2_000));
    await advanceTo(Number(BigInt((await epochView(epoch)).cutoff_at) / 1_000_000n) + 1_000);
    await settle();
    await keeper();
    await advanceTo(Number(BigInt((await epochView(epoch)).proposal_deadline!) / 1_000_000n) + 1_000);
    await settle();
    await keeper();
    await advanceTo(Number(BigInt((await epochView(epoch)).payment_deadline!) / 1_000_000n) + 1_000);
    await settle();
    await keeper();
    const finalizedAt = Date.now();
    expect(events).toEqual(expect.arrayContaining(["close_epoch", "commit_epoch", "finalize_epoch"]));
    expect((await view<ContractAbi.MemberView>("member", { account_id: id.translator.accountId })).status).toBe("suspended");

    // one polling interval of the broker: the event comes through the read API
    await drain(() => count("select count(*) as n from events_raw where event = 'member_defaulted'") >= 1);
    await broker.tick();
    const deletedAt = Date.now();
    console.log(`UM-063 finalize_epoch -> DeleteKey: ${deletedAt - finalizedAt} ms (broker log: ${log.filter((l) => l.includes("DeleteKey")).join(" | ")})`);
    expect(await viewKey(lease.accountId, key2.getPublicKey().toString())).toBeNull();
    expect((await view<AccessGrant>("get_grant", { grant_id: grant2 })).status).toBe("revoked");
    await expect(lesseeCall(key2, "get_params")).rejects.toThrow();
    const refused = await getLease("gpu", grant2);
    expect([refused.response.status, refused.body.error]).toEqual([403, "grant_revoked"]);
    expect(log.some((l) => l.includes("member_defaulted") && l.includes(id.translator.accountId))).toBe(true);
    await drain(() => count("select count(*) as n from grants where status = 'revoked'") >= 1);
    const listed = (await (await fetch(`${apiUrl}/x207/circles/agents-main/grants?grantee=${id.translator.accountId}`)).json()) as { items: Array<{ grantId: number; status: string; revokeReason: string }> };
    expect(listed.items.map((g) => [g.grantId, g.status, g.revokeReason])).toEqual([[grant2, "revoked", "defaulted"]]);

    // ---------------- UM-062: lease, renewal, refusals, no renewal, expiry ----------------
    const t0 = await blockMs();
    const expires = t0 + 3 * 60_000;
    const grant = await offer("scraper", expires);
    expect(grant).toBeGreaterThan(grant2);
    const unaccepted = await getLease("gpu", grant);
    expect([unaccepted.response.status, unaccepted.body.error]).toEqual([403, "grant_not_active"]);
    const key = await accept("gpu", grant);
    // BK-002: the 402 pays the grantor and names the grant
    const challenge = await fetch(`${brokerUrl}/grants/${grant}/lease`);
    expect(challenge.status).toBe(402);
    const required = (await challenge.json()) as { accepts: Array<{ scheme: string; payTo: string; amount: string; extra: Record<string, unknown> }> };
    const x207 = required.accepts.find((a) => a.scheme === "batch-settlement")!;
    expect(x207).toMatchObject({ payTo: id.scraper.accountId, amount: PRICE, extra: { grantId: grant } });
    const paid = await getLease("gpu", grant);
    expect(paid.response.status, JSON.stringify(paid.body)).toBe(200);
    expect(new Date(paid.body.paidUntil).getTime()).toBe(expires); // one day of rent, capped at expires_at
    expect((await viewKey(lease.accountId, key.getPublicKey().toString()))?.permission).toMatchObject({ FunctionCall: { receiver_id: contract, method_names: ["get_params"] } });
    // the allowed call works; a deposit and another method are refused by the protocol itself
    expect((await lesseeCall(key, "get_params")).transaction_outcome.id).toBeTruthy();
    await expect(lesseeCall(key, "get_params", 1n)).rejects.toThrow();
    await expect(lesseeCall(key, "get_epoch")).rejects.toThrow();
    const renewed = await getLease("gpu", grant);
    expect(renewed.response.status).toBe(200);
    expect(await broker.tick().then(() => viewKey(lease.accountId, key.getPublicKey().toString()))).not.toBeNull();

    // the rent is not renewed: time passes expires_at, the key is deleted and the grant ends expired
    await advanceTo(expires + 5_000);
    await broker.tick();
    expect(await viewKey(lease.accountId, key.getPublicKey().toString())).toBeNull();
    expect((await view<AccessGrant>("get_grant", { grant_id: grant })).status).toBe("expired");
    await expect(lesseeCall(key, "get_params")).rejects.toThrow();
    const after = await getLease("gpu", grant);
    expect([after.response.status, after.body.error]).toEqual([403, "grant_revoked"]);
    // the broker never wrote D2 or D3: no register_* call came from its account
    const brokerTxs = log.filter((l) => /register_/.test(l));
    expect(brokerTxs).toEqual([]);
  }, 900_000);
});
