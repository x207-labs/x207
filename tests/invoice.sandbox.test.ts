// UM-086: invoices and installments in near-sandbox, through the clearing of F3. The ring of the first scenario (maker -> supplier -> retailer -> maker) in the first epoch it can be:
// an invoice of 90 credit in three installments (one per epoch, maker owes supplier), and two invoices of 30 credit that close the ring (supplier owes retailer, retailer owes
// maker) in the epoch of the first installment. Every voucher is the one the debtor signed in the invoice book (SDK format, seq 1 of the pair in its epoch); the issuer registers
// it on the contract; the indexer reads the events, so the book shows the installments as registered; the keeper, the indexer, the read API and the solver clear the cycle.
//   epoch E     the three invoices are requested and approved (nothing is registered yet)
//   epoch E+1   installment 1 + the two invoices close the ring: 90 credit of obligation, 90 cleared, nothing to pay
//   epoch E+2   installment 2 (30 credit) alone: no cycle, 30 credit goes to the residual path F4
//   epoch E+3   installment 3 the same
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { createCircleViewFn, installmentVoucher, onboardMember, parseEventLog, planInstallments, signVoucher, invoiceHash, type ContractAbi, type ContractCall, type InvoiceDocument } from "@x207/core";
import { FailoverRpcClient, Indexer, RpcBlockSource, createApiServer, openDatabase, rpcChainReader } from "../backend/src/index.ts";
import { viewClearedEdges } from "../backend/src/indexer/view-edges.ts";
import { marketplaceRoutes } from "../backend/src/marketplace/index.ts";
import { keeperPass } from "../scripts/lib/keeper.mjs";
import { TERMS_HASH, deployCircle, type CircleFixture } from "../sdk/test-support/circle.ts";
import { sandboxAvailable, type SandboxAccount } from "../sdk/test-support/sandbox.ts";
import { InvoiceBook, type InvoiceActor } from "../agents/scenario/invoice-book.ts";

const run = promisify(execFile);
const credit = (n: number): string => (BigInt(n) * 1_000_000n).toString();
type Member = { account: SandboxAccount; secretKey: `ed25519:${string}` };

describe.skipIf(!sandboxAvailable)("UM-086 invoice and installments of three epochs in the clearing cycle", () => {
  let fx: CircleFixture;
  let api: Server | undefined;
  afterAll(async () => {
    api?.close();
    await fx?.stop();
  });

  it("TC-UM-086-01 invoices and installments registered through the book, cleared in the ring, the rest paid through the residual path", async () => {
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
    const supplier = await join("supplier");
    const maker = await join("maker");
    const retailer = await join("retailer");
    const actor = (m: Member): InvoiceActor => ({ account: m.account.accountId, secretKey: m.secretKey });
    const contract = fx.circle.accountId;
    const view_ = <T,>(method: string, args: object) => fx.sandbox.view<T>(contract, method, args);

    // --- keeper, indexer, read API with the invoice book
    const keeper = await fx.sandbox.createAccount("keeper", "20");
    const actions: Array<{ method: string; epoch: number }> = [];
    const events: Array<Record<string, unknown> & { event: string }> = [];
    const pass = async () => {
      const done = (await keeperPass({
        view: (m: string, a: object) => view_(m, a),
        chainNowMs: () => fx.sandbox.blockTimestampMs(),
        send: async ({ methodName, args }: { methodName: string; args: object }) => {
          const r = await fx.sandbox.accountFrom(keeper.accountId, keeper.secretKey).call({ receiverId: contract, methodName, args, deposit: 0n, gas: 200_000_000_000_000n }, "FINAL");
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
    const book = new InvoiceBook(apiUrl, "agents-main", contract);

    // --- epoch E: the three invoices are requested and approved
    const E = (await view_<ContractAbi.EpochView>("get_epoch", {})).epoch;
    await catchUp(() => (db.prepare("select count(*) as n from members").get() as { n: number }).n === 3);
    const docX: InvoiceDocument = { id: "INV-X", issuer: supplier.account.accountId, debtor: maker.account.accountId, amount: credit(90), memo: "components, three installments" };
    const docY: InvoiceDocument = { id: "INV-Y", issuer: retailer.account.accountId, debtor: supplier.account.accountId, amount: credit(30), memo: "storefront ads" };
    const docZ: InvoiceDocument = { id: "INV-Z", issuer: maker.account.accountId, debtor: retailer.account.accountId, amount: credit(30), memo: "finished goods" };
    const rx = await book.request(docX, 3, actor(supplier));
    const ry = await book.request(docY, 1, actor(retailer));
    const rz = await book.request(docZ, 1, actor(maker));
    expect(rx.installments.map((i) => i.epoch)).toEqual([E + 1, E + 2, E + 3]);
    expect(ry.installments[0]!.epoch).toBe(E + 1);
    expect((await book.approve(rx.invoiceHash, actor(maker))).status).toBe("approved");
    expect((await book.approve(ry.invoiceHash, actor(supplier))).status).toBe("approved");
    expect((await book.approve(rz.invoiceHash, actor(retailer))).status).toBe("approved");

    // The issuer registers what the debtor signed, and takes it from the invoice book (GET invoice returns the voucher and the signature of each approved installment, BE-051).
    // The voucher of the book must be the one of the plan: ed25519 signs the same bytes to the same signature, so the rebuilt one is a check, not the source.
    const register = async (doc: InvoiceDocument, hash: string, count: number, index: number, payer: Member) => {
      const item = (await book.get(hash)).installments.find((i) => i.index === index)!;
      expect(item.voucher, `${doc.id} ${index} has a voucher in the book`).not.toBeNull();
      const plan = planInstallments({ circle: contract, doc, firstEpoch: E + 1, count });
      const rebuilt = signVoucher(installmentVoucher(plan, index), payer.secretKey);
      expect({ voucher: item.voucher, signature: item.signature }).toEqual({ voucher: installmentVoucher(plan, index), signature: rebuilt.signature });
      const r = await payer.account.call({ receiverId: contract, methodName: "register_cumulative", args: { voucher: item.voucher, signature: item.signature }, deposit: 0n, gas: 100_000_000_000_000n }, "FINAL");
      expect(r.failures, `${doc.id} ${index}`).toEqual([]);
    };
    const cycleThrough = async (epoch: number, solve: boolean) => {
      const open = await view_<ContractAbi.EpochView>("get_epoch", { epoch });
      await advance(open.cutoff_at);
      expect((await pass()).filter((a) => a.epoch === epoch).map((a) => a.method)).toEqual(["close_epoch"]);
      if (solve) {
        await catchUp(() => phaseOf(epoch) !== "open");
        const solver = await fx.sandbox.createAccount(`solver${epoch}`, "20");
        await run("node", ["solver/dist/cli.js", "--epoch", String(epoch)], {
          env: { PATH: process.env.PATH, X207_READ_API_URL: apiUrl, X207_CIRCLE_ID: "agents-main", NEAR_RPC_URL: rpcUrl, X207_CONTRACT_ID: contract, SOLVER_ACCOUNT_ID: solver.accountId, SOLVER_PRIVATE_KEY: solver.secretKey },
        });
      }
    };
    const commit = async (epoch: number) => {
      const closing = await view_<ContractAbi.EpochView>("get_epoch", { epoch });
      await advance(closing.proposal_deadline);
      expect((await pass()).filter((a) => a.epoch === epoch).map((a) => a.method)).toEqual(["commit_epoch"]);
    };

    // --- close E (empty), then E+1 is open: the ring
    await cycleThrough(E, false);
    const now = await view_<ContractAbi.EpochView>("get_epoch", {});
    expect({ epoch: now.epoch, phase: now.phase }).toEqual({ epoch: E + 1, phase: "open" });
    await register(docX, rx.invoiceHash, 3, 1, maker);
    await register(docY, ry.invoiceHash, 1, 1, supplier);
    await register(docZ, rz.invoiceHash, 1, 1, retailer);
    await commit(E);
    await catchUp(async () => {
      return (db.prepare("select count(*) as n from events_raw where event = 'voucher_registered'").get() as { n: number }).n >= 3;
    });
    const afterRing = await Promise.all([rx, ry, rz].map((r) => book.get(r.invoiceHash)));
    expect(afterRing[0]!.installments.map((i) => i.status)).toEqual(["registered", "scheduled", "scheduled"]);
    expect(afterRing[1]!.status).toBe("registered");
    expect(afterRing[2]!.status).toBe("registered");

    // --- E+1: clearing of the ring
    await cycleThrough(E + 1, true);
    await commit(E + 1);
    const ring = await view_<ContractAbi.EpochView>("get_epoch", { epoch: E + 1 });
    expect(ring.total_obligation).toBe(credit(90));
    expect(ring.total_cleared).toBe(credit(90));
    const ringPositions = await view_<Array<{ role: string; amount: string }>>("list_positions", { epoch: E + 1, from_index: 0, limit: 100 });
    expect(ringPositions.filter((p) => p.role === "debtor")).toEqual([]); // nothing left to pay

    // --- E+2: installment 2 alone
    expect((await view_<ContractAbi.EpochView>("get_epoch", {})).epoch).toBe(E + 2);
    await register(docX, rx.invoiceHash, 3, 2, maker);
    await cycleThrough(E + 2, true);
    await commit(E + 2);
    const second = await view_<ContractAbi.EpochView>("get_epoch", { epoch: E + 2 });
    expect({ obligation: second.total_obligation, cleared: second.total_cleared }).toEqual({ obligation: credit(30), cleared: "0" });

    // --- E+3: installment 3 alone
    expect((await view_<ContractAbi.EpochView>("get_epoch", {})).epoch).toBe(E + 3);
    await register(docX, rx.invoiceHash, 3, 3, maker);
    await cycleThrough(E + 3, true);
    await commit(E + 3);

    // --- the book and the report
    await catchUp(() => ["payment_window", "finalized"].includes(phaseOf(E + 3) ?? ""));
    const x = await book.get(rx.invoiceHash);
    expect(x.status).toBe("registered");
    expect(x.installments.map((i) => i.status)).toEqual(["registered", "registered", "registered"]);
    expect((await book.list(maker.account.accountId, "registered")).items.map((i) => i.invoiceHash).sort()).toEqual([rx.invoiceHash, rz.invoiceHash].sort());
    const report = async (epoch: number) => (await (await fetch(`${base}/epochs/${epoch}`)).json()) as { cleared: string; members: Array<{ account: string; status: number; net: string }> };
    const ringReport = await report(E + 1);
    expect(BigInt(ringReport.cleared)).toBe(BigInt(credit(90)));
    for (const m of ringReport.members) expect(m.net === "0" || m.net === "+0" || m.net === "-0" || BigInt(m.net) === 0n).toBe(true);
    const twoReport = await report(E + 2);
    const rowOf = (members: typeof twoReport.members, m: Member) => members.find((r) => r.account === m.account.accountId)!;
    expect(rowOf(twoReport.members, maker)).toMatchObject({ status: 402, net: `-${credit(30)}` });
    expect(rowOf(twoReport.members, supplier)).toMatchObject({ status: 202, net: `+${credit(30)}` });
    console.log(["UM-086", `epochs ${E}..${E + 3}`, `ring: obligation ${ring.total_obligation} cleared ${ring.total_cleared}`, `E+2: obligation ${second.total_obligation} cleared ${second.total_cleared}`, `actions ${actions.map((a) => `${a.method}:${a.epoch}`).join(" ")}`].join("\n"));
    void invoiceHash;
    void createServer;
  }, 1_800_000);
});
