// UM-055 dan AG-013 (F5, ADR-38): tiga agent translator -> summarizer -> scraper -> translator memasang intent offer/need, solver menemukan cincin,
// ketiganya menandatangani terms_hash, bundle di-commit, setiap leg dibayar dengan voucher F2 yang membawa bundle_id (SD-048) sampai leg penuh,
// lalu kliring F3 menghapus ketiga leg dan laporan 207 menunjukkan residual nol (status 200) untuk ketiganya. Kontrak, facilitator, indexer,
// read API dan buku marketplace, solver, dan keeper nyata di near-sandbox.
import { execFile } from "node:child_process";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { parseEventLog, termsHash, type ContractAbi } from "@x207/core";
import { FailoverRpcClient, Indexer, RpcBlockSource, createApiServer, openDatabase, rpcChainReader } from "../backend/src/index.ts";
import { viewClearedEdges } from "../backend/src/indexer/view-edges.ts";
import { marketplaceRoutes } from "../backend/src/marketplace/index.ts";
import { collectBundleSignatures, cycleTerms, findIntentCycles, loadOpenIntents } from "../solver/src/barter/index.ts";
import { BarterAgent, BookClient } from "../agents/shared/barter.ts";
import { AGENTS } from "../agents/shared/registry.ts";
import { createAgentBuyer } from "../agents/shared/x207.ts";
import { LEG_AMOUNT, RING_MEMBERS, ringIntents, payLegs } from "../agents/scenario/ring.ts";
import { startStack, type Stack } from "../agents/test/stack.ts";
import { keeperPass } from "../scripts/lib/keeper.mjs";
import { sandboxAvailable } from "../sdk/test-support/sandbox.ts";

const run = promisify(execFile);

describe.skipIf(!sandboxAvailable)("UM-055 barter bundle: three intents, commit, legs during the epoch, F3 clearing", () => {
  let stack: Stack;
  let api: Server | undefined;
  afterAll(async () => {
    api?.closeAllConnections?.();
    api?.close();
    await stack?.stop();
  });

  it("zero residual for A, B, and C after clearing", async () => {
    const clock = { offset: 0 };
    stack = await startStack({ now: () => Date.now() + clock.offset });
    const { fx, identity, urls } = stack;
    const rpcUrl = fx.sandbox.rpcUrl;
    const contract = fx.circle.accountId;
    const keeper = await fx.sandbox.createAccount("keeper", "20");
    const solver = await fx.sandbox.createAccount("solver", "20");

    const db = openDatabase(":memory:");
    const indexer = new Indexer({
      db, source: new RpcBlockSource(rpcChainReader(new FailoverRpcClient({ endpoints: [rpcUrl] })), contract, 1), circleId: "agents-main",
      contractId: contract, startBlock: 1, fetchParams: () => fx.sandbox.view(contract, "get_params", {}) as Promise<ContractAbi.Params>,
      fetchClearedEdges: (epoch) => viewClearedEdges(rpcUrl, contract, epoch),
    });
    await indexer.bootstrap();
    api = createApiServer({ db, extraRoutes: marketplaceRoutes(db) });
    await new Promise<void>((resolve) => api!.listen(0, "127.0.0.1", resolve));
    const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    const base = `${apiUrl}/x207/circles/agents-main`;
    const catchUp = async (done: () => boolean) => {
      for (let i = 0; i < 90; i++) {
        await indexer.drain();
        if (done()) return;
        await new Promise((r) => setTimeout(r, 1_000));
      }
      throw new Error("indexer did not catch up within 90 seconds");
    };
    const count = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);
    await catchUp(() => count("select count(*) as n from members where status = 'active'") >= 6);
    // Catatan: tabel epochs baru terisi saat close_epoch, jadi buku tidak tahu epoch open dan agent tidak memeriksa epoch (openEpoch null).

    // 1. intent: tiga agent memasang offer/need ke buku
    const book = new BookClient({ baseUrl: apiUrl, circleId: "agents-main" });
    const barterAgents = new Map(RING_MEMBERS.map((name) => [name, new BarterAgent({ identity: identity[name], book, contractId: contract })]));
    for (const intent of ringIntents()) {
      const posted = await barterAgents.get(intent.agent)!.postIntent(intent.offer, intent.need);
      expect(posted.view.status).toBe("open");
    }
    const open = await loadOpenIntents({ readApiUrl: apiUrl, circle: "agents-main" });
    expect(open).toHaveLength(3);

    // 2. solver: cincin dan tanda tangan semua peserta atas terms_hash
    const epoch = (await fx.sandbox.view<ContractAbi.EpochView>(contract, "get_epoch", {})).epoch;
    const [cycle] = findIntentCycles(open);
    expect(cycle!.members.map((m) => m.account)).toHaveLength(3);
    const { terms, termsHash: hash } = cycleTerms(cycle!, contract, epoch);
    expect(terms.legs.every((l) => l.max_amount === String(LEG_AMOUNT))).toBe(true);
    const pubkeys = Object.fromEntries(RING_MEMBERS.map((n) => [identity[n].accountId, identity[n].voucherPublicKey]));
    const byAccount = new Map(RING_MEMBERS.map((n) => [identity[n].accountId, barterAgents.get(n)!]));
    const collected = await collectBundleSignatures(terms, pubkeys, async (account) => byAccount.get(account)!.signTerms(terms));
    expect(collected).not.toBeNull();
    expect(termsHash(collected!.terms)).toBe(hash);

    // 3. commit_bundle dari akun solver; bundle_id dari event
    const committed = await fx.sandbox.accountFrom(solver.accountId, solver.secretKey).call(
      {
        receiverId: contract, methodName: "commit_bundle", deposit: 0n, gas: 200_000_000_000_000n,
        args: { bundle: { epoch, legs: terms.legs }, signatures: collected!.signatures.map((s) => ({ account_id: s.account, signature: s.signature })) },
      },
      "EXECUTED_OPTIMISTIC",
    );
    expect(committed.failures).toEqual([]);
    const events = committed.logs.flatMap((l: string) => (parseEventLog(l) ?? []) as Array<Record<string, any> & { event: string }>);
    const bundleId = Number(events.find((e) => e.event === "bundle_committed")!.bundle_id);
    expect(events.find((e) => e.event === "bundle_committed")).toMatchObject({ terms_hash: hash, epoch });
    // facilitator membaca blok final: tunggu bundle terlihat sebelum membayar leg
    for (let i = 0; i < 60 && !(await stack.rpc.view(contract, "get_bundle", { bundle_id: bundleId })); i++) await new Promise((r) => setTimeout(r, 1_000));

    // 4. leg: setiap pembeli membayar penyedia berikutnya dengan voucher membawa bundle_id sampai leg penuh
    const pairs = new Set(terms.legs.map((l) => `${l.payer}>${l.payee}`));
    const bundleFor = (buyer: string) => (payee: string, e: number) => (e === epoch && pairs.has(`${buyer}>${payee}`) ? bundleId : undefined);
    const buyers = Object.fromEntries(RING_MEMBERS.map((n) => [n, createAgentBuyer(identity[n], { rpcUrls: [rpcUrl], bundleFor: bundleFor(identity[n].accountId) })]));
    const cumulative = await payLegs((buyer, seller) => buyers[buyer]!(`${urls[seller]}/api/${AGENTS[seller].verb}?input=halo`));
    expect(Object.values(cumulative).every((v) => v === BigInt(LEG_AMOUNT))).toBe(true);
    expect(stack.settled).toHaveLength(3 * 5);
    expect(await stack.scheduler.tick()).toMatchObject({ registered: 3, dropped: 0, retrying: 0 });
    const stored = await fx.sandbox.view<ContractAbi.BundleView>(contract, "get_bundle", { bundle_id: bundleId });
    expect(stored.legs.map((l) => l.registered)).toEqual(terms.legs.map(() => String(LEG_AMOUNT)));
    for (const leg of terms.legs) {
      const edge = await fx.sandbox.view<{ cumulative: string }>(contract, "obligation", { epoch, debtor: leg.payer, creditor: leg.payee });
      expect(edge.cumulative, `${leg.payer} -> ${leg.payee}`).toBe(String(LEG_AMOUNT));
    }

    // 5. kliring F3: close_epoch, solver, commit_epoch
    const pass = () =>
      keeperPass({
        view: (m: string, a: object) => fx.sandbox.view(contract, m, a),
        chainNowMs: () => fx.sandbox.blockTimestampMs(),
        send: async ({ methodName, args }: { methodName: string; args: object }) => {
          const r = await fx.sandbox.accountFrom(keeper.accountId, keeper.secretKey).call({ receiverId: contract, methodName, args, deposit: 0n, gas: 200_000_000_000_000n }, "EXECUTED_OPTIMISTIC");
          if (r.failures.length > 0) throw new Error(r.failures.join("; "));
          return r.hash;
        },
      }) as Promise<Array<{ method: string; epoch: number }>>;
    const advance = async (ns: string | null | undefined) => {
      await fx.sandbox.advanceTo(Number(BigInt(ns!) / 1_000_000n) + 1_000);
      clock.offset += 61_000;
      await new Promise((r) => setTimeout(r, 3_000));
    };
    const current = await fx.sandbox.view<ContractAbi.EpochView>(contract, "get_epoch", { epoch });
    await advance(current.cutoff_at);
    expect((await pass()).filter((a) => a.epoch === epoch).map((a) => a.method)).toEqual(["close_epoch"]);
    const phaseOf = () => (db.prepare("select phase from epochs where epoch = ?").get(epoch) as { phase: string } | undefined)?.phase;
    await catchUp(() => phaseOf() !== "open");
    const snapshot = (await (await fetch(`${base}/epochs/${epoch}/obligations?stage=cutoff`)).json()) as { edges: unknown[]; totalObligation: string };
    expect(snapshot.edges).toHaveLength(3);
    expect(snapshot.totalObligation).toBe(String(3 * LEG_AMOUNT));

    const { stdout } = await run("node", ["solver/dist/cli.js", "--epoch", String(epoch)], {
      env: { PATH: process.env.PATH, X207_READ_API_URL: apiUrl, X207_CIRCLE_ID: "agents-main", NEAR_RPC_URL: rpcUrl, X207_CONTRACT_ID: contract, SOLVER_ACCOUNT_ID: solver.accountId, SOLVER_PRIVATE_KEY: solver.secretKey },
    });
    const proposal = JSON.parse(stdout.trim().split("\n").at(-1)!) as { edges: Array<{ cleared: string }> };
    expect(proposal.edges.reduce((s, e) => s + BigInt(e.cleared), 0n)).toBe(BigInt(3 * LEG_AMOUNT));
    const closing = await fx.sandbox.view<ContractAbi.EpochView>(contract, "get_epoch", { epoch });
    await advance(closing.proposal_deadline);
    expect((await pass()).filter((a) => a.epoch === epoch).map((a) => a.method)).toEqual(["commit_epoch"]);
    await catchUp(() => ["payment_window", "finalized"].includes(phaseOf() ?? ""));

    // 6. laporan 207: residual nol, status 200 untuk A, B, C; leg terhapus penuh
    const report = await fetch(`${base}/epochs/${epoch}`);
    const body = (await report.json()) as { cleared: string; members: Array<{ account: string; status: number; net: string; settlement: string | null }> };
    expect(BigInt(body.cleared)).toBe(BigInt(3 * LEG_AMOUNT));
    for (const name of RING_MEMBERS) {
      const row = body.members.find((m) => m.account === identity[name].accountId)!;
      expect(row, name).toMatchObject({ status: 200, net: "0" });
    }
    const positions = await fx.sandbox.view<Array<{ amount: string }>>(contract, "list_positions", { epoch, from_index: 0, limit: 100 });
    expect(positions.filter((p) => BigInt(p.amount) > 0n)).toEqual([]);
    console.log(`BARTER ring ${RING_MEMBERS.join(" -> ")}: bundle ${bundleId}, ${3 * LEG_AMOUNT} registered on legs, cleared ${body.cleared}, residual 0 for all three`);
  }, 1_800_000);
});
