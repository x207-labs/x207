// AG-032 (track Swarms): six agents buy services from each other for several epochs of chain time on near-sandbox, and the circle clears every epoch by itself.
//   npm run demo:swarm        (downloads the release wasm and the sandbox like demo:quick, so it needs no Rust; about 4 minutes of wall clock)
// The only thing this script does is what the agents do: sign vouchers and register them. The keeper pass (close_epoch, commit_epoch, finalize_epoch) and the real solver
// (solver/dist/cli.js, submit_clearing) run in an autopilot loop that looks at the phase of the contract and nothing else. After the run the script prints one line per epoch
// (vouchers, obligation, cleared ratio, residual) and checks that at least three epochs in a row were cleared.
// Knobs: SWARM_EPOCHS (default 4), SWARM_EPOCH_SECONDS (default 300, the chain time of one epoch; 300 s is the shortest epoch the contract accepts, so 4 epochs are 20 minutes of chain time).
import { execFile } from "node:child_process";
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:http";
import { promisify } from "node:util";
import { writeSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { onboardMember, createCircleViewFn, signVoucher, type ContractAbi, type ContractCall } from "@x207/core";
import { Indexer, RpcBlockSource, createApiServer, FailoverRpcClient, openDatabase, rpcChainReader } from "../backend/src/index.ts";
import { viewClearedEdges } from "../backend/src/indexer/view-edges.ts";
import { keeperPass } from "../scripts/lib/keeper.mjs";
import { SHORT_PARAMS, TERMS_HASH, deployCircle, type CircleFixture } from "../sdk/test-support/circle.ts";
import { type SandboxAccount } from "../sdk/test-support/sandbox.ts";
import { AGENT_NAMES, AGENTS, type AgentName } from "../agents/shared/registry.ts";

const run = promisify(execFile);
const CREDIT = 1_000_000n;
const EPOCHS = Number(process.env.SWARM_EPOCHS ?? 4);
const EPOCH_SECONDS = Number(process.env.SWARM_EPOCH_SECONDS ?? 300);
type Member = { name: AgentName; account: SandboxAccount; secretKey: `ed25519:${string}` };
type Row = { epoch: number; vouchers: number; obligation: bigint; cleared: bigint; due: bigint; ratio: string; phase: string };

/** Who buys what in epoch `e`: every agent buys from the next one and from the one after next, and the odd ones also buy from the one three places on, so debts form cycles of different sizes. */
export function trafficFor(e: number): Array<{ buyer: AgentName; seller: AgentName; credit: number }> {
  const n = AGENT_NAMES.length;
  const rows: Array<{ buyer: AgentName; seller: AgentName; credit: number }> = [];
  for (let i = 0; i < n; i++) {
    rows.push({ buyer: AGENT_NAMES[i]!, seller: AGENT_NAMES[(i + 1) % n]!, credit: 10 + ((3 * i + e) % 7) });
    rows.push({ buyer: AGENT_NAMES[i]!, seller: AGENT_NAMES[(i + 2) % n]!, credit: 3 + ((i + 2 * e) % 4) });
    if (i % 2 === 1) rows.push({ buyer: AGENT_NAMES[i]!, seller: AGENT_NAMES[(i + 3) % n]!, credit: 4 + (e % 3) });
  }
  return rows;
}

describe("demo swarm: six agents trade, the circle clears epoch after epoch", () => {
  let fx: CircleFixture;
  let api: Server | undefined;
  afterAll(async () => {
    api?.close();
    await fx?.stop();
  });

  it("clears every epoch without anybody stepping in", async () => {
    const out = (line: string) => writeSync(1, `${line}\n`);
    fx = await deployCircle({ ...SHORT_PARAMS, epoch_length: EPOCH_SECONDS });
    const rpcUrl = fx.sandbox.rpcUrl;
    const circle = fx.circle.accountId;
    const startBlock = (await (await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "status", params: [] }) })).json() as any).result.sync_info.latest_block_height as number;
    const view = createCircleViewFn({ circleContract: circle, rpcUrls: [rpcUrl] });
    const members = new Map<AgentName, Member>();
    for (const name of AGENT_NAMES) {
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
        { circleContract: circle, circleId: fx.circleId, accountId: account.accountId, termsHash: TERMS_HASH, stakeAmount: "150000000", usdtTokenId: fx.usdt.accountId },
      );
      members.set(name, { name, account, secretKey: joined.secretKey });
    }
    out(`\n== swarm: ${AGENT_NAMES.length} agents (${AGENT_NAMES.join(", ")}) joined with a stake of 150 credit each; epochs of ${EPOCH_SECONDS} s of chain time, ${EPOCHS} epochs`);

    // Read side for the solver: the real indexer and the read API on the sandbox.
    const db = openDatabase(":memory:");
    const client = new FailoverRpcClient({ endpoints: [rpcUrl] });
    const indexer = new Indexer({
      db, source: new RpcBlockSource(rpcChainReader(client), circle, startBlock), circleId: "agents-main", contractId: circle, startBlock,
      fetchParams: () => fx.sandbox.view(circle, "get_params", {}) as Promise<ContractAbi.Params>,
      fetchClearedEdges: (epoch) => viewClearedEdges(rpcUrl, circle, epoch),
    });
    await indexer.bootstrap();
    const catchUp = async (done: () => boolean) => {
      for (let i = 0; i < 60; i++) {
        await indexer.drain();
        if (done()) return;
        await new Promise((r) => setTimeout(r, 1_000));
      }
      throw new Error("indexer did not catch up within 60 seconds");
    };
    const phaseInDb = (epoch: number) => (db.prepare("select phase from epochs where epoch = ?").get(epoch) as { phase: string } | undefined)?.phase;
    api = createApiServer({ db });
    await new Promise<void>((resolve) => api!.listen(0, "127.0.0.1", resolve));
    const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;

    const keeper = await fx.sandbox.createAccount("keeper", "20");
    const solver = await fx.sandbox.createAccount("solver", "20");
    const keeperActions: Array<{ method: string; epoch: number }> = [];
    const pass = async () => {
      const done = (await keeperPass({
        view: (m: string, a: object) => fx.sandbox.view(circle, m, a),
        chainNowMs: () => fx.sandbox.blockTimestampMs(), lookback: EPOCHS + 1,
        send: async ({ methodName, args }: { methodName: string; args: object }) => {
          const r = await fx.sandbox.accountFrom(keeper.accountId, keeper.secretKey).call({ receiverId: circle, methodName, args, deposit: 0n, gas: 200_000_000_000_000n }, "EXECUTED_OPTIMISTIC");
          if (r.failures.length > 0) throw new Error(r.failures.join("; "));
          return r.hash;
        },
      })) as Array<{ method: string; epoch: number }>;
      keeperActions.push(...done);
      return done;
    };
    const solved = new Set<number>();
    const solve = async (epoch: number) => {
      await catchUp(() => phaseInDb(epoch) !== undefined && phaseInDb(epoch) !== "open");
      await run("node", ["solver/dist/cli.js", "--epoch", String(epoch)], {
        env: { PATH: process.env.PATH, X207_READ_API_URL: apiUrl, X207_CIRCLE_ID: "agents-main", NEAR_RPC_URL: rpcUrl, X207_CONTRACT_ID: circle, SOLVER_ACCOUNT_ID: solver.accountId, SOLVER_PRIVATE_KEY: solver.secretKey },
      });
      solved.add(epoch);
    };
    const advance = async (ns: string | null | undefined) => {
      await fx.sandbox.advanceTo(Number(BigInt(ns!) / 1_000_000n) + 1_000);
      await new Promise((r) => setTimeout(r, 2_000));
    };

    // The agents: in each epoch every agent signs one cumulative voucher per service it bought and registers it itself (F2).
    const buy = async (epoch: number, e: number): Promise<number> => {
      const seq = new Map<string, number>();
      let count = 0;
      for (const t of trafficFor(e)) {
        const buyer = members.get(t.buyer)!;
        const seller = members.get(t.seller)!;
        const key = `${t.buyer}>${t.seller}`;
        const next = (seq.get(key) ?? 0) + 1;
        seq.set(key, next);
        const { signature, ...voucher } = signVoucher(
          { circle, payer: buyer.account.accountId, payee: seller.account.accountId, epoch, seq: next, cumulativeAmount: (BigInt(t.credit) * CREDIT).toString(), unit: "credit", resource: `x207:service:${AGENTS[t.seller].verb}` },
          buyer.secretKey,
        );
        const r = await buyer.account.call({ receiverId: circle, methodName: "register_cumulative", args: { voucher, signature }, deposit: 0n, gas: 100_000_000_000_000n }, "EXECUTED_OPTIMISTIC");
        expect(r.failures).toEqual([]);
        count += 1;
      }
      return count;
    };

    // Autopilot: look at the contract and do what the phase asks, nothing else. One round per epoch.
    const rows: Row[] = [];
    const chainStartMs = await fx.sandbox.blockTimestampMs();
    const first = await fx.sandbox.view<ContractAbi.EpochView>(circle, "get_epoch", {});
    let epoch = first.epoch;
    const firstEpoch = epoch;
    let vouchers = await buy(epoch, 0);
    for (let e = 0; e < EPOCHS; e++) {
      const info = await fx.sandbox.view<ContractAbi.EpochView>(circle, "get_epoch", { epoch });
      await advance(info.cutoff_at);
      await pass(); // close_epoch: the next epoch opens
      const next = (await fx.sandbox.view<ContractAbi.EpochView>(circle, "get_epoch", {})).epoch;
      const nextVouchers = e + 1 < EPOCHS ? await buy(next, e + 1) : 0; // the agents keep trading in the new epoch while the old one is cleared
      await solve(epoch);
      const closing = await fx.sandbox.view<ContractAbi.EpochView>(circle, "get_epoch", { epoch });
      await advance(closing.proposal_deadline);
      await pass(); // commit_epoch
      const done = await fx.sandbox.view<ContractAbi.EpochView>(circle, "get_epoch", { epoch });
      const positions = await fx.sandbox.view<Array<{ role: string; amount: string }>>(circle, "list_positions", { epoch, from_index: 0, limit: 200 });
      const due = positions.filter((p) => p.role === "debtor").reduce((n, p) => n + BigInt(p.amount), 0n);
      const obligation = BigInt(done.total_obligation);
      const cleared = BigInt(done.total_cleared);
      const row: Row = { epoch, vouchers, obligation, cleared, due, ratio: obligation === 0n ? "0" : (Number((cleared * 10_000n) / obligation) / 10_000).toFixed(3), phase: done.phase };
      rows.push(row);
      out(`epoch ${epoch}: ${vouchers} vouchers, obligation ${Number(obligation) / 1e6}, cleared ${Number(cleared) / 1e6} (ratio ${row.ratio}), residual ${Number(due) / 1e6} credit, phase ${done.phase}`);
      epoch = next;
      vouchers = nextVouchers;
    }

    // The payment window of the last epochs: the debtors pay their residual, the keeper finalizes.
    const last = await fx.sandbox.view<ContractAbi.EpochView>(circle, "get_epoch", { epoch: rows.at(-1)!.epoch });
    await advance(last.payment_deadline);
    await pass();

    out("\n== per epoch (credit)");
    out("epoch  vouchers  obligation  cleared  ratio   residual");
    for (const r of rows) out(`${String(r.epoch).padStart(5)}  ${String(r.vouchers).padStart(8)}  ${String(Number(r.obligation) / 1e6).padStart(10)}  ${String(Number(r.cleared) / 1e6).padStart(7)}  ${r.ratio.padStart(5)}  ${String(Number(r.due) / 1e6).padStart(8)}`);
    const clearedRun = rows.filter((r) => r.cleared > 0n && r.phase !== "open");
    out(`keeper actions without a human: ${keeperActions.map((a) => `${a.method}(${a.epoch})`).join(" ")}`);
    out(`solver proposals: epochs ${[...solved].join(", ")}; chain time of the run ${Math.round(((await fx.sandbox.blockTimestampMs()) - chainStartMs) / 60_000)} minutes`);

    expect(rows.length).toBe(EPOCHS);
    expect(clearedRun.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.epoch).toBe(rows[i - 1]!.epoch + 1);
    for (const r of rows) expect(r.due).toBeLessThanOrEqual(r.obligation - r.cleared);
  }, 1_800_000);
});
