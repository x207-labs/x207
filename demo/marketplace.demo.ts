// UM-067 marketplace block (F9, ADR-38): a listing waits two hours and is then negotiated, a quick barter with a seeker (pay path and barter
// path), and a three-intent ring from the solver, all paid through bundle legs and then cleared by F3. One command from the umbrella root:
//   npm run demo:marketplace       (near-sandbox, real contract, indexer, solver and keeper; about 2.5 minutes)
// Prints "do X - see Y" lines for Appendix A of the README. Sandbox amounts are small so a leg can be paid with 0.02-credit calls.
import { execFile } from "node:child_process";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";
import { writeSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { bundleInput, parseEventLog, termsHash, type BundleTerms, type ContractAbi } from "@x207/core";
import { FailoverRpcClient, Indexer, RpcBlockSource, createApiServer, openDatabase, rpcChainReader } from "../backend/src/index.ts";
import { viewClearedEdges } from "../backend/src/indexer/view-edges.ts";
import { marketplaceRoutes } from "../backend/src/marketplace/index.ts";
import { rpcViewFunction } from "../backend/src/settlement/intents.ts";
import { collectBundleSignatures, cycleTerms, findIntentCycles, loadOpenIntents } from "../solver/src/barter/index.ts";
import { runQuickBarter } from "../agents/scenario/quick.ts";
import { runWaitingScenario } from "../agents/scenario/waiting.ts";
import { BarterAgent, BookClient } from "../agents/shared/barter.ts";
import { AGENTS } from "../agents/shared/registry.ts";
import { createAgentBuyer } from "../agents/shared/x207.ts";
import { CALL_PRICE } from "../agents/scenario/ring.ts";
import { startStack, type Stack } from "../agents/test/stack.ts";
import { keeperPass } from "../scripts/lib/keeper.mjs";

const run = promisify(execFile);

describe("demo marketplace F9", () => {
  let stack: Stack;
  let api: Server | undefined;
  afterAll(async () => {
    api?.closeAllConnections?.();
    api?.close();
    await stack?.stop();
  });

  it("three bundles in one epoch are paid through legs and cleared by F3", async () => {
    const out = (line: string) => writeSync(1, `${line}\n`);
    const step = (doX: string, seeY: string) => out(`do: ${doX}\n   see: ${seeY}`);
    const short = (account: string) => account.split(".")[0];
    const credit = (v: bigint | string) => `${Number(v) / 1e6} credit`;
    out("\n== F9 marketplace barter: three bundles in one epoch");
    const clock = { offset: 0 };
    stack = await startStack({ now: () => Date.now() + clock.offset });
    const { fx, identity, urls } = stack;
    const rpcUrl = fx.sandbox.rpcUrl;
    const contract = fx.circle.accountId;
    const keeper = await fx.sandbox.createAccount("keeper", "20");
    const solver = await fx.sandbox.createAccount("solver", "20");
    // Jam buku marketplace: maju dua jam selama skenario listing menunggu.
    const book_ = { now: Math.floor(Date.now() / 1000) };

    const db = openDatabase(":memory:");
    const indexer = new Indexer({
      db, source: new RpcBlockSource(rpcChainReader(new FailoverRpcClient({ endpoints: [rpcUrl] })), contract, 1), circleId: "agents-main",
      contractId: contract, startBlock: 1, fetchParams: () => fx.sandbox.view(contract, "get_params", {}) as Promise<ContractAbi.Params>,
      fetchClearedEdges: (epoch) => viewClearedEdges(rpcUrl, contract, epoch),
    });
    await indexer.bootstrap();
    api = createApiServer({ db, now: () => book_.now * 1000, extraRoutes: marketplaceRoutes(db, { chainView: rpcViewFunction(rpcUrl) }) });
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
    // The open epoch is read from the contract's get_epoch view (chainView); the D9 epochs table has no row in the first epoch yet.
    const epoch = (await fx.sandbox.view<ContractAbi.EpochView>(contract, "get_epoch", {})).epoch;
    expect(count("select count(*) as n from epochs")).toBe(0);

    const book = new BookClient({ baseUrl: apiUrl, circleId: "agents-main" });
    const id = identity;
    const advance = (seconds: number) => void (book_.now += seconds);
    const unitMicro = CALL_PRICE; // 10 units x 0.02 = a listing worth 0.2 credit
    const bundles: Array<{ name: string; terms: BundleTerms; signatures: Array<{ account_id: string; signature: string }> }> = [];

    // 1. listing waits, then negotiation (translator sells, summarizer arrives two hours later)
    const waiting = await runWaitingScenario({ book, seller: id.translator, late: id.summarizer, contractId: contract, clock: book_, advance, unitMicro });
    expect(waiting.waitedSeconds).toBe(7200);
    expect(waiting.rounds.map((r) => r.kind)).toEqual(["bid", "countered", "countered", "accepted"]);
    step("translator lists translate-calls for summarize-calls (value 0.2) and waits; nobody is there", `listing stays open for ${waiting.waitedSeconds / 3600} hours; a second listing with a 30 minute life expires out of the open results`);
    step("summarizer arrives and negotiates by its own policy", `rounds ${waiting.rounds.map((r) => (r.value ? `${r.kind} ${credit(r.value)}` : r.kind)).join(" -> ")}; bundle ${waiting.bundle?.status}`);

    // 2. quick barter with a seeker (scraper sells, translator pays, summarizer barters, cleaner seeks)
    const quick = await runQuickBarter({
      book, contractId: contract, now: () => book_.now, params: { value: 0.5, discountBps: 2000, searcherShareBps: 400 },
      identities: { seller: id.scraper, payer: id.translator, barterer: id.summarizer, seeker: id.cleaner, bystander: id.gpu },
    });
    expect(quick.pay).toMatchObject({ status: "ready" });
    expect(quick.barter).toMatchObject({ status: "ready" });
    expect(quick.seekerRevenue).toBe(String(2 * 20_000));
    step("a seeker visits idle agents that opted in (one does not opt in and is skipped)", `offers: ${quick.plans.map((p) => `${short(p.to)} by ${p.mode}`).join(", ")}; skipped ${quick.skipped.map(short).join(", ")}`);
    step("pay path: the counterparty pays the discounted price plus the seeker share", `${credit(quick.pay!.counterpartyPays)} = ${quick.pay!.legs.map((l) => `${credit(l.amount)} to ${short(l.to)}`).join(" + ")}`);
    step("barter path: the counterparty hands over goods and receives cashback", `cashback ${credit(quick.barter!.cashback)}, seller bears ${credit(quick.barter!.sellerBears)}, seeker earns ${credit(quick.seekerRevenue)} over both paths`);

    // bundles from the book: take all proposals that are ready
    const proposals = await book.proposals(id.translator.accountId, "ready");
    const bookProposals = [...proposals, ...(await book.proposals(id.scraper.accountId, "ready")), ...(await book.proposals(id.cleaner.accountId, "ready"))];
    const unique = new Map(bookProposals.map((p) => [p.termsHash, p]));
    expect(unique.size).toBe(3);
    for (const p of unique.values()) bundles.push({ name: `book-${p.termsHash.slice(0, 6)}`, terms: p.terms, signatures: p.signatures.map((s) => ({ account_id: s.account, signature: s.signature })) });

    // 3. three-intent ring (image -> gpu -> translator -> image) found by the solver; its pairs differ from the legs of the other bundles
    const ringNames = ["image", "gpu", "translator"] as const;
    const agents = new Map(ringNames.map((n) => [n, new BarterAgent({ identity: id[n], book, contractId: contract, now: () => book_.now })]));
    const services = { image: "image", gpu: "compute", translator: "translate" } as const;
    const side = (n: keyof typeof services) => ({ service: services[n], calls: 5, value: String(5 * CALL_PRICE) });
    for (const [i, n] of ringNames.entries()) await agents.get(n)!.postIntent(side(n), side(ringNames[(i + 1) % ringNames.length]!));
    const open = await loadOpenIntents({ readApiUrl: apiUrl, circle: "agents-main" });
    const [cycle] = findIntentCycles(open);
    expect(cycle!.members).toHaveLength(3);
    const { terms: ringTerms, termsHash: ringHash } = cycleTerms(cycle!, contract, epoch);
    const pubkeys = Object.fromEntries(ringNames.map((n) => [id[n].accountId, id[n].voucherPublicKey]));
    const byAccount = new Map(ringNames.map((n) => [id[n].accountId, agents.get(n)!]));
    const collected = await collectBundleSignatures(ringTerms, pubkeys, async (account) => byAccount.get(account)!.signTerms(ringTerms));
    expect(collected).not.toBeNull();
    expect(termsHash(collected!.terms)).toBe(ringHash);
    step("image, gpu and translator post intents; the solver finds the ring and all three sign the terms_hash", `ring ${cycle!.members.map((m) => short(m.account)).join(" -> ")}, terms_hash ${ringHash.slice(0, 12)}…`);
    bundles.push({ name: "ring", terms: ringTerms, signatures: collected!.signatures.map((s) => ({ account_id: s.account, signature: s.signature })) });

    // 4. commit_bundle for the four bundles from the solver account
    const committed = new Map<string, number>();
    for (const bundle of bundles) {
      const result = await fx.sandbox.accountFrom(solver.accountId, solver.secretKey).call(
        { receiverId: contract, methodName: "commit_bundle", deposit: 0n, gas: 200_000_000_000_000n, args: { bundle: bundleInput(bundle.terms), signatures: bundle.signatures } },
        "EXECUTED_OPTIMISTIC",
      );
      expect(result.failures, bundle.name).toEqual([]);
      const events = result.logs.flatMap((l: string) => (parseEventLog(l) ?? []) as Array<Record<string, any> & { event: string }>);
      committed.set(bundle.name, Number(events.find((e) => e.event === "bundle_committed")!.bundle_id));
    }
    expect(committed.size).toBe(4);
    step("the solver commits the four bundles (commit_bundle)", `bundle ids ${[...committed.values()].join(", ")}; each needs one signature per participant`);
    for (const bundleId of committed.values()) {
      for (let i = 0; i < 60 && !(await stack.rpc.view(contract, "get_bundle", { bundle_id: bundleId })); i++) await new Promise((r) => setTimeout(r, 1_000));
    }

    // 5. legs are paid with vouchers that carry bundle_id; a leg that is not a multiple of 0.02 is paid as the largest multiple
    const ownerOf = new Map<string, number>();
    for (const bundle of bundles) for (const leg of bundle.terms.legs) ownerOf.set(`${leg.payer}>${leg.payee}`, committed.get(bundle.name)!);
    expect(ownerOf.size).toBe(bundles.reduce((n, b) => n + b.terms.legs.length, 0)); // each pair belongs to the leg of only one bundle
    const nameOf = new Map(Object.entries(id).map(([name, v]) => [v.accountId, name as keyof typeof id]));
    const buyers = new Map<string, typeof fetch>();
    const buyerOf = (account: string) => {
      if (!buyers.has(account)) {
        buyers.set(account, createAgentBuyer(id[nameOf.get(account)!], { rpcUrls: [rpcUrl], bundleFor: (payee, e) => (e === epoch ? ownerOf.get(`${account}>${payee}`) : undefined) }));
      }
      return buyers.get(account)!;
    };
    const expectedCumulative = new Map<string, bigint>();
    for (const bundle of bundles) {
      for (const leg of bundle.terms.legs) {
        const calls = Number(BigInt(leg.max_amount) / BigInt(CALL_PRICE));
        const seller = nameOf.get(leg.payee)!;
        for (let i = 0; i < calls; i += 1) {
          const response = await buyerOf(leg.payer)(`${urls[seller as keyof typeof urls]}/api/${AGENTS[seller as keyof typeof AGENTS].verb}?input=halo`);
          if (response.status !== 200) throw new Error(`${bundle.name} ${leg.payer} -> ${leg.payee}: HTTP ${response.status} ${await response.text()}`);
        }
        expectedCumulative.set(`${leg.payer}>${leg.payee}`, BigInt(calls) * BigInt(CALL_PRICE));
      }
    }
    step("every leg is paid with ordinary x402 calls whose voucher carries the bundle id", `${stack.settled.length} paid calls against reserved headroom, not free headroom`);
    const tick = await stack.scheduler.tick();
    expect(tick).toMatchObject({ dropped: 0, retrying: 0 });
    expect(tick.registered).toBe(expectedCumulative.size);
    const net = new Map<string, bigint>();
    for (const [pair, cumulative] of expectedCumulative) {
      const [payer, payee] = pair.split(">") as [string, string];
      const edge = await fx.sandbox.view<{ cumulative: string }>(contract, "obligation", { epoch, debtor: payer, creditor: payee });
      expect(BigInt(edge.cumulative), pair).toBe(cumulative);
      net.set(payer, (net.get(payer) ?? 0n) - cumulative);
      net.set(payee, (net.get(payee) ?? 0n) + cumulative);
    }

    // 6. F3 clearing
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
    const advanceChain = async (ns: string | null | undefined) => {
      await fx.sandbox.advanceTo(Number(BigInt(ns!) / 1_000_000n) + 1_000);
      clock.offset += 61_000;
      await new Promise((r) => setTimeout(r, 3_000));
    };
    const phaseOf = () => (db.prepare("select phase from epochs where epoch = ?").get(epoch) as { phase: string } | undefined)?.phase;
    await advanceChain((await fx.sandbox.view<ContractAbi.EpochView>(contract, "get_epoch", { epoch })).cutoff_at);
    expect((await pass()).filter((a) => a.epoch === epoch).map((a) => a.method)).toEqual(["close_epoch"]);
    await catchUp(() => phaseOf() !== "open");
    await run("node", ["solver/dist/cli.js", "--epoch", String(epoch)], {
      env: { PATH: process.env.PATH, X207_READ_API_URL: apiUrl, X207_CIRCLE_ID: "agents-main", NEAR_RPC_URL: rpcUrl, X207_CONTRACT_ID: contract, SOLVER_ACCOUNT_ID: solver.accountId, SOLVER_PRIVATE_KEY: solver.secretKey },
    });
    await advanceChain((await fx.sandbox.view<ContractAbi.EpochView>(contract, "get_epoch", { epoch })).proposal_deadline);
    expect((await pass()).filter((a) => a.epoch === epoch).map((a) => a.method)).toEqual(["commit_epoch"]);
    await catchUp(() => ["payment_window", "finalized"].includes(phaseOf() ?? ""));

    // 7. 207 report: net position = difference of registered obligations; the ring is fully cleared; the seeker receives its share
    const body = (await (await fetch(`${base}/epochs/${epoch}`)).json()) as { cleared: string; members: Array<{ account: string; status: number; net: string }> };
    const row = (account: string) => body.members.find((m) => m.account === account)!;
    for (const [account, expected] of net) {
      expect(BigInt(row(account).net), account).toBe(expected);
    }
    // image and gpu only take part in the ring: fully cleared, zero residual, status 200
    for (const n of ["image", "gpu"] as const) expect(row(id[n].accountId), n).toMatchObject({ status: 200, net: "0" });
    // cleaner is only a seeker: receives exactly its share from both paths
    expect(BigInt(row(id.cleaner.accountId).net)).toBe(BigInt(quick.seekerRevenue));
    expect(BigInt(body.cleared)).toBeGreaterThan(0n);
    expect([...net.values()].reduce((a, b) => a + b, 0n)).toBe(0n);
    step("close the epoch, run the solver, commit the epoch, read the 207 report", `cleared ${credit(body.cleared)}; image and gpu (ring only) have status 200 and net 0; the seeker nets ${credit(row(id.cleaner.accountId).net)}; all nets add up to 0`);
    out(`result: bundles ${[...committed.entries()].map(([n, i]) => `${n}=${i}`).join(", ")}; every net position equals the registered obligations (assertions passed)`);
  }, 2_400_000);
});
