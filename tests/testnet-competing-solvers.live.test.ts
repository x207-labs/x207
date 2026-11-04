// UM-123 (audit KN-15): two solvers compete in ONE epoch of the circle x207-v013.testnet (testnet only; keys stay in .secrets/, hashes go to docs/testnet-epochs/um123-competing-solvers.json).
// The graph has two cycles and a chain: X = m00 -> m01 -> m02 -> m00 (2 credit each, 6 credit cleared), Y = m03 -> m04 -> m03 (1 credit each, 2 credit cleared) and m05 -> m07 (1 credit, no cycle; m06 is suspended since the default of UM-106 and cannot be a payee).
// The rule of the contract (spec 4.3, `beats_stored` in contracts/x207-circle/src/verifier.rs): a proposal replaces the stored one only with a larger `cleared_total`, or an equal one with fewer edges.
// Sequence inside the proposal window of 60 s:
//   1. solver 1 (the aux account) submits Y alone (2 credit): stored;
//   2. solver 2 (solver2.x207rh-keeper.testnet, an unrelated account) submits X + Y (8 credit): it replaces 1 (the event names the replaced solver);
//   3. solver 1 submits X alone (6 credit): refused, ERR_PROPOSAL_NOT_BETTER;
//   4. solver 1 submits X + Y (8 credit, the same as the stored one): refused, ERR_PROPOSAL_NOT_BETTER (the first of equals stays).
// Then commit_epoch applies the stored proposal (the one of solver 2) and the residual of the chain is paid.
// The circle has no keeper: the test runs the keeper pass of the repository (aux account) while it waits for an open epoch, and needs one with 4 minutes to its cutoff (up to about 10 minutes of waiting).
// Run: X207_TESTNET=1 npx vitest run tests/testnet-competing-solvers.live.test.ts      (about 25 minutes: it waits for the cutoff of an epoch that is open)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { signVoucher } from "@x207/core";
import { Account, JsonRpcProvider, KeyPairSigner } from "../backend/node_modules/near-api-js/lib/index.js";
import { keeperPass } from "../scripts/lib/keeper.mjs";
import { solveClearing } from "../solver/src/mincostflow/index.ts";
import type { ObligationGraph } from "../solver/src/graph/index.ts";
import { Recorder, patient, sleep } from "./support/testnet-kit.ts";

const ENABLED = process.env.X207_TESTNET === "1";
const RPCS = [process.env.X207_TESTNET_RPC ?? "https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org"];
const CIRCLE = "x207-v013.testnet";
const AUX = "x207-v013-aux.testnet";
const SOLVER2 = "solver2.x207rh-keeper.testnet";
const USDT = "usdt.x207-deployer.testnet";
const secretsDir = process.env.X207_SECRETS_DIR ?? resolve("../../.secrets/testnet-deployer");
const credits = (x: number): bigint => BigInt(Math.round(x * 1_000_000));
const GRAPH: Array<[number, number, number]> = [[0, 1, 2], [1, 2, 2], [2, 0, 2], [3, 4, 1], [4, 3, 1], [5, 7, 1]];

describe.skipIf(!ENABLED)("UM-123: two solvers compete in one epoch of x207-v013.testnet", () => {
  it("keeps the better proposal and refuses the worse and the equal ones", async () => {
    const outPath = process.env.X207_UM123_OUT ?? resolve("docs/testnet-epochs/um123-competing-solvers.json");
    const recorder = new Recorder(outPath, { contract: CIRCLE, aux: AUX, solver2: SOLVER2, note: "UM-123: two solvers, one epoch; hashes and names only" });
    const provider = new JsonRpcProvider({ url: RPCS[0]! });
    const keyOf = (id: string): string => {
      const j = JSON.parse(readFileSync(join(secretsDir, "testnet", `${id}.json`), "utf8")) as { private_key?: string; secret_key?: string };
      return (j.private_key ?? j.secret_key) as string;
    };
    const saved = JSON.parse(readFileSync(join(secretsDir, "um100-v013.json"), "utf8")) as Record<string, { tx: string; voucher: string }>;
    if (!existsSync(join(secretsDir, "um100-v013.json"))) throw new Error("um100-v013.json is missing");
    const accountOf = (id: string, secret: string) => new Account(id, provider, KeyPairSigner.fromSecretKey(secret as never));
    const aux = accountOf(AUX, keyOf(AUX));
    const solver2 = accountOf(SOLVER2, keyOf(SOLVER2));
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
    const view = async <T>(method: string, args: object = {}): Promise<T> => {
      const r = await rpc("query", { request_type: "call_function", finality: "optimistic", account_id: CIRCLE, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
      return JSON.parse(Buffer.from(r.result).toString("utf8")) as T;
    };
    const chainMs = async (): Promise<number> => Number(BigInt((await rpc("block", { finality: "optimistic" })).header.timestamp_nanosec) / 1_000_000n);
    const waitUntil = async (ns: string, slackMs = 2_000) => {
      const target = Number(BigInt(ns) / 1_000_000n) + slackMs;
      while ((await chainMs()) < target) await sleep(5_000);
    };
    type Outcome = { ok: boolean; hash: string; logs: string[]; error?: string; value?: unknown };
    /** One call; the failure of the contract is RETURNED (a refused proposal is the thing under test), a transport error is thrown. */
    const send = async (account: Account, step: string, call: { receiverId: string; methodName: string; args: object; deposit?: bigint; gas?: bigint }): Promise<Outcome> => {
      let r: any;
      try {
        r = await patient(() => account.callFunctionRaw({ contractId: call.receiverId, methodName: call.methodName, args: call.args, deposit: call.deposit ?? 0n, gas: call.gas ?? 100_000_000_000_000n, waitUntil: "FINAL" }));
      } catch (error: any) {
        // near-api-js THROWS when the contract panics; a refused proposal is the expected outcome here, so it is turned into a result (the hash comes from the error when it carries one)
        const message = String(error?.message ?? error);
        if (!/panicked|ExecutionError|ERR_/.test(message)) throw error;
        const hash: string = error?.transaction_outcome?.id ?? error?.context?.transactionHash ?? error?.transactionHash ?? "(not in the error)";
        recorder.add({ step, account: account.accountId, method: call.methodName, hash });
        return { ok: false, hash, logs: [], error: message.slice(0, 400) };
      }
      recorder.add({ step, account: account.accountId, method: call.methodName, hash: r.transaction_outcome.id });
      const failure = [r.status, ...(r.receipts_outcome ?? []).map((o: any) => o.outcome.status)].find((s) => s && typeof s === "object" && "Failure" in s);
      const sv = r.status?.SuccessValue;
      return {
        ok: !failure, hash: r.transaction_outcome.id, logs: (r.receipts_outcome as any[]).flatMap((o) => o.outcome.logs as string[]),
        ...(failure ? { error: JSON.stringify(failure).slice(0, 400) } : {}), ...(sv ? { value: JSON.parse(Buffer.from(sv, "base64").toString("utf8")) } : {}),
      };
    };
    const events = (logs: string[]) => logs.filter((l) => l.startsWith("EVENT_JSON:")).map((l) => JSON.parse(l.slice("EVENT_JSON:".length)) as { event: string; data: any[] });

    // ---- 1. an epoch that is open with at least 4 minutes to its cutoff (the aux account finishes what is due first)
    let epoch = 0;
    for (let i = 0; i < 120; i++) {
      // no keeper runs on this circle: the aux account closes, commits and finalizes what is due before it looks for an open epoch
      await keeperPass({
        log: (l: unknown) => console.log("keeper:", typeof l === "string" ? l : JSON.stringify(l)),
        view: (m: string, a: object) => view(m, a),
        chainNowMs: chainMs,
        send: async ({ methodName, args, gas }: { methodName: string; args: object; gas?: bigint }) => {
          const r = await send(aux, `keeper ${methodName}`, { receiverId: CIRCLE, methodName, args, gas: gas ?? 100_000_000_000_000n });
          return r.hash;
        },
      });
      const e = await view<{ epoch: number; phase: string; cutoff_at: string }>("get_epoch");
      const left = Number(BigInt(e.cutoff_at) / 1_000_000n) - (await chainMs());
      if (e.phase === "open" && left > 4 * 60_000) {
        epoch = e.epoch;
        break;
      }
      await sleep(20_000);
    }
    expect(epoch).toBeGreaterThan(0);
    const result: Record<string, unknown> = { epoch };

    // ---- 2. the vouchers
    // a re-run in the same epoch registers only the pairs that are not there yet (a voucher with the same seq would be refused)
    const already = await view<Array<{ debtor: string; creditor: string }>>("list_obligations", { epoch, from_index: 0, limit: 100 });
    await Promise.all(
      members.map(async (account, i) => {
        for (const [d, c, amount] of GRAPH) {
          if (d !== i) continue;
          if (already.some((o) => o.debtor === ids[d] && o.creditor === ids[c])) continue;
          const { signature, ...voucher } = signVoucher(
            { circle: CIRCLE, payer: ids[d]!, payee: ids[c]!, epoch, seq: 1, cumulativeAmount: credits(amount).toString(), unit: "credit", resource: "https://x207.example/um123" },
            saved[ids[d]!]!.voucher as `ed25519:${string}`,
          );
          const r = await send(account, `register m${String(d).padStart(2, "0")}->m${String(c).padStart(2, "0")} ${amount}`, { receiverId: CIRCLE, methodName: "register_cumulative", args: { voucher, signature }, gas: 30_000_000_000_000n });
          expect(r.ok, r.error).toBe(true);
        }
      }),
    );
    const obligations = await view<Array<{ debtor: string; creditor: string; obligation: string }>>("list_obligations", { epoch, from_index: 0, limit: 100 });
    expect(obligations).toHaveLength(GRAPH.length);

    // ---- 3. cutoff and the proposals
    let current = await view<{ cutoff_at: string; proposal_deadline: string; payment_deadline: string }>("get_epoch", { epoch });
    await waitUntil(current.cutoff_at);
    const closed = await send(aux, "close_epoch", { receiverId: CIRCLE, methodName: "close_epoch", args: { epoch }, gas: 30_000_000_000_000n });
    expect(closed.ok, closed.error).toBe(true);
    const graph: ObligationGraph = {
      circle: CIRCLE, epoch, members: ids,
      edges: obligations.map((o) => ({ debtor: o.debtor, creditor: o.creditor, amount: BigInt(o.obligation) })).sort((a, b) => (a.debtor + a.creditor < b.debtor + b.creditor ? -1 : 1)),
      totalObligation: obligations.reduce((n, o) => n + BigInt(o.obligation), 0n),
    };
    const optimum = solveClearing(graph);
    expect(optimum.status).toBe("ok");
    expect(optimum.clearedTotal).toBe(credits(8));
    const within = (members: number[]) => optimum.proposal.edges.filter((e) => members.some((m) => ids[m] === e.debtor) && members.some((m) => ids[m] === e.creditor));
    const onlyY = within([3, 4]);
    const onlyX = within([0, 1, 2]);
    const both = optimum.proposal.edges;
    expect([onlyY.length, onlyX.length, both.length]).toEqual([2, 3, 5]);
    const submit = (account: Account, step: string, edges: typeof both) => send(account, step, { receiverId: CIRCLE, methodName: "submit_clearing", args: { epoch, edges }, gas: 60_000_000_000_000n });
    const stored = async () => view<{ solver: string; cleared_total: string; edge_count?: number } | null>("get_proposal", { epoch, from_index: 0, limit: 1 });

    const p1 = await submit(aux, "P1 solver 1: Y alone (2 credit)", onlyY);
    expect(p1.ok, p1.error).toBe(true);
    const afterP1 = await stored();
    const p2 = await submit(solver2, "P2 solver 2: X and Y (8 credit)", both);
    expect(p2.ok, p2.error).toBe(true);
    const afterP2 = await stored();
    const p3 = await submit(aux, "P3 solver 1: X alone (6 credit)", onlyX);
    const afterP3 = await stored();
    const p4 = await submit(aux, "P4 solver 1: X and Y again (8 credit, equal to the stored one)", both);
    const afterP4 = await stored();
    result.proposals = {
      p1: { ok: p1.ok, hash: p1.hash, stored: afterP1 },
      p2: { ok: p2.ok, hash: p2.hash, events: events(p2.logs).map((e) => ({ event: e.event, data: e.data })), stored: afterP2 },
      p3: { ok: p3.ok, hash: p3.hash, error: p3.error ?? null, stored: afterP3 },
      p4: { ok: p4.ok, hash: p4.hash, error: p4.error ?? null, stored: afterP4 },
    };
    expect(p3.ok).toBe(false);
    expect(p3.error).toMatch(/ERR_PROPOSAL_NOT_BETTER/);
    expect(p4.ok).toBe(false);
    expect(p4.error).toMatch(/ERR_PROPOSAL_NOT_BETTER/);
    expect(afterP4?.solver).toBe(SOLVER2);
    expect(BigInt(afterP4!.cleared_total)).toBe(credits(8));

    // ---- 4. commit applies the stored proposal; the residual of the chain (m05 owes m07 one credit) is paid
    current = await view("get_epoch", { epoch });
    await waitUntil(current.proposal_deadline);
    const commit = await send(aux, "commit_epoch", { receiverId: CIRCLE, methodName: "commit_epoch", args: { epoch }, gas: 150_000_000_000_000n });
    expect(commit.ok, commit.error).toBe(true);
    const applied = events(commit.logs).filter((e) => e.event === "clearing_applied").map((e) => e.data[0]);
    result.commit = { hash: commit.hash, clearingApplied: applied };
    const positions = await view<Array<{ account_id: string; role: string; status: string; amount: string; net: string }>>("list_positions", { epoch, from_index: 0, limit: 100 });
    result.positions = positions.map((p) => ({ account: p.account_id, role: p.role, status: p.status, net: p.net, amount: p.amount }));
    const debtor = positions.find((p) => p.role === "debtor" && BigInt(p.amount) > 0n);
    if (debtor) {
      const payer = members[ids.indexOf(debtor.account_id)]!;
      await send(payer, `usdt ${debtor.account_id}`, { receiverId: USDT, methodName: "mint", args: { account_id: debtor.account_id, amount: debtor.amount }, gas: 10_000_000_000_000n });
      const settle = await send(payer, `settle ${debtor.account_id} ${debtor.amount}`, { receiverId: USDT, methodName: "ft_transfer_call", deposit: 1n, gas: 80_000_000_000_000n, args: { receiver_id: CIRCLE, amount: debtor.amount, msg: JSON.stringify({ action: "settle", epoch }) } });
      result.settle = { ok: settle.ok, hash: settle.hash };
    }
    console.log(JSON.stringify(result));
    writeFileSync(outPath, JSON.stringify({ ...(JSON.parse(readFileSync(outPath, "utf8")) as Record<string, unknown>), result }, null, 2));
  }, 4_800_000);
});
