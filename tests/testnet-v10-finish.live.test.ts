// Resumes the rehearsal v10 on a circle whose run was cut short after the clearing (a network error of the free RPC): settles the residual that is still due, finalizes the epoch,
// lets the creditors claim, runs `prune_epoch` with one claim still untaken, and takes that claim afterwards. Testnet only; the keys stay in .secrets/ and are never printed.
// Run: X207_TESTNET=1 X207_REHEARSAL_OWNER=x207-circle-v10s.testnet X207_REHEARSAL_OUT=/path/out.json npx vitest run tests/testnet-v10-finish.live.test.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Account, JsonRpcProvider, KeyPairSigner } from "../backend/node_modules/near-api-js/lib/index.js";

const ENABLED = process.env.X207_TESTNET === "1";
const OWNER = process.env.X207_REHEARSAL_OWNER ?? "x207-circle-v10s.testnet";
const USDT = "usdt.x207-deployer.testnet";
const NAMES = ["andi", "budi", "citra", "dewi", "eka"] as const;
const RPC = process.env.X207_TESTNET_RPC ?? "https://rpc.testnet.fastnear.com";
const secretsDir = resolve("../../.secrets/testnet-deployer");
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const TRANSIENT = /429|rate limit|fetch failed|EHOSTUNREACH|ECONNRESET|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|socket hang up|other side closed|UND_ERR|HTTP 5\d\d|\b5\d\d\b.*(?:gateway|unavailable|error)/i;

async function patient<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const text = `${(error as Error).message} ${JSON.stringify((error as { cause?: unknown }).cause ?? "")}`;
      if (attempt >= 15 || !TRANSIENT.test(text)) throw error;
      await sleep(4000 + attempt * 2000);
    }
  }
}

/** A step that gets no answer in `ms` fails with its name instead of hanging. */
const within = <T>(name: string, ms: number, work: Promise<T>): Promise<T> =>
  Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`step "${name}" took longer than ${ms} ms`)), ms))]);

describe.skipIf(!ENABLED)("rehearsal v10: finish the epoch that a network error cut short", () => {
  it("settles, finalizes, claims, prunes and takes the claim that was left", async () => {
    const out = process.env.X207_REHEARSAL_OUT;
    const steps: Array<{ step: string; account: string; method: string; hash: string }> = [];
    const record = () => out && writeFileSync(out, JSON.stringify({ contract: OWNER, usdt: USDT, note: "continuation of a rehearsal run that stopped after the clearing; hashes and names only", steps }, null, 2));
    const keysPath = join(secretsDir, `rehearsal-${OWNER.split(".")[0]}.json`);
    expect(existsSync(keysPath)).toBe(true);
    const saved = JSON.parse(readFileSync(keysPath, "utf8")) as Record<string, { tx: string }>;
    const ownerKey = (JSON.parse(readFileSync(join(secretsDir, `${OWNER}.json`), "utf8")) as { private_key: string }).private_key;
    const provider = new JsonRpcProvider({ url: RPC });
    const accountOf = (id: string, secret: string) => new Account(id, provider, KeyPairSigner.fromSecretKey(secret as never));
    const owner = accountOf(OWNER, ownerKey);
    const accounts = new Map(NAMES.map((n) => [`${n}.${OWNER}`, accountOf(`${n}.${OWNER}`, saved[n]!.tx)]));

    const rpc = (method: string, params: unknown) =>
      patient(async () => {
        const response = await within(`rpc ${method}`, 30_000, fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }));
        const body = (await response.json().catch(() => ({ error: `HTTP ${response.status}` }))) as { result?: any; error?: unknown };
        if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)} ${response.status}`);
        return body.result;
      });
    const view = async <T>(method: string, args: object = {}): Promise<T> => {
      const r = await rpc("query", { request_type: "call_function", finality: "optimistic", account_id: OWNER, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
      return JSON.parse(Buffer.from(r.result).toString("utf8")) as T;
    };
    const chainNowMs = async () => Number(BigInt((await rpc("block", { finality: "optimistic" })).header.timestamp_nanosec) / 1_000_000n);
    const send = async (account: Account, step: string, contractId: string, methodName: string, args: object, deposit = 0n): Promise<unknown> => {
      const r = (await patient(() => within(step, 120_000, account.callFunctionRaw({ contractId, methodName, args, deposit, gas: 150_000_000_000_000n, waitUntil: "FINAL" })))) as any;
      steps.push({ step, account: account.accountId, method: methodName, hash: r.transaction_outcome.id });
      record();
      const failed = [r.status, ...(r.receipts_outcome ?? []).map((o: any) => o.outcome.status)].find((s) => s && typeof s === "object" && "Failure" in s);
      if (failed) throw new Error(`${step} ${methodName}: ${JSON.stringify(failed).slice(0, 400)} (tx ${r.transaction_outcome.id})`);
      const value = r.status?.SuccessValue;
      return value ? JSON.parse(Buffer.from(value, "base64").toString("utf8")) : undefined;
    };
    const waitUntilChain = async (ns: string | null | undefined) => {
      const target = Number(BigInt(ns!) / 1_000_000n) + 2_000;
      while ((await chainNowMs()) < target) await sleep(10_000);
    };

    // the epoch with positions that is not finalized yet (or the last one with positions)
    const current = await view<{ epoch: number }>("get_epoch");
    type Position = { account_id: string; role: string; status: string; amount: string };
    let epoch = 0;
    for (let e = current.epoch; e >= 1; e -= 1) {
      const positions = await view<Position[]>("list_positions", { epoch: e, from_index: 0, limit: 50 });
      if (positions.length > 0) {
        epoch = e;
        break;
      }
    }
    expect(epoch).toBeGreaterThan(0);
    const epochOf = () => view<{ phase: string; payment_deadline: string | null }>("get_epoch", { epoch });
    const positionsOf = () => view<Position[]>("list_positions", { epoch, from_index: 0, limit: 50 });

    if ((await epochOf()).phase === "payment_window") {
      for (const d of (await positionsOf()).filter((p) => p.role === "debtor" && p.status === "due")) {
        await send(accounts.get(d.account_id)!, "settle residual", USDT, "ft_transfer_call", { receiver_id: OWNER, amount: d.amount, msg: JSON.stringify({ action: "settle", epoch }) }, 1n);
      }
      await waitUntilChain((await epochOf()).payment_deadline);
    }
    if ((await epochOf()).phase !== "finalized") await send(owner, "finalize_epoch", OWNER, "finalize_epoch", { epoch });
    expect((await epochOf()).phase).toBe("finalized");

    const creditors = (await positionsOf()).filter((p) => p.role === "creditor" && p.status === "claimable");
    expect(creditors.length).toBeGreaterThan(0);
    const claim = async (c: Position, step: string) => {
      await send(accounts.get(c.account_id)!, step, OWNER, "claim", { epoch, destination: "near" }, 1n);
      expect((await view<{ status: string }>("net_position", { epoch, account_id: c.account_id })).status).toBe("claimed");
    };
    for (const c of creditors.slice(0, -1)) await claim(c, "claim");

    const positionsBefore = await positionsOf();
    const obligationsBefore = await view<unknown[]>("list_obligations", { epoch, from_index: 0, limit: 100 });
    expect(obligationsBefore.length).toBeGreaterThan(0);
    let pruned = 0;
    for (let call = 0; call < 20; call += 1) {
      const n = (await send(accounts.get(`${NAMES[0]}.${OWNER}`)!, "prune_epoch", OWNER, "prune_epoch", { epoch, max_items: 20 })) as number;
      if (n === 0) break;
      pruned += n;
    }
    expect(pruned).toBeGreaterThan(0);
    expect(await view<unknown[]>("list_obligations", { epoch, from_index: 0, limit: 100 })).toEqual([]);
    expect(await positionsOf()).toEqual(positionsBefore);
    steps.push({ step: "prune_epoch", account: OWNER, method: `removed ${pruned} entries, ${obligationsBefore.length} obligations gone, ${positionsBefore.length} positions unchanged`, hash: "-" });
    await claim(creditors[creditors.length - 1]!, "claim after prune_epoch");
    record();
  }, 3_600_000);
});
