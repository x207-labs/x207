// UM-032: demo end-to-end satu epoch di near-sandbox. Satu perintah dari akar payung:
//   npm run demo:sandbox            (variabel opsional: DEMO_PAYMENTS=120, DEMO_DENSITY=low|medium|high|star)
// Tahap: F1 join + stake enam agent, 402 dengan entri x207 dan exact (UM-033), F2 pembayaran voucher, F3 close/submit/commit
// dengan laporan 207, F4 pelunasan residual/finalize/claim, lalu metrik dari data epoch (UM-034). Log ditulis ke .demo/.
// Mode mainnet tidak ada di skrip ini (UM-026, UM-040 menunggu pemilik); target mainnet tidak dijalankan.
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync, writeSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { promisify } from "node:util";
import { afterAll, describe, it } from "vitest";
import { buildClaimCall, buildSettleTransferCall, parseEventLog, type ContractAbi } from "@x207/core";
import { FailoverRpcClient, Indexer, RpcBlockSource, createApiServer, openDatabase, rpcChainReader } from "../backend/src/index.ts";
import { DENSITIES, planDensity, type Density } from "../agents/scenario/density.ts";
import { AGENT_NAMES, AGENTS } from "../agents/shared/registry.ts";
import { createAgentBuyer } from "../agents/shared/x207.ts";
import { startStack, type Stack } from "../agents/test/stack.ts";
import { keeperPass } from "../scripts/lib/keeper.mjs";
import { SHORT_PARAMS } from "../sdk/test-support/circle.ts";

const run = promisify(execFile);
const decode = (header: string | null) => JSON.parse(Buffer.from(header!, "base64").toString("utf8"));

describe("demo near-sandbox", () => {
  let stack: Stack | undefined;
  let api: Server | undefined;
  afterAll(async () => {
    api?.close();
    await stack?.stop();
  });

  it("satu siklus epoch", async () => {
    const lines: string[] = [];
    const out = (line: string) => {
      lines.push(line);
      writeSync(1, `${line}\n`);
    };
    const stages: Array<{ stage: string; ms: number }> = [];
    const timed = async <T>(stage: string, work: () => Promise<T>): Promise<T> => {
      const t0 = Date.now();
      out(`\n== ${stage}`);
      const result = await work();
      stages.push({ stage, ms: Date.now() - t0 });
      out(`   selesai dalam ${Date.now() - t0} ms`);
      return result;
    };
    const tx = (label: string, hash: string, ms: number) => out(`   tx ${label} ${hash} (${ms} ms)`);

    const density = (process.env.DEMO_DENSITY ?? "medium") as Density;
    if (!DENSITIES.includes(density)) throw new Error(`DEMO_DENSITY harus salah satu dari ${DENSITIES.join(", ")}`);
    const payments = Number(process.env.DEMO_PAYMENTS ?? 120);
    const observed = new Set<string>();

    const clock = { offset: 0 };
    stack = await timed("F1 onboarding: join + stake enam agent (E3)", async () =>
      startStack({
        now: () => Date.now() + clock.offset,
        onTx: (t) => {
          if (t.method === "join" || t.method === "ft_transfer_call") {
            observed.add("E3");
            tx(`${t.account.split(".")[0]}.${t.method}`, t.hash, t.ms);
          }
        },
      }),
    );
    const { fx, identity, urls } = stack;
    const rpcUrl = fx.sandbox.rpcUrl;
    const keeper = await fx.sandbox.createAccount("keeper", "20");
    const solver = await fx.sandbox.createAccount("solver", "20");
    const dao = await fx.sandbox.createAccount("dao", "5");

    const db = openDatabase(":memory:");
    const indexer = new Indexer({
      db, source: new RpcBlockSource(rpcChainReader(new FailoverRpcClient({ endpoints: [rpcUrl] })), fx.circle.accountId, 1),
      circleId: "agents-main", contractId: fx.circle.accountId, startBlock: 1,
      fetchParams: () => fx.sandbox.view(fx.circle.accountId, "get_params", {}) as Promise<ContractAbi.Params>,
    });
    await indexer.bootstrap();
    api = createApiServer({ db });
    await new Promise<void>((resolve) => api!.listen(0, "127.0.0.1", resolve));
    const readApi = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    const base = `${readApi}/x207/circles/agents-main`;
    const phaseOf = (epoch: number) => (db.prepare("select phase from epochs where epoch = ?").get(epoch) as { phase: string } | undefined)?.phase;
    const catchUp = async (done: () => boolean) => {
      for (let i = 0; i < 90; i++) {
        await indexer.drain();
        if (done()) return;
        await new Promise((r) => setTimeout(r, 1_000));
      }
      throw new Error("indexer tidak menyusul dalam 90 detik");
    };
    const events: Array<Record<string, any> & { event: string }> = [];
    const send = async (label: string, who: { accountId: string; secretKey: string }, call: Parameters<typeof fx.circle.call>[0]) => {
      const t0 = Date.now();
      const r = await fx.sandbox.accountFrom(who.accountId, who.secretKey).call(call, "EXECUTED_OPTIMISTIC");
      if (r.failures.length > 0) throw new Error(`${label}: ${r.failures.join("; ")}`);
      for (const line of r.logs) events.push(...((parseEventLog(line) ?? []) as typeof events));
      tx(label, r.hash, Date.now() - t0);
      return r;
    };
    const pass = () =>
      keeperPass({
        view: (m: string, a: object) => fx.sandbox.view(fx.circle.accountId, m, a),
        chainNowMs: () => fx.sandbox.blockTimestampMs(),
        send: async ({ methodName, args }: { methodName: string; args: object }) => {
          const r = await send(`keeper.${methodName}`, keeper, { receiverId: fx.circle.accountId, methodName, args, deposit: 0n, gas: 200_000_000_000_000n });
          return r.hash;
        },
      }) as Promise<Array<{ method: string; epoch: number }>>;
    const advance = async (ns: string | null | undefined) => {
      await fx.sandbox.advanceTo(Number(BigInt(ns!) / 1_000_000n) + 1_000);
      clock.offset += 61_000;
      await new Promise((r) => setTimeout(r, 3_000));
    };

    const current = await fx.sandbox.view<ContractAbi.EpochView>(fx.circle.accountId, "get_epoch", {});
    const epoch = current.epoch;

    await timed("F2 pembayaran voucher antar agent (E1, E2)", async () => {
      const challenge = await fetch(`${urls.summarizer}/api/summarize?input=halo`);
      const required = decode(challenge.headers.get("PAYMENT-REQUIRED"));
      out(`   402 accepts: ${required.accepts.map((a: { scheme: string; network: string }) => `${a.scheme}@${a.network}`).join(" + ")}`);
      if (challenge.status === 402) observed.add("E2");
      const buyers = Object.fromEntries(AGENT_NAMES.map((n) => [n, createAgentBuyer(identity[n], { rpcUrls: [rpcUrl] })]));
      const plan = planDensity(density, payments, Number(process.env.DEMO_SEED ?? 20261102));
      for (const { buyer, seller } of plan) {
        const response = await buyers[buyer]!(`${urls[seller]}/api/${AGENTS[seller].verb}?input=halo`);
        if (response.status !== 200) throw new Error(`${buyer} -> ${seller}: HTTP ${response.status}`);
        observed.add("E1");
      }
      out(`   ${plan.length} panggilan berbayar (${density}), ${new Set(plan.map((p) => `${p.buyer}>${p.seller}`)).size} pasangan`);
      const ticked = await stack!.scheduler.tick();
      out(`   registrasi on-chain: ${ticked.registered} pasangan`);
    });

    // E5: pemilik (dao) menjadwalkan params untuk epoch berikutnya.
    await send("dao.set_params", { accountId: dao.accountId, secretKey: dao.secretKey }, { receiverId: fx.circle.accountId, methodName: "set_params", args: { params: { ...SHORT_PARAMS, limit_cap: "900000000" } }, deposit: 0n });
    observed.add("E5");

    let report: any;
    await timed("F3 kliring: close_epoch, submit_clearing, commit_epoch, laporan 207 (E4)", async () => {
      await advance(current.cutoff_at);
      await pass();
      await catchUp(() => phaseOf(epoch) !== "open");
      const { stdout, stderr } = await run("node", ["solver/dist/cli.js", "--epoch", String(epoch)], {
        env: {
          PATH: process.env.PATH, X207_READ_API_URL: readApi, X207_CIRCLE_ID: "agents-main", NEAR_RPC_URL: rpcUrl,
          X207_CONTRACT_ID: fx.circle.accountId, SOLVER_ACCOUNT_ID: solver.accountId, SOLVER_PRIVATE_KEY: solver.secretKey,
        },
      });
      const hash = /tx[ =:]+([A-Za-z0-9]{40,})/.exec(stderr)?.[1];
      out(`   solver: ${stdout.trim() ? "proposal dikirim" : "tidak ada yang dikliring"}${hash ? ` tx ${hash}` : ""}`);
      if (stdout.trim()) observed.add("E4");
      const closing = await fx.sandbox.view<ContractAbi.EpochView>(fx.circle.accountId, "get_epoch", { epoch });
      await advance(closing.proposal_deadline);
      await pass();
      await catchUp(() => ["payment_window", "finalized"].includes(phaseOf(epoch) ?? ""));
      const response = await fetch(`${base}/epochs/${epoch}`);
      report = await response.json();
      out(`   laporan 207 (HTTP ${response.status}): cleared=${report.cleared}`);
      for (const m of report.members ?? []) out(`     ${m.account} status=${m.status} net=${m.net}`);
    });

    await timed("F4 settlement residual: bayar, finalize_epoch, claim", async () => {
      const positions = await fx.sandbox.view<Array<{ account_id: string; role: string; amount: string; status: string }>>(fx.circle.accountId, "list_positions", { epoch, from_index: 0, limit: 100 });
      for (const name of AGENT_NAMES) {
        const position = positions.find((p) => p.account_id === identity[name].accountId && p.role === "debtor" && p.status === "due");
        if (!position) continue;
        const account = fx.members.get(name)!;
        await send(`${name}.settle`, account, buildSettleTransferCall({ circleContract: fx.circle.accountId, amount: position.amount, epoch, usdtTokenId: fx.usdt.accountId }));
      }
      const paying = await fx.sandbox.view<ContractAbi.EpochView>(fx.circle.accountId, "get_epoch", { epoch });
      await advance(paying.payment_deadline);
      await pass();
      for (const name of AGENT_NAMES) {
        const position = positions.find((p) => p.account_id === identity[name].accountId && p.role === "creditor");
        if (!position) continue;
        await send(`${name}.claim`, fx.members.get(name)!, buildClaimCall({ circleContract: fx.circle.accountId, epoch, destination: "near" }));
      }
      await catchUp(() => phaseOf(epoch) === "finalized");
    });

    // Metrik dari data epoch nyata (UM-034): tidak ada angka tetap di skrip.
    const metrics = await (await fetch(`${base}/epochs/${epoch}/metrics`)).json();
    out("\n== Metrik epoch");
    out(`   pembayaran berbayar (voucher): ${metrics.voucherCount}`);
    const clearingTxs = (db.prepare("select count(distinct tx_hash) as n from events_raw where event = 'clearing_submitted'").get() as { n: number }).n;
    out(`   transaksi kliring: ${clearingTxs}`);
    out(`   pembayaran residual: ${metrics.residualTransfers}`);
    out(`   cleared ratio: ${metrics.clearedRatio}`);
    out(`   penghematan transfer: ${metrics.transferSavings}`);
    out(`   ${metrics.voucherCount} pembayaran jadi ${metrics.residualTransfers}`);

    observed.add("E6-belum");
    out("\n== Aliran Level 0 yang teramati");
    for (const flow of ["E1", "E2", "E3", "E4", "E5"]) out(`   [${observed.has(flow) ? "x" : " "}] ${flow}`);
    out("   [ ] E6 NEAR Intents/1Click: tidak teramati di mode sandbox (UM-035, mainnet)");

    mkdirSync(".demo", { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    writeFileSync(`.demo/demo-${stamp}.log`, lines.join("\n") + "\n");
    writeFileSync(`.demo/demo-${stamp}.json`, JSON.stringify({ epoch, density, payments, stages, observed: [...observed], metrics }, null, 2));
    out(`\nlog: .demo/demo-${stamp}.log`);
  });
});
