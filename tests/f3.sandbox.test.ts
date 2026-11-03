// UM-024: F3 tiga agent translator -> summarizer -> scraper -> translator di near-sandbox dengan indexer, read API,
// solver (dist/cli.js), dan keeper nyata. Obligasi 10, 7, 5 credit; kliring 5 per sisi (15 total).
import { execFile } from "node:child_process";
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { onboardMember, createCircleViewFn, parseEventLog, signVoucher, type ContractAbi, type ContractCall } from "@x207/core";
import { Indexer, RpcBlockSource, createApiServer, FailoverRpcClient, openDatabase, rpcChainReader } from "../backend/src/index.ts";
import { keeperPass } from "../scripts/lib/keeper.mjs";
import { TERMS_HASH, deployCircle, type CircleFixture } from "../sdk/test-support/circle.ts";
import { sandboxAvailable, type SandboxAccount } from "../sdk/test-support/sandbox.ts";

const run = promisify(execFile);
type Member = { account: SandboxAccount; secretKey: `ed25519:${string}` };

describe.skipIf(!sandboxAvailable)("UM-024 F3 three agents with a real indexer and solver", () => {
  let fx: CircleFixture;
  let api: Server | undefined;
  afterAll(async () => {
    api?.close();
    await fx?.stop();
  });

  it("TC-UM-024-01..05", async () => {
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
        { circleContract: fx.circle.accountId, circleId: fx.circleId, accountId: account.accountId, termsHash: TERMS_HASH, stakeAmount: "50000000", usdtTokenId: fx.usdt.accountId },
      );
      return { account, secretKey: joined.secretKey };
    };
    const [t, s, c] = [await join("translator"), await join("summarizer"), await join("scraper")];
    const first = await fx.sandbox.view<ContractAbi.EpochView>(fx.circle.accountId, "get_epoch", {});
    const epoch = first.epoch;

    // FX-05: obligasi lewat voucher
    const pay = async (from: Member, to: Member, cumulative: string) => {
      const { signature, ...voucher } = signVoucher(
        { circle: fx.circle.accountId, payer: from.account.accountId, payee: to.account.accountId, epoch, seq: 1, cumulativeAmount: cumulative, unit: "credit", resource: "https://seller.example/api" },
        from.secretKey,
      );
      const r = await from.account.call({ receiverId: fx.circle.accountId, methodName: "register_cumulative", args: { voucher, signature }, deposit: 0n, gas: 100_000_000_000_000n }, "EXECUTED_OPTIMISTIC");
      expect(r.failures).toEqual([]);
    };
    await pay(t, s, "10000000");
    await pay(s, c, "7000000");
    await pay(c, t, "5000000");

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

    // 01: tiga edge, edgeCount dan totalObligation sama dengan event epoch_cutoff
    const snapshot = (await (await fetch(`${base}/epochs/${epoch}/obligations?stage=cutoff`)).json()) as { edgeCount: number; totalObligation: string; edges: unknown[] };
    expect(snapshot.edges).toHaveLength(3);
    expect(snapshot.edgeCount).toBe(Number(cutoff.edge_count));
    expect(snapshot.totalObligation).toBe(cutoff.total_obligation);

    // 02: solver nyata membaca snapshot dan mengirim submit_clearing
    const solver = await fx.sandbox.createAccount("solver", "20");
    const { stdout } = await run("node", ["solver/dist/cli.js", "--epoch", String(epoch)], {
      env: {
        PATH: process.env.PATH, X207_READ_API_URL: apiUrl, X207_CIRCLE_ID: "agents-main", NEAR_RPC_URL: rpcUrl,
        X207_CONTRACT_ID: fx.circle.accountId, SOLVER_ACCOUNT_ID: solver.accountId, SOLVER_PRIVATE_KEY: solver.secretKey,
      },
    });
    const proposal = JSON.parse(stdout.trim().split("\n").at(-1)!) as { edges: Array<{ cleared: string }> };
    expect(proposal.edges.reduce((sum, e) => sum + BigInt(e.cleared), 0n)).toBe(15_000_000n);
    const stored = await fx.sandbox.view<{ cleared_total: string }>(fx.circle.accountId, "get_clearing_proposal", { epoch });
    expect(stored.cleared_total).toBe("15000000");

    // 03: keeper commit_epoch, Σ due = Σ claimable
    const closing = await fx.sandbox.view<ContractAbi.EpochView>(fx.circle.accountId, "get_epoch", { epoch });
    await advance(closing.proposal_deadline);
    expect((await pass()).filter((a) => a.epoch === epoch).map((a) => a.method)).toEqual(["commit_epoch"]);
    const positions = await fx.sandbox.view<Array<{ account_id: string; role: string; amount: string; net: string }>>(fx.circle.accountId, "list_positions", { epoch, from_index: 0, limit: 100 });
    const total = (role: string) => positions.filter((p) => p.role === role).reduce((n, p) => n + BigInt(p.amount), 0n);
    expect(total("debtor")).toBe(total("creditor"));

    // 04: laporan 207 setelah indexer menyusul
    await catchUp(() => ['payment_window', 'finalized'].includes(phaseOf() ?? ''));
    const report = await fetch(`${base}/epochs/${epoch}`);
    expect(report.status).toBe(207);
    const body = (await report.json()) as { cleared: string; members: Array<{ account: string; status: number; net: string }> };
    expect(body.cleared).toBe("15000000");
    const row = (m: Member) => body.members.find((x) => x.account === m.account.accountId)!;
    expect(row(t)).toMatchObject({ status: 402, net: "-5000000" });
    expect(row(s)).toMatchObject({ status: 202, net: "+3000000" });
    expect(row(c)).toMatchObject({ status: 202, net: "+2000000" });

    // 05: net laporan sama dengan view net_position
    for (const m of [t, s, c]) {
      const position = await fx.sandbox.view<{ net: string }>(fx.circle.accountId, "net_position", { epoch, account_id: m.account.accountId });
      expect(BigInt(position.net)).toBe(BigInt(row(m).net));
    }
  }, 900_000);
});
