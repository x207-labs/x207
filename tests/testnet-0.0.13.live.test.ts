// CT-100: rehearsal of the interface 0.0.13 on NEAR testnet with the wasm of a LOCAL REPRODUCIBLE build (X207_WASM; the release workflow is held back). In a new circle with the Sputnik DAO as owner:
//   15 members, a complete graph of 210 edges (the proposal that failed in 0.0.12: `commit_epoch` could not log more than about 180), one epoch through `close_epoch`, `submit_clearing`,
//   `commit_epoch` and `finalize_epoch` on the real testnet; then `prune_epoch` too early must be refused with ERR_PRUNE_TOO_EARLY.
// Every transaction hash goes to X207_CT100_OUT (docs/testnet-0.0.13.json) from the first one on: names and hashes only, no keys. Testnet only; keys stay in .secrets/.
// Accounts first: node scripts/create-faucet-accounts.mjs --keys-dir ../../.secrets/testnet-deployer x207-v013.testnet x207-v013-aux.testnet
// Run: X207_TESTNET=1 X207_WASM=/path/x207_circle.wasm X207_CT100_OUT=$PWD/docs/testnet-0.0.13.json npx vitest run tests/testnet-0.0.13.live.test.ts
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createCircleViewFn, generateVoucherKeypair, onboardMember, signVoucher, type ContractCall } from "@x207/core";
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from "../backend/node_modules/near-api-js/lib/index.js";
import { Recorder, patient, sleep } from "./support/testnet-kit.ts";

const ENABLED = process.env.X207_TESTNET === "1";
const RPC = process.env.X207_TESTNET_RPC ?? "https://rpc.testnet.fastnear.com";
const CIRCLE = "x207-v013.testnet";
const AUX = "x207-v013-aux.testnet";
const DAO = "x207v8.sputnikv2.testnet";
const USDT = "usdt.x207-deployer.testnet";
const TERMS_HASH = "a".repeat(64);
const MEMBERS = 15;
const secretsDir = resolve("../../.secrets/testnet-deployer");
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const base58 = (hex: string): string => {
  let n = BigInt(`0x${hex}`);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  return out;
};

describe.skipIf(!ENABLED)("CT-100: interface 0.0.13 on testnet, an epoch of 210 edges", () => {
  it("deploys the local reproducible build, runs 210 edges through commit_epoch and finalize_epoch, and refuses an early prune", async () => {
    const wasmPath = process.env.X207_WASM ?? "";
    if (!wasmPath) throw new Error("X207_WASM must name the wasm of the reproducible build");
    const wasm = readFileSync(wasmPath);
    const wasmSha = createHash("sha256").update(wasm).digest("hex");
    const outPath = process.env.X207_CT100_OUT ?? resolve("docs/testnet-0.0.13.json");
    const recorder = new Recorder(outPath, { contract: CIRCLE, aux: AUX, owner: DAO, usdt: USDT, build: { source: "scripts/repro-build.sh 8799ebe, twice", wasmSha256: wasmSha, codeHash: base58(wasmSha) } });
    const provider = new JsonRpcProvider({ url: RPC });
    const keyOf = (id: string): string => {
      const file = join(secretsDir, "testnet", `${id}.json`);
      const j = JSON.parse(readFileSync(file, "utf8")) as { private_key?: string; secret_key?: string };
      return (j.private_key ?? j.secret_key) as string;
    };
    const accountOf = (id: string, secret: string) => new Account(id, provider, KeyPairSigner.fromSecretKey(secret as never));
    const owner = accountOf(CIRCLE, keyOf(CIRCLE));
    const aux = accountOf(AUX, keyOf(AUX));
    const keysPath = join(secretsDir, "um100-v013.json");
    const saved: Record<string, { tx: string; voucher: string }> = existsSync(keysPath) ? JSON.parse(readFileSync(keysPath, "utf8")) : {};

    const rpc = (method: string, params: unknown) =>
      patient(async () => {
        const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        const body = (await response.json().catch(() => ({ error: `HTTP ${response.status}` }))) as { result?: any; error?: unknown };
        if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)} ${response.status}`);
        return body.result;
      });
    const view = async <T>(contract: string, method: string, args: object = {}): Promise<T> => {
      const r = await rpc("query", { request_type: "call_function", finality: "optimistic", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
      return JSON.parse(Buffer.from(r.result).toString("utf8")) as T;
    };
    const hasCode = async (id: string): Promise<boolean> => ((await rpc("query", { request_type: "view_account", finality: "final", account_id: id })) as { code_hash: string }).code_hash !== "11111111111111111111111111111111";

    type Call = { receiverId: string; methodName: string; args: object; deposit?: bigint; gas?: bigint };
    /** Sends one call, records its hash, and returns the failures instead of throwing (some calls of the scenario are meant to fail). */
    const raw = async (account: Account, step: string, call: Call): Promise<{ failures: string[]; logs: string[]; value: unknown }> => {
      let r: any;
      try {
        r = (await patient(() =>
        account.callFunctionRaw({ contractId: call.receiverId, methodName: call.methodName, args: call.args, deposit: call.deposit ?? 0n, gas: call.gas ?? 150_000_000_000_000n, waitUntil: "FINAL" }),
      )) as any;
      } catch (error) {
        // the call itself panicked: the node throws; the refusal is the answer that the scenario wants
        const e = error as { message?: string; transaction_outcome?: { id?: string }; transaction?: { hash?: string } };
        const text = String(e.message ?? error);
        if (!/panicked|ContractExecutionError|Smart contract/.test(text)) throw error;
        const hash = e.transaction_outcome?.id ?? e.transaction?.hash;
        if (hash) recorder.add({ step: `${step} (refused)`, account: account.accountId, method: call.methodName, hash });
        return { failures: [text.slice(0, 300)], logs: [], value: undefined };
      }
      recorder.add({ step, account: account.accountId, method: call.methodName, hash: r.transaction_outcome.id });
      const failures = [r.status, ...(r.receipts_outcome ?? []).map((o: any) => o.outcome.status)]
        .filter((s) => s && typeof s === "object" && "Failure" in s)
        .map((s) => JSON.stringify(s).slice(0, 300));
      const logs = ((r.receipts_outcome ?? []) as any[]).flatMap((o) => o.outcome.logs as string[]);
      const sv = r.status?.SuccessValue;
      return { failures, logs, value: sv ? JSON.parse(Buffer.from(sv, "base64").toString("utf8")) : undefined };
    };
    const send = async (account: Account, step: string, call: Call): Promise<unknown> => {
      const r = await raw(account, step, call);
      if (r.failures.length > 0) throw new Error(`${step} ${call.methodName}: ${r.failures.join("; ")}`);
      return r.value;
    };
    const create = async (parent: Account, id: string, near: bigint, step: string): Promise<Account> => {
      if (!saved[id]) {
        saved[id] = { tx: KeyPair.fromRandom("ed25519").toString(), voucher: generateVoucherKeypair().secretKey };
        writeFileSync(keysPath, JSON.stringify(saved));
      }
      const exists = await rpc("query", { request_type: "view_account", finality: "final", account_id: id }).then(() => true, () => false);
      if (!exists) {
        const created = (await patient(() => parent.createAccount({ newAccountId: id, publicKey: KeyPair.fromString(saved[id]!.tx as never).getPublicKey(), nearToTransfer: near }))) as any;
        recorder.add({ step, account: parent.accountId, method: "create_account", hash: created.transaction_outcome.id });
        // the final block of the RPC node may not know the account yet
        for (let i = 0; i < 30; i += 1) {
          if (await rpc("query", { request_type: "view_account", finality: "final", account_id: id }).then(() => true, () => false)) break;
          await new Promise<void>((r) => setTimeout(r, 2000));
        }
      }
      return accountOf(id, saved[id]!.tx);
    };



    const hash64 = (text: string) => createHash("sha256").update(text).digest("hex");
    void hash64;
    // ---- members: sub-accounts of the aux account (it has the NEAR; the circle account holds the code)
    const names = Array.from({ length: MEMBERS }, (_, i) => `m${String(i).padStart(2, "0")}`);
    const ids = names.map((n) => `${n}.${AUX}`);
    const accounts: Account[] = [];
    for (const [i, id] of ids.entries()) accounts.push(await create(aux, id, 600_000_000_000_000_000_000_000n, `account ${names[i]}`));

    // ---- the circle: deploy the local build, init with the DAO as owner; short windows, fees on
    if (!(await hasCode(CIRCLE))) {
      const deployed = (await patient(() => owner.deployContract(wasm))) as any;
      recorder.add({ step: "deploy", account: CIRCLE, method: "deploy_contract", hash: deployed.transaction_outcome.id });
      await send(owner, "init", {
        receiverId: CIRCLE, methodName: "new",
        args: {
          owner_id: DAO, circle_id: "agents-main", usdt_token_id: USDT, intents_id: "intents.testnet",
          params: { epoch_length: 600, payment_window: 900, proposal_window: 60, base_limit_ratio: 8000, limit_growth: 1000, limit_cap: "1000000000", limit_decay: 0, fees: { clearing_fee_bps: 10, solver_fee_bps: 5 }, admission: "open" },
        },
      });
    }
    const codeHash = ((await rpc("query", { request_type: "view_account", finality: "final", account_id: CIRCLE })) as { code_hash: string }).code_hash;
    expect(codeHash).toBe(base58(wasmSha));
    expect(await view<string>(CIRCLE, "interface_version")).toBe("0.0.13");
    expect(await view<string>(CIRCLE, "get_owner")).toBe(DAO);
    const result: Record<string, unknown> = { codeHash };
    const finish = () => writeFileSync(outPath, JSON.stringify({ ...(JSON.parse(readFileSync(outPath, "utf8")) as Record<string, unknown>), result }, null, 2));

    // ---- join and stake, all members at the same time
    const circleView = createCircleViewFn({ circleContract: CIRCLE, rpcUrls: [RPC] });
    await Promise.all(
      accounts.map(async (account, i) => {
        const id = ids[i]!;
        const existing = await view<{ status: string } | null>(CIRCLE, "member", { account_id: id });
        if (existing?.status === "active") return;
        await send(account, `usdt ${names[i]}`, { receiverId: USDT, methodName: "mint", args: { account_id: id, amount: "300000000" } });
        const joined = await onboardMember(
          {
            sendCall: (c: ContractCall) => send(account, `onboard ${names[i]}`, { receiverId: c.receiverId, methodName: c.methodName, args: c.args, deposit: BigInt(c.deposit ?? 0), ...(c.gas ? { gas: BigInt(c.gas) } : {}) }),
            view: circleView, pollIntervalMs: 2000, timeoutMs: 180_000,
          },
          { circleContract: CIRCLE, circleId: "agents-main", accountId: id, termsHash: TERMS_HASH, stakeAmount: "100000000", secretKey: saved[id]!.voucher as `ed25519:${string}`, usdtTokenId: USDT },
        );
        expect(joined.member.status).toBe("active");
      }),
    );

    // ---- the epoch: every member owes each other member one credit (a complete graph, 15 x 14 = 210 edges, balanced), registered by the debtors in parallel
    const epoch = (await view<{ epoch: number }>(CIRCLE, "get_epoch")).epoch;
    // a resumed run uses the running epoch (epoch 1 of the first run was left without a proposal when its solver account ran out of NEAR)
    const t0 = Date.now();
    await Promise.all(
      accounts.map(async (account, i) => {
        for (let j = 0; j < MEMBERS; j += 1) {
          if (j === i) continue;
          const { signature, ...voucher } = signVoucher(
            { circle: CIRCLE, payer: ids[i]!, payee: ids[j]!, epoch, seq: 1, cumulativeAmount: "1000000", unit: "credit", resource: "https://x207.example/ct100" },
            saved[ids[i]!]!.voucher as `ed25519:${string}`,
          );
          await send(account, `register ${names[i]}->${names[j]}`, { receiverId: CIRCLE, methodName: "register_cumulative", args: { voucher, signature }, gas: 30_000_000_000_000n });
        }
      }),
    );
    const registered = await view<unknown[]>(CIRCLE, "list_obligations", { epoch, from_index: 0, limit: 300 });
    expect(registered).toHaveLength(MEMBERS * (MEMBERS - 1));
    result.edgesRegistered = { count: registered.length, seconds: Math.round((Date.now() - t0) / 1000) };
    finish();

    // ---- close, propose, commit, finalize: real time
    const waitUntilChain = async (ns: string) => {
      const target = Number(BigInt(ns) / 1_000_000n) + 2_000;
      while (Number(BigInt((await rpc("block", { finality: "optimistic" })).header.timestamp_nanosec) / 1_000_000n) < target) await sleep(8_000);
    };
    let current = await view<{ cutoff_at: string }>(CIRCLE, "get_epoch", { epoch });
    await waitUntilChain(current.cutoff_at);
    await send(owner, "close_epoch", { receiverId: CIRCLE, methodName: "close_epoch", args: { epoch }, gas: 200_000_000_000_000n });
    const edges = registered.map((o: any) => ({ debtor: o.debtor, creditor: o.creditor, cleared: "1000000" }));
    const solver = owner; // the circle account has the NEAR for the large gas
    await send(solver, "submit_clearing", { receiverId: CIRCLE, methodName: "submit_clearing", args: { epoch, edges }, gas: 250_000_000_000_000n });
    const proposal = await view<{ edge_count: number; proposal_hash: string }>(CIRCLE, "get_proposal", { epoch, from_index: 0, limit: 300 });
    expect(proposal.edge_count).toBe(210);
    current = await view<{ cutoff_at: string; proposal_deadline: string }>(CIRCLE, "get_epoch", { epoch });
    await waitUntilChain((current as any).proposal_deadline);
    const logsOf = async (hash: string, account: string) => {
      const r = (await rpc("tx", [hash, account])) as any;
      return (r.receipts_outcome as any[]).flatMap((o) => o.outcome.logs as string[]);
    };
    await send(owner, "commit_epoch", { receiverId: CIRCLE, methodName: "commit_epoch", args: { epoch }, gas: 300_000_000_000_000n });
    const commitStep = recorder.steps[recorder.steps.length - 1]!;
    const commitLogs = await logsOf(commitStep.hash, CIRCLE);
    const bytes = commitLogs.reduce((n, l) => n + l.length, 0);
    const applied = commitLogs.map((l) => JSON.parse(l.slice("EVENT_JSON:".length))).find((e) => e.event === "clearing_applied")!.data[0];
    expect(applied.edge_count).toBe(210);
    expect(applied.edges_hash).toBe(proposal.proposal_hash);
    expect(bytes).toBeLessThanOrEqual(14_745);
    result.commit = { hash: commitStep.hash, edgeCount: 210, logBytes: bytes, edgesHash: applied.edges_hash };
    finish();

    current = await view<{ payment_deadline: string }>(CIRCLE, "get_epoch", { epoch }) as any;
    await waitUntilChain((current as any).payment_deadline);
    await send(owner, "finalize_epoch", { receiverId: CIRCLE, methodName: "finalize_epoch", args: { epoch }, gas: 300_000_000_000_000n });
    const finalizeStep = recorder.steps[recorder.steps.length - 1]!;
    expect((await view<{ phase: string }>(CIRCLE, "get_epoch", { epoch })).phase).toBe("finalized");
    result.finalize = { hash: finalizeStep.hash };

    // ---- an early prune is refused: the running epoch is 2, the pruned epoch 1 and the delay 2
    const early = await raw(owner, "prune_epoch (too early)", { receiverId: CIRCLE, methodName: "prune_epoch", args: { epoch, max_items: 50 } });
    expect(early.failures.join(" ")).toContain("ERR_PRUNE_TOO_EARLY");
    result.pruneTooEarly = { refused: "ERR_PRUNE_TOO_EARLY", edgesStillReadable: ((await view<unknown[]>(CIRCLE, "list_obligations", { epoch, from_index: 0, limit: 300 })) as unknown[]).length };
    finish();
  }, 3_600_000);
});
