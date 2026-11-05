// UM-106: one REALISTIC epoch on the circle x207-v013.testnet, run from the local machine with the aux accounts (testnet only; keys stay in .secrets/, hashes go to docs/testnet-0.0.13-realistic.json).
// The earlier epochs of this circle were a complete graph of 210 edges of 1 credit each, all cleared at 100 percent (CT-100): a stress test, but it does not look like trade. This one has
//   - an asymmetric graph of 24 edges between 15 members with amounts from 0.35 to 5 credit: three cycles of different length (3, 2 and 4 members) and chains that end nowhere,
//   - a PARTIAL clearing: the solver of the repository cancels the cycles, the chains stay as debts, so the cleared ratio is between 0 and 1,
//   - the residuals: every net debtor pays its residual with `ft_transfer_call` (the message `settle`) except one, which defaults,
//   - `finalize_epoch` (the default is booked, its stake pays) and claims by creditors.
// Before it starts, the keeper of the repository (scripts/lib/keeper.mjs, run by the aux account) finishes the epochs that were left open by earlier runs.
// Run: X207_TESTNET=1 npx vitest run tests/testnet-realistic-epoch.live.test.ts      (about 35 minutes of real time: the windows of the circle are 600 s, 60 s and 900 s)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { signVoucher } from "@x207/core";
import { Account, JsonRpcProvider, KeyPairSigner } from "../backend/node_modules/near-api-js/lib/index.js";
import { keeperPass } from "../scripts/lib/keeper.mjs";
import { GRAPH as PLANNED_GRAPH } from "../scripts/lib/realistic-epoch.mjs";
import { solveClearing } from "../solver/src/mincostflow/index.ts";
import type { ObligationGraph } from "../solver/src/graph/index.ts";
import { Recorder, patient, sleep } from "./support/testnet-kit.ts";

const ENABLED = process.env.X207_TESTNET === "1";
const RPCS = [process.env.X207_TESTNET_RPC ?? "https://rpc.testnet.fastnear.com", "https://near-testnet.drpc.org"]; // UM-191: rpc.testnet.near.org is deprecated
const CIRCLE = "x207-v013.testnet";
const AUX = "x207-v013-aux.testnet";
const USDT = "usdt.x207-deployer.testnet";
const secretsDir = process.env.X207_SECRETS_DIR ?? resolve("../../.secrets/testnet-deployer");
const CREDIT = 1_000_000n;
const credits = (x: number): bigint => BigInt(Math.round(x * 1_000_000));

/** Who owes whom, in credit: `[debtor, creditor, amount]` by member number; the graph lives in scripts/lib/realistic-epoch.mjs, shared with `npm run testnet:epoch`. */
const GRAPH = PLANNED_GRAPH as Array<[number, number, number]>;

describe.skipIf(!ENABLED)("UM-106: a realistic epoch on x207-v013.testnet", () => {
  it("runs a partial clearing with residuals paid, one default and claims, on real time", async () => {
    const outPath = process.env.X207_UM106_OUT ?? resolve("docs/testnet-0.0.13-realistic.json");
    const recorder = new Recorder(outPath, { contract: CIRCLE, aux: AUX, note: "UM-106: asymmetric graph, partial clearing, residuals, one default; hashes and names only" });
    const provider = new JsonRpcProvider({ url: RPCS[0]! });
    const keyOf = (id: string): string => {
      const j = JSON.parse(readFileSync(join(secretsDir, "testnet", `${id}.json`), "utf8")) as { private_key?: string; secret_key?: string };
      return (j.private_key ?? j.secret_key) as string;
    };
    const keysPath = join(secretsDir, "um100-v013.json");
    if (!existsSync(keysPath)) throw new Error("the keys of the members (um100-v013.json) are missing from .secrets/testnet-deployer");
    const saved = JSON.parse(readFileSync(keysPath, "utf8")) as Record<string, { tx: string; voucher: string }>;
    const accountOf = (id: string, secret: string) => new Account(id, provider, KeyPairSigner.fromSecretKey(secret as never));
    const owner = accountOf(CIRCLE, keyOf(CIRCLE));
    const aux = accountOf(AUX, keyOf(AUX));
    const ids = Array.from({ length: 15 }, (_, i) => `m${String(i).padStart(2, "0")}.${AUX}`);
    const members = ids.map((id) => accountOf(id, saved[id]!.tx));

    const rpc = async (method: string, params: unknown): Promise<any> => {
      let last: unknown;
      for (const url of RPCS) {
        try {
          return await patient(async () => {
            const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
            const body = (await response.json().catch(() => ({ error: `HTTP ${response.status}` }))) as { result?: any; error?: unknown };
            if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)} ${response.status}`);
            return body.result;
          });
        } catch (error) {
          last = error;
        }
      }
      throw last;
    };
    const view = async <T>(method: string, args: object = {}, contract = CIRCLE): Promise<T> => {
      const r = await rpc("query", { request_type: "call_function", finality: "optimistic", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
      return JSON.parse(Buffer.from(r.result).toString("utf8")) as T;
    };
    const near = async (id: string): Promise<bigint> => BigInt(((await rpc("query", { request_type: "view_account", finality: "final", account_id: id })) as { amount: string }).amount);
    const chainMs = async (): Promise<number> => Number(BigInt((await rpc("block", { finality: "optimistic" })).header.timestamp_nanosec) / 1_000_000n);
    const waitUntil = async (ns: string, slackMs = 2_000) => {
      const target = Number(BigInt(ns) / 1_000_000n) + slackMs;
      while ((await chainMs()) < target) await sleep(6_000);
    };

    /** One call from `account`; records the hash; a failure is returned, not thrown, when `expectFailure` (a default is a scenario, not an error). */
    const send = async (account: Account, step: string, call: { receiverId: string; methodName: string; args: object; deposit?: bigint; gas?: bigint }): Promise<{ value: unknown; hash: string; logs: string[] }> => {
      const r: any = await patient(() =>
        account.callFunctionRaw({ contractId: call.receiverId, methodName: call.methodName, args: call.args, deposit: call.deposit ?? 0n, gas: call.gas ?? 100_000_000_000_000n, waitUntil: "FINAL" }),
      );
      recorder.add({ step, account: account.accountId, method: call.methodName, hash: r.transaction_outcome.id });
      const failure = [r.status, ...(r.receipts_outcome ?? []).map((o: any) => o.outcome.status)].find((s) => s && typeof s === "object" && "Failure" in s);
      if (failure) throw new Error(`${step} ${call.methodName}: ${JSON.stringify(failure).slice(0, 300)}`);
      const sv = r.status?.SuccessValue;
      return { value: sv ? JSON.parse(Buffer.from(sv, "base64").toString("utf8")) : undefined, hash: r.transaction_outcome.id, logs: (r.receipts_outcome as any[]).flatMap((o) => o.outcome.logs as string[]) };
    };

    // ---- 0. a little NEAR for the members that pay and claim: a call with 60 to 100 Tgas reserves 0.06 to 0.1 NEAR and the members had 0.064 (SV-020)
    for (const [i, m] of members.entries()) {
      if ((await near(ids[i]!)) < 250_000_000_000_000_000_000_000n) {
        const t: any = await patient(() => owner.transfer({ receiverId: ids[i]!, amount: 200_000_000_000_000_000_000_000n } as never));
        recorder.add({ step: `top up ${ids[i]}`, account: CIRCLE, method: "transfer", hash: t.transaction_outcome.id });
      }
      void m;
    }

    // ---- 1. the keeper of the repository finishes what earlier runs left open, then waits for an epoch that has at least 7 minutes to its cutoff
    const keeper = async () =>
      keeperPass({
        log: (l: unknown) => console.log("keeper:", typeof l === "string" ? l : JSON.stringify(l)),
        view: (m: string, a: object) => view(m, a),
        chainNowMs: chainMs,
        send: async ({ methodName, args, gas }: { methodName: string; args: object; gas?: bigint }) => {
          const r = await send(aux, `keeper ${methodName}`, { receiverId: CIRCLE, methodName, args, gas: gas ?? 100_000_000_000_000n });
          return r.hash;
        },
      });
    let epoch = 0;
    for (let i = 0; i < 120; i++) {
      await keeper();
      const e = await view<{ epoch: number; phase: string; cutoff_at: string }>("get_epoch");
      const left = Number(BigInt(e.cutoff_at) / 1_000_000n) - (await chainMs());
      if (e.phase === "open" && left > 7 * 60_000) {
        epoch = e.epoch;
        break;
      }
      await sleep(20_000);
    }
    expect(epoch).toBeGreaterThan(0);
    const result: Record<string, unknown> = { epoch };

    // ---- 2. the debtors register their vouchers in parallel (one cumulative voucher per pair)
    const t0 = Date.now();
    await Promise.all(
      members.map(async (account, i) => {
        for (const [d, c, amount] of GRAPH) {
          if (d !== i) continue;
          const { signature, ...voucher } = signVoucher(
            { circle: CIRCLE, payer: ids[d]!, payee: ids[c]!, epoch, seq: 1, cumulativeAmount: credits(amount).toString(), unit: "credit", resource: "https://x207.example/um106" },
            saved[ids[d]!]!.voucher as `ed25519:${string}`,
          );
          await send(account, `register m${String(d).padStart(2, "0")}->m${String(c).padStart(2, "0")} ${amount}`, { receiverId: CIRCLE, methodName: "register_cumulative", args: { voucher, signature }, gas: 30_000_000_000_000n });
        }
      }),
    );
    const obligations = await view<Array<{ debtor: string; creditor: string; obligation: string }>>("list_obligations", { epoch, from_index: 0, limit: 100 });
    expect(obligations).toHaveLength(GRAPH.length);
    result.edgesRegistered = { count: obligations.length, seconds: Math.round((Date.now() - t0) / 1000), totalObligation: obligations.reduce((n, o) => n + BigInt(o.obligation), 0n).toString() };

    // ---- 3. cutoff, the clearing of the solver of the repository, the proposal
    let current = await view<{ cutoff_at: string; proposal_deadline: string; payment_deadline: string }>("get_epoch", { epoch });
    await waitUntil(current.cutoff_at);
    await send(aux, "close_epoch", { receiverId: CIRCLE, methodName: "close_epoch", args: { epoch }, gas: 30_000_000_000_000n });
    const graph: ObligationGraph = {
      circle: CIRCLE, epoch, members: ids,
      edges: obligations.map((o) => ({ debtor: o.debtor, creditor: o.creditor, amount: BigInt(o.obligation) })).sort((a, b) => (a.debtor + a.creditor < b.debtor + b.creditor ? -1 : 1)),
      totalObligation: obligations.reduce((n, o) => n + BigInt(o.obligation), 0n),
    };
    const clearing = solveClearing(graph);
    expect(clearing.status).toBe("ok");
    const ratio = Number(clearing.clearedTotal) / Number(graph.totalObligation);
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
    await send(aux, "submit_clearing", { receiverId: CIRCLE, methodName: "submit_clearing", args: { epoch, edges: clearing.proposal.edges }, gas: 60_000_000_000_000n });
    result.clearing = { edges: clearing.proposal.edges.length, clearedTotal: clearing.clearedTotal.toString(), totalObligation: graph.totalObligation.toString(), clearedRatio: Math.round(ratio * 1000) / 1000 };

    // ---- 4. commit; the positions say who owes a residual and who is owed
    current = await view("get_epoch", { epoch });
    await waitUntil(current.proposal_deadline);
    await send(aux, "commit_epoch", { receiverId: CIRCLE, methodName: "commit_epoch", args: { epoch }, gas: 150_000_000_000_000n });
    const positions = await view<Array<{ account_id: string; role: string; status: string; amount: string; net: string }>>("list_positions", { epoch, from_index: 0, limit: 100 });
    const debtors = positions.filter((p) => p.role === "debtor" && p.status === "due" && BigInt(p.amount) > 0n).sort((a, b) => Number(BigInt(a.amount) - BigInt(b.amount)));
    const creditors = positions.filter((p) => p.role === "creditor" && BigInt(p.amount) > 0n).sort((a, b) => Number(BigInt(b.amount) - BigInt(a.amount)));
    expect(debtors.length).toBeGreaterThanOrEqual(2);
    expect(creditors.length).toBeGreaterThanOrEqual(1);
    const defaulter = debtors[0]!; // the smallest residual defaults
    const payers = debtors.slice(1);
    result.positions = { debtors: debtors.map((d) => ({ account: d.account_id, due: d.amount })), creditors: creditors.map((c) => ({ account: c.account_id, claimable: c.amount })), defaulter: defaulter.account_id };

    // ---- 5. the residuals: every debtor except one pays with ft_transfer_call and the message settle (the USDT is minted first: the members only held their stake)
    await Promise.all(
      payers.map(async (p) => {
        const account = members[ids.indexOf(p.account_id)]!;
        await send(account, `usdt ${p.account_id}`, { receiverId: USDT, methodName: "mint", args: { account_id: p.account_id, amount: p.amount }, gas: 10_000_000_000_000n });
        await send(account, `settle ${p.account_id} ${p.amount}`, {
          receiverId: USDT, methodName: "ft_transfer_call", deposit: 1n, gas: 80_000_000_000_000n,
          args: { receiver_id: CIRCLE, amount: p.amount, msg: JSON.stringify({ action: "settle", epoch }) },
        });
      }),
    );

    // ---- 6. the payment window ends: finalize books the default
    current = await view("get_epoch", { epoch });
    await waitUntil(current.payment_deadline);
    const fin = await send(aux, "finalize_epoch", { receiverId: CIRCLE, methodName: "finalize_epoch", args: { epoch }, gas: 100_000_000_000_000n });
    const events = fin.logs.filter((l) => l.startsWith("EVENT_JSON:")).map((l) => JSON.parse(l.slice("EVENT_JSON:".length)) as { event: string; data: any[] });
    const defaulted = events.filter((e) => e.event === "member_defaulted").map((e) => e.data[0]);
    expect(defaulted.map((d: any) => d.account_id)).toEqual([defaulter.account_id]);
    expect((await view<{ phase: string }>("get_epoch", { epoch })).phase).toBe("finalized");
    result.finalize = { hash: fin.hash, defaulted: defaulted.map((d: any) => ({ account: d.account_id, due: d.due, fromStake: d.from_stake, shortfall: d.shortfall })) };

    // ---- 7. claims: the creditors take what they are owed (the pool holds the residuals that were paid and the stake of the default)
    const claimed: Array<{ account: string; claimable: string; status: string }> = [];
    for (const c of creditors.slice(0, 3)) {
      const account = members[ids.indexOf(c.account_id)]!;
      await send(account, `claim ${c.account_id} ${c.amount}`, { receiverId: CIRCLE, methodName: "claim", args: { epoch, destination: "near" }, deposit: 1n, gas: 100_000_000_000_000n });
      const p = await view<{ status: string }>("net_position", { epoch, account_id: c.account_id });
      claimed.push({ account: c.account_id, claimable: c.amount, status: p.status });
    }
    result.claims = claimed;
    console.log(JSON.stringify(result));
    writeFileSync(outPath, JSON.stringify({ ...(JSON.parse(readFileSync(outPath, "utf8")) as Record<string, unknown>), result }, null, 2));
    expect(claimed.some((c) => c.status === "claimed")).toBe(true);
  }, 4_800_000);
});
