// F8 on NEAR testnet (not the sandbox): contract 0.0.7 on x207-circle-v9.testnet with the real broker (backend/broker), the real facilitator, the indexer
// and read API of the backend on this machine, and real function-call keys on a lease sub-account.
//   class B: set_asset_class, offer_grant, accept_grant, GET /grants/{id}/lease (402, voucher, AddKey), the allowed call works, a deposit and another method
//            are refused by the protocol, DeleteKey when the grant is revoked by the grantor and when it runs out (revoke_grant expired by the broker)
//   class A: NFT escrow with probes/mock_nft: a delivery that fails (the payment is taken back and D9 agrees), then a delivery that works
//   class C: proxy with a local mock provider: forwarded with the key, settled, scope refusal, provider failure, quota
// Every transaction hash goes to docs/testnet-f8-v9.json from the first one on (names and hashes only, no keys). Testnet only; keys stay in .secrets/.
// Run: X207_TESTNET=1 npx vitest run tests/testnet-f8.live.test.ts
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createCircleViewFn, createViewAccessKeyFn, generateVoucherKeypair, onboardMember, parseEventLog, signVoucher, voucherPublicKey, type AccessGrant, type ContractAbi, type ContractCall,
} from "@x207/core";
import { NearRpc, PendingStore, createApp, createFacilitatorService } from "@x207/facilitator";
import { defineCircleConfig } from "@x207/scheme";
import { Indexer, createApiServer, openDatabase } from "../backend/src/index.ts";
import { NearBrokerChain, startBroker, type BrokerChain, type RunningBroker } from "../backend/broker/src/index.ts";
import { createAgentBuyer } from "../agents/shared/x207.ts";
import type { AgentIdentity } from "../agents/shared/identity.ts";
import { serveWeb } from "../agents/test/helpers.ts";
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from "../backend/node_modules/near-api-js/lib/index.js";
import { Recorder, TxFeedSource, patient, sleep } from "./support/testnet-kit.ts";

const ENABLED = process.env.X207_TESTNET === "1";
const RPCS = ["https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org", "https://test.rpc.fastnear.com", "https://archival-rpc.testnet.near.org"];
const RPC = RPCS[0]!;
const V9 = "x207-circle-v9.testnet";
const AUX = "x207-aux-v9.testnet";
const USDT = "usdt.x207-deployer.testnet";
const BROKER = `broker.${AUX}`;
const LEASE = `lease.${AUX}`;
const MEMBERS = ["gina", "leo", "lena"] as const;
type Member = (typeof MEMBERS)[number];
const secretsDir = resolve("../../.secrets/testnet-deployer");
const NEAR = 10n ** 24n;
const CREDIT = 1_000_000n;
const DAY_MS = 86_400_000;
const SECRET = "sk-live-f8-testnet-SECRET-0123456789";

describe.skipIf(!ENABLED)("F8 on testnet: class B lease, class A escrow, class C proxy", () => {
  let api: Server | undefined;
  let provider: Server | undefined;
  let facilitator: Server | undefined;
  let broker: RunningBroker | undefined;
  it("runs the three classes against contract 0.0.7 on x207-circle-v9.testnet", async () => {
    const recorder = new Recorder(resolve("docs/testnet-f8-v9.json"), {
      network: "testnet", contract: V9, usdt: USDT, aux: AUX, broker: BROKER, lease: LEASE,
      note: "F8 on testnet with contract 0.0.7 (tag v0.0.7). Hashes and names only, no keys. The file is written after every transaction.",
    });
    const keyOf = (account: string): string => (JSON.parse(readFileSync(join(secretsDir, `${account}.json`), "utf8")) as { private_key: string }).private_key;
    const savedPath = join(secretsDir, "f8-v9.json");
    const saved: Record<string, { tx: string; voucher: string }> = existsSync(savedPath) ? JSON.parse(readFileSync(savedPath, "utf8")) : {};
    const save = () => writeFileSync(savedPath, JSON.stringify(saved));
    const rpcProvider = new JsonRpcProvider({ url: RPC });
    const accountOf = (id: string, secret: string) => new Account(id, rpcProvider, KeyPairSigner.fromSecretKey(secret as never));
    const owner = accountOf(V9, keyOf(V9));
    const aux = accountOf(AUX, keyOf(AUX));

    const rpc = (method: string, params: unknown) =>
      patient(async () => {
        const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        const body = (await response.json().catch(() => ({ error: `HTTP ${response.status}` }))) as { result?: any; error?: unknown };
        if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)} ${response.status}`);
        return body.result;
      });
    const view = async <T>(contract: string, method: string, args: object = {}): Promise<T> => {
      const r = await rpc("query", { request_type: "call_function", finality: "optimistic", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
      return JSON.parse(Buffer.from(r.result).toString("utf8")) as T;
    };
    const chainNowMs = async () => Number(BigInt((await rpc("block", { finality: "optimistic" })).header.timestamp_nanosec) / 1_000_000n);
    const head = async () => Number((await rpc("status", [])).sync_info.latest_block_height);
    const feed = new TxFeedSource(V9, await head(), rpc);

    type Call = { receiverId: string; methodName: string; args: object; deposit?: bigint; gas?: bigint };
    /** One transaction. `innerFailure`: a text that the receipt failures may carry without failing the step (a delivery that is meant to fail). */
    const send = async (account: Account, step: string, call: Call, innerFailure?: string): Promise<unknown> => {
      const r = (await patient(() =>
        account.callFunctionRaw({ contractId: call.receiverId, methodName: call.methodName, args: call.args, deposit: call.deposit ?? 0n, gas: call.gas ?? 150_000_000_000_000n, waitUntil: "FINAL" }),
      )) as any;
      const hash: string = r.transaction_outcome.id;
      recorder.add({ step, account: account.accountId, method: call.methodName, hash });
      await feed.add(hash, account.accountId);
      const failures = [r.status, ...(r.receipts_outcome ?? []).map((o: any) => o.outcome.status)].filter((s) => s && typeof s === "object" && "Failure" in s);
      const tolerated = innerFailure !== undefined && failures.length > 0 && failures.every((f) => JSON.stringify(f).includes(innerFailure));
      if (failures.length > 0 && !tolerated) throw new Error(`${step} ${call.methodName}: ${JSON.stringify(failures[0]).slice(0, 400)} (tx ${hash})`);
      const value = r.status?.SuccessValue;
      return value ? JSON.parse(Buffer.from(value, "base64").toString("utf8")) : undefined;
    };
    const create = async (parent: Account, step: string, id: string, near: bigint, key: KeyPair) => {
      const created = (await patient(() => parent.createAccount({ newAccountId: id, publicKey: key.getPublicKey(), nearToTransfer: near }))) as any;
      recorder.add({ step, account: parent.accountId, method: "create_account", hash: created.transaction_outcome.id });
    };

    // ---------------- deploy 0.0.7 and init
    if (!(await view(V9, "get_circle").then(() => true, () => false))) {
      const deploy = (await patient(() => owner.deployContract(readFileSync(resolve("contracts/target/near/x207_circle.wasm"))))) as any;
      recorder.add({ step: "deploy circle 0.0.7", account: V9, method: "deploy_contract", hash: deploy.transaction_outcome.id });
      await send(owner, "init circle", {
        receiverId: V9, methodName: "new", gas: 100_000_000_000_000n,
        args: {
          owner_id: V9, circle_id: "agents-main", usdt_token_id: USDT, intents_id: "intents.testnet",
          params: { epoch_length: 3600, payment_window: 900, proposal_window: 60, base_limit_ratio: 8000, limit_growth: 1000, limit_cap: "1000000000", limit_decay: 0, fees: { clearing_fee_bps: 0, solver_fee_bps: 0 }, admission: "open" },
        },
      });
    }
    expect(await view<string>(V9, "interface_version")).toBe("0.0.7");

    // ---------------- NFT contract, broker and lease accounts (aux), members (v9)
    const nftWasm = readFileSync(resolve("contracts/target/near/mock_nft/mock_nft.wasm"));
    if ((await rpc("query", { request_type: "view_account", finality: "final", account_id: AUX })).code_hash === "11111111111111111111111111111111") {
      const deployed = (await patient(() => aux.deployContract(nftWasm))) as any;
      recorder.add({ step: "deploy mock_nft", account: AUX, method: "deploy_contract", hash: deployed.transaction_outcome.id });
      await send(aux, "init mock_nft", { receiverId: AUX, methodName: "new", args: {} });
    }
    for (const [id, near] of [[BROKER, NEAR / 2n], [LEASE, NEAR / 2n]] as const) {
      if (!saved[id]) {
        const key = KeyPair.fromRandom("ed25519");
        await create(aux, `account ${id.split(".")[0]}`, id, near, key);
        saved[id] = { tx: key.toString(), voucher: "" };
        save();
      }
    }
    const brokerAccount = accountOf(BROKER, saved[BROKER]!.tx);
    const accounts = {} as Record<Member, Account>;
    const identity = {} as Record<Member, AgentIdentity>;
    for (const name of MEMBERS) {
      const id = `${name}.${V9}`;
      if (!saved[id]) {
        const key = KeyPair.fromRandom("ed25519");
        await create(owner, `account ${name}`, id, NEAR / 4n, key);
        saved[id] = { tx: key.toString(), voucher: generateVoucherKeypair().secretKey };
        save();
      }
      accounts[name] = accountOf(id, saved[id]!.tx);
      identity[name] = {
        accountId: id, voucherSecretKey: saved[id]!.voucher as `ed25519:${string}`, voucherPublicKey: voucherPublicKey(saved[id]!.voucher as `ed25519:${string}`),
        policy: { maxPerCall: "1000000000", maxPerEpoch: "1000000000" },
      };
    }

    // ---------------- backend on this machine: indexer fed from the transactions, read API
    const db = openDatabase(":memory:");
    const indexer = new Indexer({
      db, source: feed, circleId: "agents-main", contractId: V9, startBlock: await head() - 1, fetchParams: () => view<ContractAbi.Params>(V9, "get_params"),
    });
    await indexer.bootstrap();
    api = createApiServer({ db });
    await new Promise<void>((r) => api!.listen(0, "127.0.0.1", r));
    const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    const drain = async (done: () => boolean, seconds = 90) => {
      for (let i = 0; i < seconds / 2; i++) {
        await indexer.drain();
        if (done()) return;
        await sleep(2000);
      }
      throw new Error("indexer did not reach the expected state");
    };
    const one = <T>(sql: string, ...args: unknown[]) => db.prepare(sql).get(...args) as T | undefined;

    // ---------------- onboarding: mint mock USDT, join, stake
    const circleView = createCircleViewFn({ circleContract: V9, rpcUrls: RPCS });
    for (const name of MEMBERS) {
      const account = accounts[name];
      const existing = await view<ContractAbi.MemberView | null>(V9, "member", { account_id: account.accountId });
      if (existing?.status === "active") {
        // joined in an earlier run (this run was resumed): the feed has not seen the events, so the row comes from the view of the contract
        db.prepare(
          `INSERT OR REPLACE INTO members (circle_id, account_id, pubkey_voucher, terms_hash, stake, credit_limit, outstanding_debt, status, admitted, settled_history, joined_at_ns, updated_block)
           VALUES ('agents-main', ?, ?, ?, ?, ?, 0, ?, 0, 0, ?, 0)`,
        ).run(existing.account_id, existing.pubkey_voucher, existing.terms_hash, existing.stake, existing.limit, existing.status, existing.joined_at);
        continue;
      }
      await send(account, `mint usdt ${name}`, { receiverId: USDT, methodName: "mint", args: { account_id: account.accountId, amount: (1000n * CREDIT).toString() } });
      await onboardMember(
        {
          sendCall: (c: ContractCall) => send(account, `onboard ${name}`, { receiverId: c.receiverId, methodName: c.methodName, args: c.args, deposit: BigInt(c.deposit ?? 0), ...(c.gas ? { gas: BigInt(c.gas) } : {}) }),
          view: circleView, pollIntervalMs: 2000, timeoutMs: 120_000,
        },
        { circleContract: V9, circleId: "agents-main", accountId: account.accountId, termsHash: "a".repeat(64), stakeAmount: "150000000", secretKey: identity[name].voucherSecretKey, usdtTokenId: USDT },
      );
    }
    await drain(() => Number(one<{ n: number }>("select count(*) as n from members where status = 'active'")!.n) >= 3);

    // ---------------- D10: the three asset types
    const entry = (assetType: string, cls: string, method: string) => ({ asset_type: assetType, class: cls, delivery_methods: [method], accepted_proofs: ["rpc_access_key"], terms_hash: "f8".repeat(32) });
    for (const e of [entry("near-rpc:access", "B", "near_access_key"), entry("nft:ticket", "A", "escrow_nft"), entry("mock:echo", "C", "proxy")]) {
      await send(owner, `set_asset_class ${e.class}`, { receiverId: V9, methodName: "set_asset_class", args: { asset_type: e.asset_type, entry: e } });
    }
    expect(await view(V9, "get_asset_class", { asset_type: "nft:ticket" })).toMatchObject({ class: "A" });

    // ---------------- facilitator, mock provider (class C), broker
    const pending = new PendingStore(":memory:");
    const service = createFacilitatorService({
      circles: [defineCircleConfig({ network: "x207:agents-main", circleContract: V9 })], rpc: new NearRpc({ urls: RPCS, timeoutMs: 20_000 }), pending, signers: [AUX],
    });
    const settled: unknown[] = [];
    const app = createApp(service);
    const served = await serveWeb(async (request) => {
      const response = await app.fetch(request);
      if (new URL(request.url).pathname === "/settle") settled.push(await response.clone().json());
      return response;
    });
    facilitator = served.server;
    const seen: Array<{ method: string; path: string; auth: string | undefined }> = [];
    provider = createServer((req, res) => {
      seen.push({ method: req.method ?? "", path: req.url ?? "", auth: req.headers.authorization });
      if (req.headers.authorization !== `Bearer ${SECRET}`) return void res.writeHead(401).end("unauthorized");
      if (req.url?.endsWith("/boom")) return void res.writeHead(500).end("provider error");
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ echo: req.url }));
    });
    await new Promise<void>((r) => provider!.listen(0, "127.0.0.1", r));
    const providerUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;

    /** The broker chain with patience for 429, and the hashes of what the broker sends on chain recorded and fed to the indexer. */
    const inner = new NearBrokerChain({ rpcUrl: RPC, contractId: V9, brokerAccount: BROKER, brokerKey: saved[BROKER]!.tx, leaseAccount: LEASE, leaseKey: saved[LEASE]!.tx });
    const chain: BrokerChain = {
      leaseAccount: LEASE,
      getGrant: (id) => patient(() => inner.getGrant(id)),
      grantsOf: (a, r) => patient(() => inner.grantsOf(a, r)),
      nowMs: () => patient(() => inner.nowMs()),
      currentEpoch: () => patient(() => inner.currentEpoch()),
      async addLeaseKey(key, scope) {
        const hash = await patient(() => inner.addLeaseKey(key, scope));
        recorder.add({ step: "broker AddKey", account: LEASE, method: "add_key", hash });
        return hash;
      },
      async deleteLeaseKey(key) {
        const hash = await patient(() => inner.deleteLeaseKey(key));
        recorder.add({ step: "broker DeleteKey", account: LEASE, method: "delete_key", hash });
        return hash;
      },
      async revokeGrant(id, reason) {
        const result = await patient(() => inner.revokeGrant(id, reason));
        if (result.ok) {
          recorder.add({ step: `broker revoke_grant ${reason}`, account: BROKER, method: "revoke_grant", hash: result.txHash });
          await feed.add(result.txHash, BROKER);
        }
        return result;
      },
    };
    const brokerLog: string[] = [];
    broker = await startBroker({
      config: {
        readApiUrl: apiUrl, circleId: "agents-main", contractId: V9, facilitatorUrl: served.url, rpcUrl: RPC, brokerAccount: BROKER, brokerKey: saved[BROKER]!.tx,
        leaseAccount: LEASE, leaseKey: saved[LEASE]!.tx, port: 0, dbPath: ":memory:", pollSeconds: 15, auditPath: "",
        providers: [{ assetType: "mock:echo", baseUrl: providerUrl, secretEnv: "MOCK_PROVIDER_KEY" }],
      },
      chain, env: { MOCK_PROVIDER_KEY: SECRET }, poll: false, extraCacheMs: 0, log: (line) => brokerLog.push(line),
    });
    const brokerUrl = broker.url;
    const buy = (who: Member) => createAgentBuyer(identity[who], { rpcUrls: RPCS });
    const viewKey = createViewAccessKeyFn({ rpcUrls: RPCS, finality: "optimistic" });
    const lesseeCall = (key: KeyPair, methodName: string, deposit = 0n) =>
      new Account(LEASE, rpcProvider, KeyPairSigner.fromSecretKey(key.toString() as never)).callFunctionRaw({ contractId: V9, methodName, args: {}, deposit, gas: 30_000_000_000_000n });
    const offer = async (who: Member, assetType: string, method: string, patch: Record<string, unknown>) => {
      const base = (await chainNowMs()) + 60 * 60_000;
      const limits = { scope: "{}", quota: null, expires_at: (BigInt(base) * 1_000_000n).toString(), ...(patch.limits as object | undefined) };
      const id = (await send(accounts[who], `offer_grant ${assetType}`, {
        receiverId: V9, methodName: "offer_grant",
        args: { input: { asset_type: assetType, delivery_method: method, unit: "day", unit_price: "50000", operator: BROKER, proof_hash: null, proof_kind: null, ...patch, limits } },
      })) as number;
      return Number(id);
    };
    const accept = async (who: Member, grantId: number, withKey: boolean): Promise<KeyPair | null> => {
      const key = withKey ? KeyPair.fromRandom("ed25519") : null;
      await send(accounts[who], `accept_grant ${grantId}`, { receiverId: V9, methodName: "accept_grant", args: { grant_id: grantId, delivery_pubkey: key ? key.getPublicKey().toString() : null } });
      return key;
    };
    const lease = async (who: Member, grantId: number) => {
      const response = await buy(who)(`${brokerUrl}/grants/${grantId}/lease`);
      return { response, body: (await response.json()) as Record<string, any> };
    };
    const scopeB = JSON.stringify({ receiver_id: V9, method_names: ["get_params"], allowance: "1000000000000000000000000" });

    // =============== class B ===============
    // B2 runs out in 8 minutes; B1 is revoked by its grantor
    const chainNow = await chainNowMs();
    const b2 = await offer("gina", "near-rpc:access", "near_access_key", { limits: { scope: scopeB, quota: null, expires_at: (BigInt(chainNow + 8 * 60_000) * 1_000_000n).toString() } });
    const b2Key = (await accept("leo", b2, true))!;
    const b1 = await offer("gina", "near-rpc:access", "near_access_key", { limits: { scope: scopeB } });
    const b1Key = (await accept("leo", b1, true))!;
    const challenge = await fetch(`${brokerUrl}/grants/${b1}/lease`);
    expect(challenge.status).toBe(402);
    const required = (await challenge.json()) as { accepts: Array<{ scheme: string; payTo: string; amount: string; extra: Record<string, unknown> }> };
    expect(required.accepts.find((a) => a.scheme === "batch-settlement")).toMatchObject({ payTo: identity.gina.accountId, amount: "50000", extra: { grantId: b1 } });
    const paid1 = await lease("leo", b1);
    expect(paid1.response.status, JSON.stringify(paid1.body)).toBe(200);
    expect(paid1.body).toMatchObject({ publicKey: b1Key.getPublicKey().toString(), receiverId: V9, methodNames: ["get_params"] });
    const paid2 = await lease("leo", b2);
    expect(paid2.response.status, JSON.stringify(paid2.body)).toBe(200);
    expect(settled.length).toBe(2);
    // both vouchers are for the same pair and epoch, so the pending store keeps one row that holds the cumulative of the two
    const rows = pending.listOpen(V9).filter((p: any) => JSON.stringify(p).includes(identity.leo.accountId) && JSON.stringify(p).includes(identity.gina.accountId));
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).toContain("100000");
    expect((await viewKey(LEASE, b1Key.getPublicKey().toString()))?.permission).toMatchObject({ FunctionCall: { receiver_id: V9, method_names: ["get_params"], allowance: "1000000000000000000000000" } });
    expect(await broker.classB.prove(await view<AccessGrant>(V9, "get_grant", { grant_id: b1 }))).toEqual({ valid: true });
    // the lessee uses the key: the allowed call works, a deposit and another method are refused by the protocol
    const call = (await lesseeCall(b1Key, "get_params")) as any;
    recorder.add({ step: "lessee call get_params with the leased key", account: LEASE, method: "get_params", hash: call.transaction_outcome.id });
    await expect(lesseeCall(b1Key, "get_params", 1n)).rejects.toThrow();
    await expect(lesseeCall(b1Key, "get_epoch")).rejects.toThrow();

    // the grantor revokes B1: the broker sees grant_revoked through the read API and deletes the key
    await send(accounts.gina, "revoke_grant B1 (grantor)", { receiverId: V9, methodName: "revoke_grant", args: { grant_id: b1, reason: "grantor" } });
    await drain(() => one<{ status: string }>("select status from grants where grant_id = ?", b1)?.status === "revoked");
    await broker.tick();
    expect(await viewKey(LEASE, b1Key.getPublicKey().toString())).toBeNull();
    await expect(lesseeCall(b1Key, "get_params")).rejects.toThrow();
    const refused = await lease("leo", b1);
    expect([refused.response.status, refused.body.error]).toEqual([403, "grant_revoked"]);
    expect(await viewKey(LEASE, b2Key.getPublicKey().toString())).not.toBeNull();

    // =============== class A ===============
    const nftId = (await view<{ owner_id: string }>(AUX, "nft_token", { token_id: "t1" }).catch(() => null)) === null;
    if (nftId) await send(aux, "nft_mint", { receiverId: AUX, methodName: "nft_mint", args: { token_id: "t1", owner_id: identity.gina.accountId } });
    const a1 = await offer("gina", "nft:ticket", "escrow_nft", { unit: "once", unit_price: (10n * CREDIT).toString(), limits: { scope: JSON.stringify({ nft_contract: AUX, token_id: "t1" }) } });
    await send(accounts.gina, "nft_transfer_call to the circle", {
      receiverId: AUX, methodName: "nft_transfer_call", deposit: 1n, gas: 150_000_000_000_000n,
      args: { receiver_id: V9, token_id: "t1", msg: JSON.stringify({ grant_id: a1 }) },
    });
    expect((await view<{ owner_id: string }>(AUX, "nft_token", { token_id: "t1" })).owner_id).toBe(V9);
    expect(await view(V9, "get_escrow", { grant_id: a1 })).toMatchObject({ state: "held", token_id: "t1" });
    const epoch = (await view<ContractAbi.EpochView>(V9, "get_epoch")).epoch;
    const voucherFor = (who: Member, seq: number, cumulative: string) => {
      const { signature, ...voucher } = signVoucher(
        { circle: V9, payer: identity[who].accountId, payee: identity.gina.accountId, epoch, seq, cumulativeAmount: cumulative, unit: "credit", resource: `x207:grant:${a1}` },
        identity[who].voucherSecretKey,
      );
      return { voucher, signature };
    };
    // lena cannot receive the NFT: the transfer fails and the contract takes the payment back
    await send(aux, "block_receiver lena", { receiverId: AUX, methodName: "block_receiver", args: { account_id: identity.lena.accountId } });
    await send(accounts.lena, "complete_escrow (delivery fails)", { receiverId: V9, methodName: "complete_escrow", args: { grant_id: a1, ...voucherFor("lena", 1, (10n * CREDIT).toString()) }, gas: 200_000_000_000_000n }, "The receiver cannot receive tokens");
    expect((await view<{ owner_id: string }>(AUX, "nft_token", { token_id: "t1" })).owner_id).toBe(V9);
    expect(await view(V9, "obligation", { epoch, debtor: identity.lena.accountId, creditor: identity.gina.accountId })).toBeNull();
    expect(await view(V9, "outstanding_debt", { account_id: identity.lena.accountId })).toBe("0");
    await drain(() => one<{ state: string }>("select state from escrows where grant_id = ?", a1) !== undefined && Number(one<{ n: number }>("select count(*) as n from events_raw where event = 'escrow_failed'")!.n) >= 1);
    expect(one("select * from obligations where debtor = ?", identity.lena.accountId)).toBeUndefined();
    expect(one<{ outstanding_debt: number }>("select outstanding_debt from members where account_id = ?", identity.lena.accountId)!.outstanding_debt).toBe(0);
    expect(one<{ state: string }>("select state from escrows where grant_id = ?", a1)!.state).toBe("held");
    // leo pays and gets the NFT
    await send(accounts.leo, "complete_escrow (delivered)", { receiverId: V9, methodName: "complete_escrow", args: { grant_id: a1, ...voucherFor("leo", 1, (10n * CREDIT).toString()) }, gas: 200_000_000_000_000n });
    expect((await view<{ owner_id: string }>(AUX, "nft_token", { token_id: "t1" })).owner_id).toBe(identity.leo.accountId);
    await drain(() => one<{ state: string }>("select state from escrows where grant_id = ?", a1)?.state === "delivered");
    expect((await view<{ obligation: string }>(V9, "obligation", { epoch, debtor: identity.leo.accountId, creditor: identity.gina.accountId })).obligation).toBe((10n * CREDIT).toString());
    expect(one<{ outstanding_debt: number }>("select outstanding_debt from members where account_id = ?", identity.leo.accountId)!.outstanding_debt).toBe(Number(10n * CREDIT));
    expect(await view(V9, "get_grant", { grant_id: a1 })).toMatchObject({ status: "active", grantee: identity.leo.accountId });

    // =============== class C ===============
    const c1 = await offer("gina", "mock:echo", "proxy", {
      unit: "call", unit_price: "20000",
      limits: { scope: JSON.stringify({ path_prefixes: ["/v1/echo"], methods: ["POST"] }), quota: "2" },
    });
    await accept("leo", c1, false);
    const proxy = (path: string, method = "POST") => buy("leo")(`${brokerUrl}/grants/${c1}/proxy${path}`, { method, body: method === "GET" ? undefined : "{}" });
    const first = await proxy("/v1/echo/ping");
    const firstText = await first.text();
    expect(first.status, firstText).toBe(200);
    expect(JSON.parse(firstText)).toEqual({ echo: "/v1/echo/ping" });
    expect(seen).toEqual([{ method: "POST", path: "/v1/echo/ping", auth: `Bearer ${SECRET}` }]);
    const settledBefore = settled.length;
    expect((await proxy("/v1/other")).status).toBe(403);
    expect((await proxy("/v1/echo/x", "GET")).status).toBe(403);
    const failed = await proxy("/v1/echo/boom");
    expect([failed.status, await failed.text()]).toEqual([500, "provider error"]);
    expect(settled.length).toBe(settledBefore);
    expect((await proxy("/v1/echo/pong")).status).toBe(200);
    const third = await proxy("/v1/echo/pong");
    expect([third.status, ((await third.json()) as { error: string }).error]).toEqual([429, "grant_quota_exceeded"]);
    expect(JSON.stringify(settled)).not.toContain(SECRET);
    expect(brokerLog.join("\n")).not.toContain(SECRET);

    // =============== B2 runs out: the broker deletes the key and marks the grant expired ===============
    const expiresAt = Number(BigInt((await view<AccessGrant>(V9, "get_grant", { grant_id: b2 })).limits.expires_at) / 1_000_000n) + 5_000;
    while ((await chainNowMs()) < expiresAt) await sleep(10_000);
    await broker.tick();
    expect(await viewKey(LEASE, b2Key.getPublicKey().toString())).toBeNull();
    expect((await view<AccessGrant>(V9, "get_grant", { grant_id: b2 })).status).toBe("expired");
    await expect(lesseeCall(b2Key, "get_params")).rejects.toThrow();
    const after = await lease("leo", b2);
    expect([after.response.status, after.body.error]).toEqual([403, "grant_revoked"]);
    recorder.add({ step: "summary", account: V9, method: `B grants ${b1} (revoked by the grantor) and ${b2} (expired), A grant ${a1} (failed delivery, then delivered), C grant ${c1}`, hash: "-" });
    void parseEventLog;
    void DAY_MS;
  }, 3_000_000);
});
