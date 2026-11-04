// UM-087: service orders (P6) in near-sandbox. Two agents that are members of a real circle on a real contract: `research` buys an audit from `audit` in two milestones, and
// `research` also hires the member `keeper` for a keeper order. What the SDK, the backend and the contract each do:
//   - the order is opened by both signatures (order book, BE-054); milestone 1 is delivered and confirmed, the buyer signs its voucher after the confirmation (`payMilestone`), the seller
//     registers it on the contract, the indexer reads `voucher_registered`, so the book shows the milestone `paid`;
//   - milestone 2 is delivered and disputed: no voucher is signed, nothing moves on the chain, and a confirmation after the dispute is refused;
//   - the keeper order pays per transaction that shows on the chain (BE-055): the keeper member itself calls `close_epoch`, the indexer stores `epoch_cutoff` with the signer, the list
//     `onchain-proofs` has that call, and `payProofs` signs one voucher for it; the pair `(research, keeper)` then holds exactly the price of one call.
import { execFile as _execFile } from "node:child_process";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { createCircleViewFn, onboardMember, parseEventLog, type ContractAbi, type ContractCall, type OrderDocument, type Voucher } from "@x207/core";
import { FailoverRpcClient, Indexer, RpcBlockSource, createApiServer, openDatabase, rpcChainReader } from "../backend/src/index.ts";
import { viewClearedEdges } from "../backend/src/indexer/view-edges.ts";
import { marketplaceRoutes } from "../backend/src/marketplace/index.ts";
import { keeperPass } from "../scripts/lib/keeper.mjs";
import { TERMS_HASH, deployCircle, type CircleFixture } from "../sdk/test-support/circle.ts";
import { sandboxAvailable, type SandboxAccount } from "../sdk/test-support/sandbox.ts";
import { OrderBook, hashOf, ledgerFor, payMilestone, payProofs } from "../agents/scenario/services.ts";
import type { InvoiceActor } from "../agents/scenario/invoice-book.ts";

void _execFile;
const credit = (n: number): string => (BigInt(n) * 1_000_000n).toString();
type Member = { account: SandboxAccount; secretKey: `ed25519:${string}` };

describe.skipIf(!sandboxAvailable)("UM-087 service orders: two milestones, a dispute without payment, a keeper paid per transaction", () => {
  let fx: CircleFixture;
  let api: Server | undefined;
  afterAll(async () => {
    api?.close();
    await fx?.stop();
  });

  it("TC-UM-087-01 a confirmed milestone is paid and registered, a disputed one is not, and a keeper is paid for the transaction that shows on the chain", async () => {
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
      return { account, secretKey: joined.secretKey };
    };
    const research = await join("research");
    const audit = await join("audit");
    const keeperMember = await join("keeper");
    const contract = fx.circle.accountId;
    const view_ = <T,>(method: string, args: object) => fx.sandbox.view<T>(contract, method, args);

    // --- keeper, indexer, read API with the invoice book
    const actions: Array<{ method: string; epoch: number }> = [];
    const events: Array<Record<string, unknown> & { event: string }> = [];
    const pass = async () => {
      const done = (await keeperPass({
        view: (m: string, a: object) => view_(m, a),
        chainNowMs: () => fx.sandbox.blockTimestampMs(),
        send: async ({ methodName, args }: { methodName: string; args: object }) => {
          const r = await keeperMember.account.call({ receiverId: contract, methodName, args, deposit: 0n, gas: 200_000_000_000_000n }, "FINAL");
          if (r.failures.length > 0) throw new Error(r.failures.join("; "));
          for (const line of r.logs) events.push(...((parseEventLog(line) ?? []) as typeof events));
          return r.hash;
        },
      })) as Array<{ method: string; epoch: number }>;
      actions.push(...done);
      return done;
    };
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
    api = createApiServer({ db, extraRoutes: marketplaceRoutes(db, { chainView: (_contract: string, method: string, args: object) => view_(method, args) }) });
    await new Promise<void>((resolve) => api!.listen(0, "127.0.0.1", resolve));
    const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    const base = `${apiUrl}/x207/circles/agents-main`;
    const book = new OrderBook(apiUrl, "agents-main", contract);
    const actor = (m: Member): InvoiceActor => ({ account: m.account.accountId, secretKey: m.secretKey });
    const [buyer, seller, keeper] = [actor(research), actor(audit), actor(keeperMember)];
    await catchUp(() => (db.prepare("select count(*) as n from members").get() as { n: number }).n === 3);
    const E = (await view_<ContractAbi.EpochView>("get_epoch", {})).epoch;
    const pair = (debtor: Member, creditor: Member, epoch: number) => {
      const row = db.prepare("SELECT seq, cumulative_amount FROM obligations WHERE circle_id = 'agents-main' AND epoch = ? AND debtor = ? AND creditor = ?").get(epoch, debtor.account.accountId, creditor.account.accountId) as { seq: number | bigint; cumulative_amount: string } | undefined;
      return { seq: Number(row?.seq ?? 0), cumulativeAmount: String(row?.cumulative_amount ?? "0") };
    };
    const registerOnChain = async (v: Voucher, by: Member) => {
      const { signature, ...voucher } = v;
      const r = await by.account.call({ receiverId: contract, methodName: "register_cumulative", args: { voucher, signature }, deposit: 0n, gas: 100_000_000_000_000n }, "FINAL");
      expect(r.failures).toEqual([]);
    };
    const nowS = Math.floor(Date.now() / 1000);
    // like `catchUp`, for a condition that asks the book (async): drain the indexer, nudge the sandbox clock, ask again
    const until = async (done: () => Promise<boolean>) => {
      for (let i = 0; i < 90; i++) {
        await indexer.drain();
        if (await done()) return;
        if (i % 5 === 4) await fx.sandbox.advanceTo((await fx.sandbox.blockTimestampMs()) + 2_000);
        await new Promise((r) => setTimeout(r, 1_000));
      }
      throw new Error("the condition did not hold in 90 seconds");
    };

    // --- the order of an audit in two milestones: opened by both signatures
    const audit_: OrderDocument = {
      circle: contract, kind: "audit", buyer: research.account.accountId, seller: audit.account.accountId, spec_hash: hashOf("a"), sample_hash: null, target: null, proof: null, nonce: "um087-audit",
      milestones: [{ amount: credit(10), due_at: nowS + 86_400 }, { amount: credit(20), due_at: nowS + 2 * 86_400 }],
    };
    const hash = await book.open(audit_, buyer, seller);
    expect((await book.get(hash)).status).toBe("open");

    // --- milestone 1: delivered, confirmed, the buyer signs after the confirmation, the seller registers, the book says paid
    await book.milestone(hash, 1, seller, "delivered", { deliverable: hashOf("b") });
    expect((await book.milestone(hash, 1, buyer, "confirmed")).milestones[0]!.status).toBe("confirmed");
    const ledger = ledgerFor(audit_);
    const paid1 = payMilestone(ledger, 1, E, pair(research, audit, E), buyer);
    await registerOnChain(paid1, audit);
    await until(async () => (await book.get(hash)).milestones[0]!.status === "paid");
    expect(pair(research, audit, E).cumulativeAmount).toBe(credit(10));

    // --- milestone 2: delivered and disputed: no voucher, nothing on the chain, and a later confirmation is refused
    await book.milestone(hash, 2, seller, "delivered", { deliverable: hashOf("c") });
    expect((await book.milestone(hash, 2, buyer, "disputed", { reason: "not_as_described" })).milestones[1]).toMatchObject({ status: "disputed", disputeReason: "not_as_described" });
    await expect(book.milestone(hash, 2, buyer, "confirmed")).rejects.toThrow();
    expect(pair(research, audit, E).cumulativeAmount).toBe(credit(10));
    expect((await book.get(hash)).milestones[1]!.status).toBe("disputed");

    // --- the keeper order: paid per call of `close_epoch` that the member `keeper` makes itself
    const keeperOrder: OrderDocument = {
      circle: contract, kind: "keeper", buyer: research.account.accountId, seller: keeperMember.account.accountId, spec_hash: hashOf("d"), sample_hash: null, target: null,
      proof: { method: "close_epoch", amount_per_tx: credit(1) }, nonce: "um087-keeper", milestones: [{ amount: credit(3), due_at: nowS + 86_400 }],
    };
    const keeperHash = await book.open(keeperOrder, buyer, keeper);
    const open = await view_<ContractAbi.EpochView>("get_epoch", { epoch: E });
    await advance(open.cutoff_at);
    const done = (await pass()).filter((a) => a.epoch === E).map((a) => a.method);
    expect(done).toEqual(["close_epoch"]);
    await until(async () => (await book.proofs(keeperHash)).items.length > 0);
    const proofs = (await book.proofs(keeperHash)).items;
    expect(proofs.map((p) => [p.method, p.signer])).toEqual([["close_epoch", keeperMember.account.accountId]]);
    const E1 = (await view_<ContractAbi.EpochView>("get_epoch", {})).epoch;
    expect(E1).toBe(E + 1);
    const keeperLedger = ledgerFor(keeperOrder);
    const result = payProofs(keeperLedger, E1, pair(research, keeperMember, E1), proofs, buyer);
    expect(result.paid).toHaveLength(1);
    expect(result.refused).toEqual([]);
    await registerOnChain(result.vouchers[0]!, keeperMember);
    await until(async () => pair(research, keeperMember, E1).cumulativeAmount === credit(1));
    expect(pair(research, keeperMember, E1).cumulativeAmount).toBe(credit(1));
    // the agent runs again with the same proof: nothing is paid twice
    const again = payProofs(keeperLedger, E1, pair(research, keeperMember, E1), proofs, buyer);
    expect(again.paid).toEqual([]);
    expect(again.refused).toEqual([{ txHash: proofs[0]!.txHash, reason: "already_paid" }]);
    console.log(["UM-087", `epoch ${E}`, `audit pair ${pair(research, audit, E).cumulativeAmount}`, `keeper pair ${pair(research, keeperMember, E1).cumulativeAmount}`, `proofs ${proofs.length}`].join(" | "));
    void parseEventLog;
  }, 1_800_000);
});
