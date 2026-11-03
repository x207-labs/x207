// UM-089: daily rent of an access (P2, ADR-47) against a live stack in near-sandbox: real contract, indexer, read API, facilitator and access broker; the providers are mocks (an SSH
// server whose `authorized_keys` is checked by what sshd does with it, a repository collaborator, a cloud role with a real cost per day). Three accesses, each with its own grantor:
//   - SSH: offer_grant and accept_grant on the contract, the proof of the reference (a signature of the key), one day paid by an ordinary voucher through the facilitator, the key opens
//     with its forced command until the end of the paid day and closes by itself after it; the grantor revokes on the contract and the broker removes the line;
//   - repository collaborator: paid for a day, the lessee stops with a signed notice and the collaborator is removed at the provider;
//   - cloud role: paid for a day, the broker writes the bill of the real cost, the lessee signs it under the cap with a second voucher, and a bill over the cap closes the access.
// Run: X207_SANDBOX=1 npx vitest run tests/rent.sandbox.test.ts
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { DailyRent } from "@x207/scheme";
import { encodeGranteeProof, nep413SigningHash, signHash, signSshChallenge, sshEd25519Line, type AccessGrant, type ContractAbi } from "@x207/core";
import { Indexer, FailoverRpcClient, RpcBlockSource, createApiServer, openDatabase, rpcChainReader } from "../backend/src/index.ts";
import { MockProviderAdapter, SshAdapter, sshdAccepts, startBroker, stopNoticeText, type RunningBroker } from "../backend/broker/src/index.ts";
import { createAgentBuyer } from "../agents/shared/x207.ts";
import { startStack, type Stack } from "../agents/test/stack.ts";
import { sandboxAvailable } from "../sdk/test-support/sandbox.ts";

const DAY_MS = 86_400_000;
const PRICE = "50000"; // 0.05 credit a day, under the spend policy of the agents (0.1 per call)

describe.skipIf(!sandboxAvailable)("UM-089 rent of three accesses in near-sandbox: grant, use, revoke", () => {
  let stack: Stack | undefined;
  let api: Server | undefined;
  let broker: RunningBroker | undefined;
  afterAll(async () => {
    await broker?.stop();
    api?.closeAllConnections?.();
    api?.close();
    await stack?.stop();
  });

  it("TC-UM-089-01 SSH, repository collaborator and cloud role: paid by the day, used, and closed by the grantor, the lessee, and the cap", async () => {
    const clock = { offsetMs: 0 };
    stack = await startStack({ now: () => Date.now() + clock.offsetMs });
    const { fx, identity: id } = stack;
    const { sandbox } = fx;
    const rpcUrl = sandbox.rpcUrl;
    const contract = fx.circle.accountId;
    const view = <T>(method: string, args: object = {}) => sandbox.view<T>(contract, method, args);

    // the owner registers the asset type of a rented access
    const dao = await sandbox.createAccount("dao", "10");
    const entry = { asset_type: "access:rent", class: "B", delivery_methods: ["provider_access"], accepted_proofs: [], terms_hash: "ab".repeat(32) };
    expect((await dao.call({ receiverId: contract, methodName: "set_asset_class", args: { asset_type: "access:rent", entry }, deposit: 0n })).failures).toEqual([]);

    const db = openDatabase(":memory:");
    const indexer = new Indexer({
      db, source: new RpcBlockSource(rpcChainReader(new FailoverRpcClient({ endpoints: [rpcUrl] })), contract, 1), circleId: "agents-main",
      contractId: contract, startBlock: 1, fetchParams: () => view<ContractAbi.Params>("get_params"),
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

    // the providers: SSH on an in-memory authorized_keys, a repository collaborator, a cloud role with a cost per day
    const now = () => Date.now() + clock.offsetMs;
    const files = { text: "" };
    let roleCost = 20_000n;
    const github = new MockProviderAdapter({ provider: "github", now });
    const awsRole = new MockProviderAdapter({ provider: "aws-sts", now, costPerDay: () => roleCost });
    const brokerAccount = await sandbox.createAccount("broker", "10");
    const lease = await sandbox.createAccount("lease", "10");
    broker = await startBroker({
      config: {
        readApiUrl: apiUrl, circleId: "agents-main", contractId: contract, facilitatorUrl: stack.facilitatorUrl, rpcUrl,
        brokerAccount: brokerAccount.accountId, brokerKey: brokerAccount.secretKey, leaseAccount: lease.accountId, leaseKey: lease.secretKey,
        port: 0, dbPath: ":memory:", pollSeconds: 15, providers: [],
      },
      providerAdapters: [new SshAdapter({ file: { read: async () => files.text, write: async (t: string) => void (files.text = t) }, now }), github, awsRole],
      now, poll: false, extraCacheMs: 0,
    });
    const brokerUrl = broker.url;
    const advanceTo = async (ms: number) => {
      await sandbox.advanceTo(ms);
      clock.offsetMs = (await sandbox.blockTimestampMs()) - Date.now();
    };

    const offer = async (grantor: "scraper" | "gpu" | "cleaner", scope: object): Promise<number> => {
      const expires = (await sandbox.blockTimestampMs()) + 30 * DAY_MS;
      const r = await fx.members.get(grantor)!.call({
        receiverId: contract, methodName: "offer_grant", deposit: 0n,
        args: {
          input: {
            asset_type: "access:rent", delivery_method: "provider_access", limits: { scope: JSON.stringify(scope), quota: null, expires_at: (BigInt(expires) * 1_000_000n).toString() },
            unit: "day", unit_price: PRICE, operator: brokerAccount.accountId, proof_hash: null, proof_kind: null,
          },
        },
      });
      expect(r.failures).toEqual([]);
      return Number(r.value);
    };
    const accept = async (lessee: "translator" | "image" | "summarizer", grantId: number) => {
      const r = await fx.members.get(lessee)!.call({ receiverId: contract, methodName: "accept_grant", args: { grant_id: grantId, delivery_pubkey: "ed25519:7YkYUwHgD8gM4tUQbkcGzMfqMPXK9RSTkUmqm9Fa8qpT" }, deposit: 0n });
      expect(r.failures).toEqual([]);
    };
    /** One day of rent: the agent's x402 client answers the 402 of the broker with an ordinary voucher through the facilitator. */
    const payDay = async (lessee: "translator" | "image" | "summarizer", grantId: number, granteeRef: string, proof?: string) => {
      const buy = createAgentBuyer(id[lessee], { rpcUrls: [rpcUrl] });
      const response = await buy(`${brokerUrl}/grants/${grantId}/access`, { method: "POST", body: JSON.stringify({ grantee_ref: granteeRef, ...(proof ? { proof } : {}) }), headers: { "content-type": "application/json" } });
      return { response, body: (await response.json()) as Record<string, any> };
    };
    const accessView = async (grantId: number) => (await (await fetch(`${brokerUrl}/grants/${grantId}/access`)).json()) as Record<string, any>;

    // ---------------- SSH ----------------
    const seed = new Uint8Array(32).fill(9);
    const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(seed)]);
    const sshPublic = Buffer.from(createPublicKey(createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" })).export({ format: "jwk" }).x!, "base64url");
    const sshRef = sshEd25519Line(new Uint8Array(sshPublic), "translator");
    const sshGrant = await offer("scraper", { provider: "ssh", grantee_ref: sshRef, resource: "/usr/local/bin/run-job" });
    await accept("translator", sshGrant);
    const challenge = (await (await fetch(`${brokerUrl}/grants/${sshGrant}/access/challenge`)).json()) as { required: boolean; nonce: string; circle: string };
    expect(challenge).toMatchObject({ required: true, circle: contract });
    const proof = encodeGranteeProof(signSshChallenge({ circle: contract, grantId: sshGrant, granteeRef: sshRef, nonce: challenge.nonce }, seed));
    const sshPaid = await payDay("translator", sshGrant, sshRef, proof);
    expect(sshPaid.response.status, JSON.stringify(sshPaid.body)).toBe(200);
    expect(sshPaid.body).toMatchObject({ grantId: sshGrant, provider: "ssh", status: "active", proof: "verified" });
    expect(sshPaid.response.headers.get("PAYMENT-RESPONSE")).toBeTruthy();
    const paidUntil = Date.parse(sshPaid.body.paidUntil);
    const nowMs = await sandbox.blockTimestampMs();
    expect(sshdAccepts(files.text, sshRef, nowMs).accepted).toBe(true); // used: the key gets in
    expect(sshdAccepts(files.text, sshRef, nowMs).options).toContain('command="/usr/local/bin/run-job"');
    expect(sshdAccepts(files.text, sshRef, paidUntil + 2_000).accepted).toBe(false); // and the provider closes it by itself after the paid day
    expect(stack.pending.listOpen(contract).some((p: any) => JSON.stringify(p).includes(id.translator.accountId) && JSON.stringify(p).includes(id.scraper.accountId))).toBe(true);
    // the grantor revokes on the contract; the read API tells the broker; the line is removed
    const revoked = await fx.members.get("scraper")!.call({ receiverId: contract, methodName: "revoke_grant", args: { grant_id: sshGrant, reason: "grantor" }, deposit: 0n });
    expect(revoked.failures).toEqual([]);
    await drain(() => count("select count(*) as n from events_raw where event = 'grant_revoked'") >= 1);
    await broker.tick();
    expect((await accessView(sshGrant)).status).toBe("revoked");
    expect(sshdAccepts(files.text, sshRef, await sandbox.blockTimestampMs()).accepted).toBe(false);
    expect((await view<AccessGrant>("get_grant", { grant_id: sshGrant })).status).toBe("revoked");
    const refused = await payDay("translator", sshGrant, sshRef);
    expect(refused.response.status).toBe(403);

    // ---------------- repository collaborator: the lessee stops ----------------
    const repoGrant = await offer("gpu", { provider: "github", grantee_ref: "alice-dev", resource: "x207-labs/contracts", permission: "pull" });
    await accept("image", repoGrant);
    const repoPaid = await payDay("image", repoGrant, "alice-dev");
    expect(repoPaid.response.status, JSON.stringify(repoPaid.body)).toBe(200);
    expect(repoPaid.body.delivery).toMatchObject({ account: "alice-dev", resource: "x207-labs/contracts" });
    expect([...github.entries.values()].map((e) => e.removed)).toEqual([false]);
    const at = Math.floor((await sandbox.blockTimestampMs()) / 1000);
    const notice = { circle: contract, grant_id: repoGrant, actor: id.image.accountId, action: "stop", at };
    const text = stopNoticeText({ circle: contract, grant_id: repoGrant, actor: id.image.accountId, at });
    const stop = await fetch(`${brokerUrl}/grants/${repoGrant}/access/stop`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ notice, signature: signHash(nep413SigningHash(text, createHash("sha256").update(text, "utf8").digest(), contract), id.image.voucherSecretKey) }),
    });
    expect(stop.status).toBe(200);
    expect((await stop.json() as Record<string, any>).status).toBe("revoked");
    expect([...github.entries.values()].map((e) => e.removed)).toEqual([true]);

    // ---------------- cloud role: the bill of the real cost, up to the cap ----------------
    const roleGrant = await offer("cleaner", { provider: "aws-sts", grantee_ref: "ci-runner", resource: "arn:aws:iam::123456789012:role/x207-viewer", permission: "viewer", daily_cap: "100000" });
    await accept("summarizer", roleGrant);
    const rolePaid = await payDay("summarizer", roleGrant, "ci-runner");
    expect(rolePaid.response.status, JSON.stringify(rolePaid.body)).toBe(200);
    const roleGrantView = await view<AccessGrant>("get_grant", { grant_id: roleGrant });
    const dayStart = Math.floor((await sandbox.blockTimestampMs()) / DAY_MS) * DAY_MS;
    const bill = await broker.provider.settleDay(roleGrant === 0 ? roleGrantView : roleGrantView, dayStart);
    expect(bill).toEqual({ amount: roleCost, overCap: false });
    const rent = new DailyRent({ circle: contract, payer: id.summarizer.accountId, payee: id.cleaner.accountId, grantId: roleGrant, dailyPrice: PRICE, dailyCap: "100000", secretKey: id.summarizer.voucherSecretKey, now });
    const billed = rent.signBill({ billed: bill.amount.toString(), epoch: (await view<ContractAbi.EpochView>("get_epoch")).epoch, state: { seq: 0, cumulativeAmount: "0" } });
    expect(billed).toMatchObject({ resource: `x207:grant:${roleGrant}:cost`, cumulativeAmount: roleCost.toString() });
    // the next day costs 0.3 credit, above the cap of 0.1: the broker closes the access and the SDK refuses to sign the bill
    await advanceTo(dayStart + DAY_MS + 3_600_000);
    roleCost = 300_000n;
    const over = await broker.provider.settleDay(roleGrantView, dayStart + DAY_MS);
    expect(over).toEqual({ amount: 300_000n, overCap: true });
    expect(() => rent.signBill({ billed: over.amount.toString(), epoch: 1, state: { seq: 1, cumulativeAmount: roleCost.toString() } })).toThrowError(/rent_bill_over_cap/);
    expect((await accessView(roleGrant)).status).toBe("revoked");
    console.log(["UM-089", `ssh grant ${sshGrant} paid until ${new Date(paidUntil).toISOString()}`, `repo grant ${repoGrant} stopped`, `role grant ${roleGrant} bill ${bill.amount} then over cap ${over.amount}`].join(" | "));
  }, 900_000);
});
