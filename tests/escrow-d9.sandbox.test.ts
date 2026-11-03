// CT-075 and D9: a class A escrow payment whose NFT transfer fails is taken back by the contract, and the read model of the indexer
// takes it back too, so the read API and the contract agree. Real contract and mock NFT in near-sandbox, real indexer and read API.
// Run: X207_SANDBOX=1 npx vitest run tests/escrow-d9.sandbox.test.ts
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createCircleViewFn, onboardMember, signVoucher, type ContractAbi, type ContractCall } from "@x207/core";
import { FailoverRpcClient, Indexer, RpcBlockSource, createApiServer, openDatabase, rpcChainReader } from "../backend/src/index.ts";
import { SHORT_PARAMS, TERMS_HASH, deployCircle, type CircleFixture } from "../sdk/test-support/circle.ts";
import { sandboxAvailable, type SandboxAccount } from "../sdk/test-support/sandbox.ts";

const NFT_WASM = resolve(join(import.meta.dirname, "../contracts/target/near/mock_nft/mock_nft.wasm"));
const PRICE = "10000000";

describe.skipIf(!sandboxAvailable)("CT-075 escrow in near-sandbox against D9", () => {
  let fx: CircleFixture | undefined;
  let api: Server | undefined;
  afterAll(async () => {
    api?.closeAllConnections?.();
    api?.close();
    await fx?.stop();
  });

  it("a failed delivery leaves D9 and the contract equal; the next buyer gets the NFT and D9 shows the payment", async () => {
    fx = await deployCircle({ ...SHORT_PARAMS, epoch_length: 3600 });
    const { sandbox } = fx;
    const contract = fx.circle.accountId;
    const rpcUrl = sandbox.rpcUrl;
    const view = <T>(method: string, args: object = {}) => sandbox.view<T>(contract, method, args);
    const circleView = createCircleViewFn({ circleContract: contract, rpcUrls: [rpcUrl] });
    const join = async (name: string) => {
      const account = await fx!.member(name);
      const joined = await onboardMember(
        {
          sendCall: async (c: ContractCall) => {
            const r = await account.call(c);
            if (r.failures.length > 0) throw new Error(r.failures.join("; "));
            return r.value;
          },
          view: circleView, pollIntervalMs: 200, timeoutMs: 30_000,
        },
        { circleContract: contract, circleId: fx!.circleId, accountId: account.accountId, termsHash: TERMS_HASH, stakeAmount: "150000000", usdtTokenId: fx!.usdt.accountId },
      );
      return { account, secretKey: joined.secretKey };
    };
    const [alice, bob, carol] = [await join("alice"), await join("bob"), await join("carol")];

    // registry, grant, NFT
    const dao = await sandbox.createAccount("dao", "10");
    const entry = { asset_type: "nft:ticket", class: "A", delivery_methods: ["escrow_nft"], accepted_proofs: [], terms_hash: "5a".repeat(32) };
    expect((await dao.call({ receiverId: contract, methodName: "set_asset_class", args: { asset_type: "nft:ticket", entry }, deposit: 0n })).failures).toEqual([]);
    const nft = await sandbox.createAccount("nft", "20");
    await sandbox.deploy(nft, NFT_WASM);
    expect((await nft.call({ receiverId: nft.accountId, methodName: "new", args: {}, deposit: 0n })).failures).toEqual([]);
    const now = await sandbox.blockTimestampMs();
    const offer = await alice.account.call({
      receiverId: contract, methodName: "offer_grant", deposit: 0n,
      args: { input: { asset_type: "nft:ticket", delivery_method: "escrow_nft", limits: { scope: JSON.stringify({ nft_contract: nft.accountId, token_id: "t1" }), quota: null, expires_at: (BigInt(now + 3_600_000) * 1_000_000n).toString() }, unit: "once", unit_price: PRICE, operator: null, proof_hash: null, proof_kind: null } },
    });
    expect(offer.failures).toEqual([]);
    const grantId = Number(offer.value);
    expect((await nft.call({ receiverId: nft.accountId, methodName: "nft_mint", args: { token_id: "t1", owner_id: alice.account.accountId }, deposit: 0n })).failures).toEqual([]);
    const deposit = await alice.account.call({
      receiverId: nft.accountId, methodName: "nft_transfer_call", deposit: 1n, gas: 150_000_000_000_000n,
      args: { receiver_id: contract, token_id: "t1", msg: JSON.stringify({ grant_id: grantId }) },
    });
    expect(deposit.failures).toEqual([]);
    const ownerOf = async () => (await sandbox.view<{ owner_id: string }>(nft.accountId, "nft_token", { token_id: "t1" })).owner_id;
    expect(await ownerOf()).toBe(contract);

    // indexer and read API
    const db = openDatabase(":memory:");
    const indexer = new Indexer({
      db, source: new RpcBlockSource(rpcChainReader(new FailoverRpcClient({ endpoints: [rpcUrl] })), contract, 1), circleId: "agents-main",
      contractId: contract, startBlock: 1, fetchParams: () => view<ContractAbi.Params>("get_params"),
    });
    await indexer.bootstrap();
    api = createApiServer({ db });
    await new Promise<void>((resolveListen) => api!.listen(0, "127.0.0.1", resolveListen));
    const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    const drainUntil = async (done: () => boolean) => {
      for (let i = 0; i < 60; i++) {
        await indexer.drain();
        if (done()) return;
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error("indexer did not reach the expected state");
    };
    const one = <T>(sql: string, ...args: unknown[]) => db.prepare(sql).get(...args) as T | undefined;
    const epoch = (await view<ContractAbi.EpochView>("get_epoch")).epoch;

    const pay = (who: { account: SandboxAccount; secretKey: `ed25519:${string}` }) => {
      const { signature, ...voucher } = signVoucher(
        { circle: contract, payer: who.account.accountId, payee: alice.account.accountId, epoch, seq: 1, cumulativeAmount: PRICE, unit: "credit", resource: `x207:grant:${grantId}` },
        who.secretKey,
      );
      return who.account.call({ receiverId: contract, methodName: "complete_escrow", args: { grant_id: grantId, voucher, signature }, deposit: 0n, gas: 200_000_000_000_000n });
    };

    // bob cannot receive the NFT: the transfer fails and the contract takes the payment back
    expect((await nft.call({ receiverId: nft.accountId, methodName: "block_receiver", args: { account_id: bob.account.accountId }, deposit: 0n })).failures).toEqual([]);
    // the only failure is the refusal of the NFT contract inside the transaction; the call itself and its callback succeed
    const attempt = await pay(bob);
    expect(attempt.failures).toHaveLength(1);
    expect(attempt.failures[0]).toContain("The receiver cannot receive tokens");
    expect(await ownerOf()).toBe(contract);
    await drainUntil(() => one<{ n: number }>("select count(*) as n from events_raw where event = 'escrow_failed'")!.n >= 1);
    expect(await view("obligation", { epoch, debtor: bob.account.accountId, creditor: alice.account.accountId })).toBeNull();
    expect(await view("outstanding_debt", { account_id: bob.account.accountId })).toBe("0");
    // D9 says the same
    expect(one("select * from obligations where debtor = ?", bob.account.accountId)).toBeUndefined();
    expect(one<{ outstanding_debt: number }>("select outstanding_debt from members where account_id = ?", bob.account.accountId)!.outstanding_debt).toBe(0);
    const memberApi = (await (await fetch(`${apiUrl}/x207/circles/agents-main/members/${bob.account.accountId}`)).json()) as { outstandingDebt: string; headroom: string; limit: string };
    expect(memberApi.outstandingDebt).toBe("0");
    expect(memberApi.headroom).toBe(memberApi.limit);
    expect(one<{ state: string }>("select state from escrows where grant_id = ?", grantId)!.state).toBe("held");

    // carol pays and gets the NFT; D9 and the contract agree on the payment
    expect((await pay(carol)).failures).toEqual([]);
    expect(await ownerOf()).toBe(carol.account.accountId);
    await drainUntil(() => one<{ state: string }>("select state from escrows where grant_id = ?", grantId)?.state === "delivered");
    const chainObligation = await view<{ obligation: string }>("obligation", { epoch, debtor: carol.account.accountId, creditor: alice.account.accountId });
    expect(chainObligation.obligation).toBe(PRICE);
    expect(one<{ cumulative_amount: number }>("select cumulative_amount from obligations where debtor = ?", carol.account.accountId)!.cumulative_amount).toBe(Number(PRICE));
    expect(await view("outstanding_debt", { account_id: carol.account.accountId })).toBe(PRICE);
    expect(one<{ outstanding_debt: number }>("select outstanding_debt from members where account_id = ?", carol.account.accountId)!.outstanding_debt).toBe(Number(PRICE));
    const grant = (await (await fetch(`${apiUrl}/x207/circles/agents-main/grants/${grantId}`)).json()) as { status: string; grantee: string; escrow: { state: string } };
    expect([grant.status, grant.grantee, grant.escrow.state]).toEqual(["active", carol.account.accountId, "delivered"]);
  }, 600_000);
});
