// UM-064 blok F8 kelas B (opsional): sewa akses akun NEAR lewat function-call key, di near-sandbox dengan kontrak, indexer, facilitator dan broker nyata.
// Satu perintah dari akar payung:
//   npm run demo:classb
// Pemberi `scraper` menawarkan sewa, penyewa `translator` menerima dengan kunci function-call miliknya dan membayar sewa sehari dengan voucher x402
// biasa (payTo = pemberi); broker memasang key. Panggilan sah jalan, method lain dan deposit ditolak protokol NEAR. Penyewa lalu `defaulted` dan
// broker menghapus key. Tanpa TEE (hanya kelas B) dan kelas C belum ada. Setiap langkah dicetak "do X - see Y".
import { writeSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { createViewAccessKeyFn, signVoucher, type AccessGrant, type ContractAbi, type ContractCall } from "@x207/core";
import { createNearSender } from "@x207/core/signer";
import { FailoverRpcClient, Indexer, RpcBlockSource, createApiServer, openDatabase, rpcChainReader } from "../backend/src/index.ts";
import { startBroker, type RunningBroker } from "../backend/broker/src/index.ts";
import { RENTAL_DAY_MS, acceptRental, assertProbe, offerRental, payLease, probeKey, rentalScope, type CallWithKey } from "../agents/scenario/classb.ts";
import { createAgentBuyer } from "../agents/shared/x207.ts";
import { startStack, type Stack } from "../agents/test/stack.ts";
import { keeperPass } from "../scripts/lib/keeper.mjs";

const PRICE = "50000"; // 0.05 credit sehari, di bawah batas belanja agent (0,1 per panggilan)

describe("demo F8 kelas B: sewa function-call key dan cabut saat gagal bayar", () => {
  let stack: Stack | undefined;
  let api: Server | undefined;
  let broker: RunningBroker | undefined;
  afterAll(async () => {
    await broker?.stop();
    api?.closeAllConnections?.();
    api?.close();
    await stack?.stop();
  });

  it("pemberi menyewakan, penyewa memanggil dalam batas, key dicabut saat penyewa defaulted", async () => {
    const out = (line: string) => writeSync(1, `${line}\n`);
    const step = (doX: string, seeY: string) => out(`do: ${doX}\n   see: ${seeY}`);
    out("\n== F8 class B: rent a NEAR function-call key (sandbox, no TEE, class C not built)");

    const clock = { offsetMs: 0 };
    stack = await startStack({ now: () => Date.now() + clock.offsetMs });
    const { fx, identity: id } = stack;
    const { sandbox } = fx;
    const rpcUrl = sandbox.rpcUrl;
    const contract = fx.circle.accountId;
    const view = <T>(method: string, args: object = {}) => sandbox.view<T>(contract, method, args);
    const blockMs = () => sandbox.blockTimestampMs();

    const dao = await sandbox.createAccount("dao", "10");
    const entry = { asset_type: "near-rpc:access", class: "B", delivery_methods: ["near_access_key"], accepted_proofs: ["rpc_access_key"], terms_hash: "ab".repeat(32) };
    expect((await dao.call({ receiverId: contract, methodName: "set_asset_class", args: { asset_type: entry.asset_type, entry }, deposit: 0n })).failures).toEqual([]);

    const db = openDatabase(":memory:");
    const indexer = new Indexer({
      db, source: new RpcBlockSource(rpcChainReader(new FailoverRpcClient({ endpoints: [rpcUrl] })), contract, 1), circleId: "agents-main",
      contractId: contract, startBlock: 1, fetchParams: () => view<ContractAbi.Params>("get_params"),
    });
    await indexer.bootstrap();
    api = createApiServer({ db });
    await new Promise<void>((resolve) => api!.listen(0, "127.0.0.1", resolve));
    const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    const count = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);
    const drain = async (until: () => boolean) => {
      for (let i = 0; i < 60; i++) {
        await indexer.drain();
        if (until()) return;
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error("indexer did not reach the expected state");
    };
    await drain(() => count("select count(*) as n from members where status = 'active'") >= 6);

    const brokerAccount = await sandbox.createAccount("broker", "10");
    const lease = await sandbox.createAccount("lease", "10");
    const log: string[] = [];
    broker = await startBroker({
      config: {
        readApiUrl: apiUrl, circleId: "agents-main", contractId: contract, facilitatorUrl: stack.facilitatorUrl, rpcUrl,
        brokerAccount: brokerAccount.accountId, brokerKey: brokerAccount.secretKey, leaseAccount: lease.accountId, leaseKey: lease.secretKey,
        port: 0, dbPath: ":memory:", pollSeconds: 15,
      },
      now: () => Date.now() + clock.offsetMs, poll: false, extraCacheMs: 0, log: (line) => log.push(line),
    });
    const viewKey = createViewAccessKeyFn({ rpcUrls: [rpcUrl], finality: "optimistic" });
    const sendAs = (name: "scraper" | "translator") => async (call: ContractCall) => {
      const result = await fx.members.get(name)!.call(call);
      if (result.failures.length > 0) throw new Error(result.failures.join("; "));
      return result.value;
    };
    const callWithKey: CallWithKey = async (key, methodName, deposit) => {
      try {
        const send = createNearSender({ rpcUrl, accountId: lease.accountId, secretKey: key.secretKey as `ed25519:${string}` });
        await send({ receiverId: contract, methodName, args: {}, deposit, gas: 30_000_000_000_000n });
        return { ok: true, hash: "" };
      } catch (error) {
        return { ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 160) };
      }
    };

    const now0 = await blockMs();
    const grantId = await offerRental({
      send: sendAs("scraper"), contract, scope: rentalScope(contract, ["get_params"]), unitPrice: PRICE, operator: brokerAccount.accountId, expiresAtMs: now0 + 30 * RENTAL_DAY_MS,
    });
    step("scraper offers class B rental `near-rpc:access` (method get_params, 0.05 credit a day, operator = broker)", `grant ${grantId}, status ${(await view<AccessGrant>("get_grant", { grant_id: grantId })).status}`);
    const key = await acceptRental({ send: sendAs("translator"), contract, grantId });
    step("translator accepts with its own function-call key as delivery_pubkey", `grant status ${(await view<AccessGrant>("get_grant", { grant_id: grantId })).status}; the secret key never leaves translator`);

    const challenge = await fetch(`${broker.url}/grants/${grantId}/lease`);
    const required = (await challenge.json()) as { accepts: Array<{ scheme: string; payTo: string; amount: string; extra: Record<string, unknown> }> };
    const x207 = required.accepts.find((a) => a.scheme === "batch-settlement")!;
    step("translator asks the broker for the lease without paying", `HTTP ${challenge.status}, x207 entry payTo ${x207.payTo.split(".")[0]} (the grantor, not the broker), extra.grantId ${String(x207.extra.grantId)}, amount ${x207.amount}`);
    expect(challenge.status).toBe(402);
    expect(x207).toMatchObject({ payTo: id.scraper.accountId, extra: { grantId } });

    const leased = await payLease({ buy: createAgentBuyer(id.translator, { rpcUrls: [rpcUrl] }), brokerUrl: broker.url, grantId });
    step("translator pays one day with an ordinary x402 voucher", `HTTP ${leased.status}, key ${String(leased.body.publicKey).slice(0, 18)}… installed on ${String(leased.body.account)}, paidUntil ${String(leased.body.paidUntil)}`);
    expect(leased.status, JSON.stringify(leased.body)).toBe(200);
    expect(leased.body.publicKey).toBe(key.publicKey);
    const seen = await viewKey(lease.accountId, key.publicKey);
    step("read the key from the node (view_access_key)", JSON.stringify(seen?.permission));

    const probe = await probeKey(callWithKey, key, "get_params", "get_epoch");
    assertProbe(probe);
    step("translator calls get_params with the key", `ok (${probe.allowed.ok})`);
    step("translator calls get_epoch (not on the list) and get_params with 1 yoctoNEAR deposit", `refused by the NEAR protocol: ${probe.otherMethod.ok ? "" : probe.otherMethod.error.split("\n")[0]} | ${probe.withDeposit.ok ? "" : probe.withDeposit.error.split("\n")[0]}`);

    // penyewa berutang 3 credit ke image dan tidak membayar: defaulted saat epoch difinalisasi
    const epoch = (await view<ContractAbi.EpochView>("get_epoch")).epoch;
    const { signature, ...voucher } = signVoucher(
      { circle: contract, payer: id.translator.accountId, payee: id.image.accountId, epoch, seq: 1, cumulativeAmount: "3000000", unit: "credit", resource: "https://seller.example/api" },
      id.translator.voucherSecretKey,
    );
    expect((await fx.members.get("translator")!.call({ receiverId: contract, methodName: "register_cumulative", args: { voucher, signature }, deposit: 0n, gas: 100_000_000_000_000n })).failures).toEqual([]);
    const keeperAccount = await sandbox.createAccount("keeper", "20");
    const keeper = () =>
      keeperPass({
        log: () => {}, view: (m: string, a: object) => sandbox.view(contract, m, a), chainNowMs: () => blockMs(),
        send: async ({ methodName, args }: { methodName: string; args: object }) => {
          const r = await sandbox.accountFrom(keeperAccount.accountId, keeperAccount.secretKey).call({ receiverId: contract, methodName, args, deposit: 0n }, "EXECUTED_OPTIMISTIC");
          if (r.failures.length > 0) throw new Error(r.failures.join("; "));
          return r.hash;
        },
      });
    for (const deadline of ["cutoff_at", "proposal_deadline", "payment_deadline"]) {
      const target = Number(BigInt((await view<Record<string, string | null>>("get_epoch", { epoch }))[deadline]!) / 1_000_000n) + 1_000;
      await sandbox.advanceTo(target);
      clock.offsetMs = (await blockMs()) - Date.now();
      await new Promise((r) => setTimeout(r, 2_000));
      await keeper();
    }
    const finalizedAt = Date.now();
    step("translator does not pay its residual; the keeper runs close_epoch, commit_epoch and finalize_epoch", `translator is ${(await view<ContractAbi.MemberView>("member", { account_id: id.translator.accountId })).status}`);
    await drain(() => count("select count(*) as n from events_raw where event = 'member_defaulted'") >= 1);
    await broker.tick();
    step("the broker reads member_defaulted from the read API and revokes", `key deleted ${Date.now() - finalizedAt} ms after finalize_epoch; grant ${(await view<AccessGrant>("get_grant", { grant_id: grantId })).status}`);
    expect(await viewKey(lease.accountId, key.publicKey)).toBeNull();
    const after = await probeKey(callWithKey, key, "get_params", "get_epoch");
    expect(after.allowed.ok).toBe(false);
    step("translator calls get_params again with the same key", `refused: ${after.allowed.ok ? "" : after.allowed.error.split("\n")[0]}`);
    const again = await payLease({ buy: createAgentBuyer(id.gpu, { rpcUrls: [rpcUrl] }), brokerUrl: broker.url, grantId });
    step("another member asks for the lease of the revoked grant", `HTTP ${again.status} ${String(again.body.error)}`);
    expect([again.status, again.body.error]).toEqual([403, "grant_revoked"]);
    expect(log.filter((l) => /register_/.test(l))).toEqual([]);
    out("result: lease paid with an ordinary voucher, allowed call worked, other method and deposit refused, key deleted after the default; the broker never wrote D2 or D3");
  }, 900_000);
});
