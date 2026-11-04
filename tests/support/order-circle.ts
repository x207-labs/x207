// A circle of members on a real contract in near-sandbox, an indexer, the read API with the order routes, and the helpers that the order tests share (UM-108): open a member,
// read the pair state of the indexer, register a voucher on the contract, wait for the book. The code is the setup of tests/orders.sandbox.test.ts.
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect } from "vitest";
import { createCircleViewFn, onboardMember, type ContractAbi, type ContractCall, type Voucher } from "@x207/core";
import { FailoverRpcClient, Indexer, RpcBlockSource, createApiServer, openDatabase, rpcChainReader } from "../../backend/src/index.ts";
import { viewClearedEdges } from "../../backend/src/indexer/view-edges.ts";
import { marketplaceRoutes } from "../../backend/src/marketplace/index.ts";
import { TERMS_HASH, deployCircle, type CircleFixture } from "../../sdk/test-support/circle.ts";
import type { SandboxAccount } from "../../sdk/test-support/sandbox.ts";
import { OrderBook } from "../../agents/scenario/services.ts";
import type { InvoiceActor } from "../../agents/scenario/invoice-book.ts";

export const credit = (n: number): string => (BigInt(n) * 1_000_000n).toString();
export type Member = { account: SandboxAccount; secretKey: `ed25519:${string}` };

export type OrderCircle = {
  fx: CircleFixture;
  api: Server;
  book: OrderBook;
  contract: string;
  /** The open epoch of the contract when the members have joined. */
  epoch: number;
  actor: (m: Member) => InvoiceActor;
  members: Record<string, Member>;
  /** The cumulative voucher of a pair in the indexer: what the next voucher continues from. */
  pair: (debtor: Member, creditor: Member, epoch: number) => { seq: number; cumulativeAmount: string };
  registerOnChain: (v: Voucher, by: Member) => Promise<void>;
  /** Drain the indexer and nudge the sandbox clock until the book answers true. */
  until: (done: () => Promise<boolean>) => Promise<void>;
  catchUp: (done: () => boolean) => Promise<void>;
  stop: () => Promise<void>;
};

export async function startOrderCircle(names: string[]): Promise<OrderCircle> {
  const fx = await deployCircle();
  const rpcUrl = fx.sandbox.rpcUrl;
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
  const members: Record<string, Member> = {};
  for (const name of names) members[name] = await join(name);
  const contract = fx.circle.accountId;
  const view_ = <T,>(method: string, args: object) => fx.sandbox.view<T>(contract, method, args);
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
    const count = (db.prepare("select count(*) as n from members").get() as { n: number }).n;
    throw new Error(`the indexer did not catch up in 90 seconds: members ${count}`);
  };
  const until = async (done: () => Promise<boolean>) => {
    for (let i = 0; i < 90; i++) {
      await indexer.drain();
      if (await done()) return;
      if (i % 5 === 4) await fx.sandbox.advanceTo((await fx.sandbox.blockTimestampMs()) + 2_000);
      await new Promise((r) => setTimeout(r, 1_000));
    }
    throw new Error("the condition did not hold in 90 seconds");
  };
  const api = createApiServer({ db, extraRoutes: marketplaceRoutes(db, { chainView: (_contract: string, method: string, args: object) => view_(method, args) }) });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  const book = new OrderBook(apiUrl, "agents-main", contract);
  await catchUp(() => (db.prepare("select count(*) as n from members").get() as { n: number }).n === names.length);
  const epoch = (await view_<ContractAbi.EpochView>("get_epoch", {})).epoch;
  return {
    fx, api, book, contract, epoch, members,
    actor: (m) => ({ account: m.account.accountId, secretKey: m.secretKey }),
    pair: (debtor, creditor, e) => {
      const row = db.prepare("SELECT seq, cumulative_amount FROM obligations WHERE circle_id = 'agents-main' AND epoch = ? AND debtor = ? AND creditor = ?").get(e, debtor.account.accountId, creditor.account.accountId) as { seq: number | bigint; cumulative_amount: string } | undefined;
      return { seq: Number(row?.seq ?? 0), cumulativeAmount: String(row?.cumulative_amount ?? "0") };
    },
    registerOnChain: async (v, by) => {
      const { signature, ...voucher } = v;
      const r = await by.account.call({ receiverId: contract, methodName: "register_cumulative", args: { voucher, signature }, deposit: 0n, gas: 100_000_000_000_000n }, "FINAL");
      expect(r.failures).toEqual([]);
    },
    until, catchUp,
    stop: async () => {
      api.close();
      await fx.stop();
    },
  };
}
