// UM-072 blok invoice (K-59, track `realworld`): tiga bisnis saling punya invoice, dicatat sebagai voucher dengan hash invoice
// off-chain, kliring F3 menghapus utang melingkar, selisih masuk jalur residual F4. Satu perintah dari akar payung:
//   npm run demo:realworld         (near-sandbox, kontrak, indexer, solver, dan keeper nyata)
// Dicetak "do X - see Y" untuk Appendix A README; total sebelum dan sesudah netting dibandingkan dengan posisi kontrak.
import { execFile } from "node:child_process";
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import { promisify } from "node:util";
import { writeSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { onboardMember, createCircleViewFn, parseEventLog, signVoucher, type ContractAbi, type ContractCall } from "@x207/core";
import { Indexer, RpcBlockSource, createApiServer, FailoverRpcClient, openDatabase, rpcChainReader } from "../backend/src/index.ts";
import { keeperPass } from "../scripts/lib/keeper.mjs";
import { TERMS_HASH, deployCircle, type CircleFixture } from "../sdk/test-support/circle.ts";
import { type SandboxAccount } from "../sdk/test-support/sandbox.ts";
import { buildInvoiceVouchers, formatNetting, latestPerPair, netInvoices, sampleInvoices } from "../agents/scenario/invoices.ts";

const run = promisify(execFile);
type Member = { account: SandboxAccount; secretKey: `ed25519:${string}` };

describe("demo invoice: three businesses, F3 clearing, F4 residual", () => {
  let fx: CircleFixture;
  let api: Server | undefined;
  afterAll(async () => {
    api?.close();
    await fx?.stop();
  });

  it("invoices become vouchers, clearing, residual", async () => {
    const out = (line: string) => writeSync(1, `${line}\n`);
    const step = (doX: string, seeY: string) => out(`do: ${doX}\n   see: ${seeY}`);
    fx = await deployCircle();
    const rpcUrl = fx.sandbox.rpcUrl;
    const startBlock = (await (await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "status", params: [] }) })).json() as any).result.sync_info.latest_block_height as number;
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
    const [supplier, maker, retailer] = [await join("supplier"), await join("maker"), await join("retailer")];
    const business = { supplier: supplier.account.accountId, maker: maker.account.accountId, retailer: retailer.account.accountId };
    const first = await fx.sandbox.view<ContractAbi.EpochView>(fx.circle.accountId, "get_epoch", {});
    const epoch = first.epoch;

    // Invoice -> voucher kumulatif dengan resource = invoice:<hash>; didaftarkan oleh debitur sendiri
    const invoices = sampleInvoices(business);
    const netting = netInvoices(invoices);
    const members = [supplier, maker, retailer];
    const vouchers = buildInvoiceVouchers({
      circle: fx.circle.accountId, epoch, invoices,
      secretKeys: Object.fromEntries(members.map((m) => [m.account.accountId, m.secretKey])),
    });
    out("\n== K-59 realworld: three businesses, three invoices");
    for (const i of invoices) out(`   ${i.id}: ${i.debtor.split(".")[0]} owes ${i.issuer.split(".")[0]} ${Number(i.amount) / 1e6} credit (${i.memo})`);
    step("each debtor signs a voucher whose resource is invoice:<sha256 of the invoice>", `${vouchers.length} vouchers, resources ${vouchers.map((v) => `invoice:${v.hash.slice(0, 8)}…`).join(", ")}; invoice text never goes on-chain`);
    for (const v of latestPerPair(vouchers)) {
      expect(v.voucher.resource).toBe(`invoice:${v.hash}`);
      const payer = members.find((m) => m.account.accountId === v.voucher.payer)!;
      const r = await payer.account.call({ receiverId: fx.circle.accountId, methodName: "register_cumulative", args: { voucher: v.voucher, signature: v.signature }, deposit: 0n, gas: 100_000_000_000_000n }, "EXECUTED_OPTIMISTIC");
      expect(r.failures).toEqual([]);
    }

    const keeper = await fx.sandbox.createAccount("keeper", "20");
    const events: Array<Record<string, unknown> & { event: string }> = [];
    const pass = () =>
      keeperPass({
        view: (m: string, a: object) => fx.sandbox.view(fx.circle.accountId, m, a),
        chainNowMs: () => fx.sandbox.blockTimestampMs(),
        send: async ({ methodName, args }: { methodName: string; args: object }) => {
          const r = await fx.sandbox.accountFrom(keeper.accountId, keeper.secretKey).call({ receiverId: fx.circle.accountId, methodName, args, deposit: 0n, gas: 200_000_000_000_000n }, "EXECUTED_OPTIMISTIC");
          if (r.failures.length > 0) throw new Error(r.failures.join("; "));
          for (const line of r.logs) events.push(...((parseEventLog(line) ?? []) as typeof events));
          return r.hash;
        },
      }) as Promise<Array<{ method: string; epoch: number }>>;
    const advance = async (ns: string | null | undefined) => {
      await fx.sandbox.advanceTo(Number(BigInt(ns!) / 1_000_000n) + 1_000);
      await new Promise((r) => setTimeout(r, 3_000));
    };

    await advance(first.cutoff_at);
    expect((await pass()).filter((a) => a.epoch === epoch).map((a) => a.method)).toEqual(["close_epoch"]);
    const cutoff = events.find((e) => e.event === "epoch_cutoff")!;

    // Indexer nyata membaca blok dari sandbox; read API melayani D9.
    const db = openDatabase(":memory:");
    const client = new FailoverRpcClient({ endpoints: [rpcUrl] });
    const indexer = new Indexer({
      db, source: new RpcBlockSource(rpcChainReader(client), fx.circle.accountId, startBlock), circleId: "agents-main",
      contractId: fx.circle.accountId, startBlock,
      fetchParams: () => fx.sandbox.view(fx.circle.accountId, "get_params", {}) as Promise<ContractAbi.Params>,
    });
    await indexer.bootstrap();
    // Indexer membaca blok final; setelah fast_forward head final menyusul beberapa detik kemudian.
    const catchUp = async (done: () => boolean) => {
      for (let i = 0; i < 60; i++) {
        await indexer.drain();
        if (done()) return;
        await new Promise((r) => setTimeout(r, 1_000));
      }
      throw new Error("indexer did not catch up within 60 seconds");
    };
    const phaseOf = () => (db.prepare("select phase from epochs where epoch = ?").get(epoch) as { phase: string } | undefined)?.phase;
    await catchUp(() => phaseOf() !== "open");
    api = createApiServer({ db });
    await new Promise<void>((resolve) => api!.listen(0, "127.0.0.1", resolve));
    const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    const base = `${apiUrl}/x207/circles/agents-main`;

    // 01: tiga edge; totalObligation dari kontrak sama dengan total invoice sebelum netting
    const snapshot = (await (await fetch(`${base}/epochs/${epoch}/obligations?stage=cutoff`)).json()) as { edgeCount: number; totalObligation: string; edges: unknown[] };
    expect(snapshot.edges).toHaveLength(3);
    expect(snapshot.edgeCount).toBe(Number(cutoff.edge_count));
    expect(snapshot.totalObligation).toBe(cutoff.total_obligation);
    expect(BigInt(snapshot.totalObligation)).toBe(netting.before);
    step("close the epoch and read the obligation snapshot", `contract total ${snapshot.totalObligation} = invoice total before netting ${netting.before}`);

    // 02: solver nyata membaca snapshot dan mengirim submit_clearing
    const solver = await fx.sandbox.createAccount("solver", "20");
    const { stdout } = await run("node", ["solver/dist/cli.js", "--epoch", String(epoch)], {
      env: {
        PATH: process.env.PATH, X207_READ_API_URL: apiUrl, X207_CIRCLE_ID: "agents-main", NEAR_RPC_URL: rpcUrl,
        X207_CONTRACT_ID: fx.circle.accountId, SOLVER_ACCOUNT_ID: solver.accountId, SOLVER_PRIVATE_KEY: solver.secretKey,
      },
    });
    const proposal = JSON.parse(stdout.trim().split("\n").at(-1)!) as { edges: Array<{ cleared: string }> };
    expect(proposal.edges.reduce((sum, e) => sum + BigInt(e.cleared), 0n)).toBe(netting.cleared);
    const stored = await fx.sandbox.view<{ cleared_total: string }>(fx.circle.accountId, "get_clearing_proposal", { epoch });
    expect(BigInt(stored.cleared_total)).toBe(netting.cleared);
    step("run the solver (submit_clearing)", `cleared ${stored.cleared_total} = cycle netting ${netting.cleared} (60 credit around the ring x 3 edges)`);

    // 03: keeper commit_epoch, Σ due = Σ claimable
    const closing = await fx.sandbox.view<ContractAbi.EpochView>(fx.circle.accountId, "get_epoch", { epoch });
    await advance(closing.proposal_deadline);
    expect((await pass()).filter((a) => a.epoch === epoch).map((a) => a.method)).toEqual(["commit_epoch"]);
    const positions = await fx.sandbox.view<Array<{ account_id: string; role: string; amount: string; net: string }>>(fx.circle.accountId, "list_positions", { epoch, from_index: 0, limit: 100 });
    const total = (role: string) => positions.filter((p) => p.role === role).reduce((n, p) => n + BigInt(p.amount), 0n);
    expect(total("debtor")).toBe(total("creditor"));
    // F4: yang harus dibayar lewat jalur residual sama dengan posisi bersih positif dari invoice
    expect(total("debtor")).toBe(netting.settlement);
    step("keeper commit_epoch, list positions (F4 residual)", `debtors owe ${total("debtor")} = creditors claim ${total("creditor")} = net cash ${netting.settlement}`);

    // 04: laporan 207 setelah indexer menyusul
    await catchUp(() => ['payment_window', 'finalized'].includes(phaseOf() ?? ''));
    const report = await fetch(`${base}/epochs/${epoch}`);
    expect(report.status).toBe(207);
    const body = (await report.json()) as { cleared: string; members: Array<{ account: string; status: number; net: string }> };
    expect(BigInt(body.cleared)).toBe(netting.cleared);
    const row = (m: Member) => body.members.find((x) => x.account === m.account.accountId)!;
    expect(row(maker)).toMatchObject({ status: 402, net: "-20000000" });
    expect(row(retailer)).toMatchObject({ status: 402, net: "-20000000" });
    expect(row(supplier)).toMatchObject({ status: 202, net: "+40000000" });
    out("\n== invoice totals");
    for (const line of formatNetting(netting)) out(line);
    out(`contract: obligation ${snapshot.totalObligation}, cleared ${body.cleared}, F4 due ${total("debtor")}; every figure above matches (assertions passed)`);

    // 05: net laporan sama dengan view net_position
    for (const m of members) {
      expect(BigInt((await fx.sandbox.view<{ net: string }>(fx.circle.accountId, "net_position", { epoch, account_id: m.account.accountId })).net)).toBe(netting.net[m.account.accountId]!);
      const position = await fx.sandbox.view<{ net: string }>(fx.circle.accountId, "net_position", { epoch, account_id: m.account.accountId });
      expect(BigInt(position.net)).toBe(BigInt(row(m).net));
    }
  }, 900_000);
});
