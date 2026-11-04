// AG-009 TC-04 and AG-010: dense scenario of six agents per density level, one epoch per level, then the real solver,
// keeper, and backend metrics. The "medium" level uses 300 payments (the AG-009 base scenario).
import { execFile } from "node:child_process";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { parseEventLog, type ContractAbi } from "@x207/core";
import { FailoverRpcClient, Indexer, RpcBlockSource, createApiServer, openDatabase, rpcChainReader } from "../backend/src/index.ts";
import { viewClearedEdges } from "../backend/src/indexer/view-edges.ts";
import { DENSITIES, planDensity, summarize, type Density } from "../agents/scenario/density.ts";
import { AGENT_NAMES, AGENTS } from "../agents/shared/registry.ts";
import { createAgentBuyer } from "../agents/shared/x207.ts";
import { startStack, type Stack } from "../agents/test/stack.ts";
import { keeperPass } from "../scripts/lib/keeper.mjs";
import { sandboxAvailable } from "../sdk/test-support/sandbox.ts";

const run = promisify(execFile);

describe.skipIf(!sandboxAvailable)("AG-010 density variation and AG-009 TC-04", () => {
  let stack: Stack;
  let api: Server | undefined;
  afterAll(async () => {
    api?.close();
    await stack?.stop();
  });

  it("cleared ratio per level equals the backend metric; star is near zero; high is above low", async () => {
    const clock = { offset: 0 };
    stack = await startStack({ now: () => Date.now() + clock.offset });
    const { fx, identity, urls } = stack;
    const rpcUrl = fx.sandbox.rpcUrl;
    const buyers = Object.fromEntries(AGENT_NAMES.map((n) => [n, createAgentBuyer(identity[n], { rpcUrls: [rpcUrl] })]));
    const keeper = await fx.sandbox.createAccount("keeper", "20");
    const solver = await fx.sandbox.createAccount("solver", "20");

    const db = openDatabase(":memory:");
    const indexer = new Indexer({
      db, source: new RpcBlockSource(rpcChainReader(new FailoverRpcClient({ endpoints: [rpcUrl] })), fx.circle.accountId, 1),
      circleId: "agents-main", contractId: fx.circle.accountId, startBlock: 1,
      fetchParams: () => fx.sandbox.view(fx.circle.accountId, "get_params", {}) as Promise<ContractAbi.Params>,
      fetchClearedEdges: (epoch) => viewClearedEdges(rpcUrl, fx.circle.accountId, epoch),
    });
    await indexer.bootstrap();
    api = createApiServer({ db });
    await new Promise<void>((resolve) => api!.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(api.address() as AddressInfo).port}/x207/circles/agents-main`;
    const phaseOf = (epoch: number) => (db.prepare("select phase from epochs where epoch = ?").get(epoch) as { phase: string } | undefined)?.phase;
    const catchUp = async (done: () => boolean) => {
      for (let i = 0; i < 90; i++) {
        await indexer.drain();
        if (done()) return;
        await new Promise((r) => setTimeout(r, 1_000));
      }
      throw new Error("indexer did not catch up within 90 seconds");
    };
    const pass = () =>
      keeperPass({
        view: (m: string, a: object) => fx.sandbox.view(fx.circle.accountId, m, a),
        chainNowMs: () => fx.sandbox.blockTimestampMs(),
        send: async ({ methodName, args }: { methodName: string; args: object }) => {
          const r = await fx.sandbox.accountFrom(keeper.accountId, keeper.secretKey).call(
            { receiverId: fx.circle.accountId, methodName, args, deposit: 0n, gas: 200_000_000_000_000n }, "EXECUTED_OPTIMISTIC",
          );
          if (r.failures.length > 0) throw new Error(r.failures.join("; "));
          return r.hash;
        },
      }) as Promise<Array<{ method: string; epoch: number }>>;
    const advance = async (ns: string | null | undefined) => {
      await fx.sandbox.advanceTo(Number(BigInt(ns!) / 1_000_000n) + 1_000);
      clock.offset += 61_000;
      await new Promise((r) => setTimeout(r, 3_000));
    };

    const results = new Map<Density, { local: ReturnType<typeof summarize>; metrics: any }>();
    for (const level of DENSITIES) {
      const current = await fx.sandbox.view<ContractAbi.EpochView>(fx.circle.accountId, "get_epoch", {});
      const epoch = current.epoch;
      const plan = planDensity(level, level === "medium" ? 300 : 40, 20261102 + epoch);
      for (const { buyer, seller } of plan) {
        const response = await buyers[buyer]!(`${urls[seller]}/api/${AGENTS[seller].verb}?input=halo`);
        if (response.status !== 200) throw new Error(`${level} ${buyer} -> ${seller}: HTTP ${response.status} ${await response.text()}`);
      }
      expect(await stack.scheduler.tick()).toMatchObject({ dropped: 0, retrying: 0 });

      await advance(current.cutoff_at);
      expect((await pass()).filter((a) => a.epoch === epoch).map((a) => a.method)).toEqual(["close_epoch"]);
      await catchUp(() => phaseOf(epoch) !== "open");

      const snapshot = (await (await fetch(`${base}/epochs/${epoch}/obligations?stage=cutoff`)).json()) as { edges: Array<{ debtor: string; creditor: string; amount: string }> };
      const { stdout } = await run("node", ["solver/dist/cli.js", "--epoch", String(epoch)], {
        env: {
          PATH: process.env.PATH, X207_READ_API_URL: base.replace("/x207/circles/agents-main", ""), X207_CIRCLE_ID: "agents-main",
          NEAR_RPC_URL: rpcUrl, X207_CONTRACT_ID: fx.circle.accountId, SOLVER_ACCOUNT_ID: solver.accountId, SOLVER_PRIVATE_KEY: solver.secretKey,
        },
      });
      const line = stdout.trim().split("\n").at(-1);
      const cleared = line ? (JSON.parse(line) as { edges: Array<{ cleared: string }> }).edges.reduce((s, e) => s + BigInt(e.cleared), 0n) : 0n;

      const closing = await fx.sandbox.view<ContractAbi.EpochView>(fx.circle.accountId, "get_epoch", { epoch });
      await advance(closing.proposal_deadline);
      expect((await pass()).filter((a) => a.epoch === epoch).map((a) => a.method)).toEqual(["commit_epoch"]);
      await catchUp(() => ["payment_window", "finalized"].includes(phaseOf(epoch) ?? ""));

      const metrics = await (await fetch(`${base}/epochs/${epoch}/metrics`)).json();
      const local = summarize(snapshot.edges, cleared);
      results.set(level, { local, metrics });
      // TC-AG-010-02: the script summary equals the backend metrics
      expect(metrics.clearedRatio, level).toBe(local.clearedRatio === 0 ? 0 : local.clearedRatio);
      expect(metrics.graph.density, level).toBe(local.density);
      console.log(`DENSITY ${level} cleared_ratio=${local.clearedRatio} density=${local.density} transfer_savings=${metrics.transferSavings}`);
    }

    // TC-AG-009-04: medium level (300 payments) gives cleared > 0
    expect(BigInt(results.get("medium")!.metrics.cleared)).toBeGreaterThan(0n);
    // TC-AG-010-03
    const ratio = (l: Density) => results.get(l)!.local.clearedRatio ?? 0;
    expect(ratio("star")).toBeLessThan(0.01);
    expect(ratio("high")).toBeGreaterThan(ratio("low"));
  }, 1_800_000);
});
