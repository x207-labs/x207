// CT-045 and CT-050 on NEAR testnet (not mainnet): a Sputnik DAO is created through the factory `sputnikv2.testnet`, a fresh x207 circle (0.0.9) is
// deployed with the DAO as `owner_id`, and one `set_params` proposal goes from `add_proposal` through two council votes to the new parameter in
// `get_params`. Every transaction hash goes to the file in X207_DAO_OUT. Mainnet is not touched; keys stay in .secrets/ and are never printed.
// Run: X207_TESTNET=1 X207_DAO_OUT=/path/out.json npx vitest run tests/testnet-dao.live.test.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildActProposalArgs, buildAddProposalArgs, buildCreateArgs, FACTORY_DEPOSIT } from "../contracts/dao/lib.mjs";
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from "../backend/node_modules/near-api-js/lib/index.js";

const ENABLED = process.env.X207_TESTNET === "1";
const RPC = process.env.X207_TESTNET_RPC ?? "https://rpc.testnet.fastnear.com";
const FACTORY = "sputnikv2.testnet";
const A = "x207-dao-v10.testnet";
const B = `b.${A}`;
const CIRCLE = "x207-circle-v10d.testnet";
const DAO_NAME = "x207v10";
const DAO = `${DAO_NAME}.${FACTORY}`;
const USDT = "usdt.x207-deployer.testnet";
const secretsDir = resolve("../../.secrets/testnet-deployer");
const NEAR = 10n ** 24n;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function patient<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const text = `${(error as Error).message} ${JSON.stringify((error as { cause?: unknown }).cause ?? "")}`;
      if (attempt >= 12 || !/429|rate limit/i.test(text)) throw error;
      await sleep(4000 + attempt * 2000);
    }
  }
}

describe.skipIf(!ENABLED)("CT-045 and CT-050 on testnet: DAO owns the circle and a set_params proposal takes effect", () => {
  it("creates the DAO, deploys the circle with the DAO as owner, and runs a proposal to the new parameter", async () => {
    const steps: Array<{ step: string; account: string; method: string; hash: string }> = [];
    const out = process.env.X207_DAO_OUT;
    const record = () => out && writeFileSync(out, JSON.stringify({ factory: FACTORY, dao: DAO, circle: CIRCLE, council: [A, B], steps }, null, 2));
    const provider = new JsonRpcProvider({ url: RPC });
    const keyOf = (account: string): string => (JSON.parse(readFileSync(join(secretsDir, `${account}.json`), "utf8")) as { private_key: string }).private_key;
    const savedPath = join(secretsDir, "dao-v10.json");
    const saved: { b?: string } = existsSync(savedPath) ? JSON.parse(readFileSync(savedPath, "utf8")) : {};
    const accountA = new Account(A, provider, KeyPairSigner.fromSecretKey(keyOf(A) as never));
    const accountZ = new Account(CIRCLE, provider, KeyPairSigner.fromSecretKey(keyOf(CIRCLE) as never));

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
    const chainNowMs = async () => Number(BigInt((await rpc("block", { finality: "optimistic" })).header.timestamp_nanosec) / 1_000_000n);
    const send = async (account: Account, step: string, contractId: string, methodName: string, args: object, deposit = 0n, gas = 150_000_000_000_000n): Promise<unknown> => {
      const r = (await patient(() => account.callFunctionRaw({ contractId, methodName, args, deposit, gas, waitUntil: "FINAL" }))) as any;
      steps.push({ step, account: account.accountId, method: methodName, hash: r.transaction_outcome.id });
      record();
      const failed = [r.status, ...(r.receipts_outcome ?? []).map((o: any) => o.outcome.status)].find((s) => s && typeof s === "object" && "Failure" in s);
      if (failed) throw new Error(`${step} ${methodName}: ${JSON.stringify(failed).slice(0, 400)} (tx ${r.transaction_outcome.id})`);
      const value = r.status?.SuccessValue;
      return value ? JSON.parse(Buffer.from(value, "base64").toString("utf8")) : undefined;
    };

    // council member B: a sub-account of A with its own key
    let accountB: Account;
    if (!saved.b) {
      const key = KeyPair.fromRandom("ed25519");
      const created = (await patient(() => accountA.createAccount({ newAccountId: B, publicKey: key.getPublicKey(), nearToTransfer: NEAR / 2n }))) as any;
      steps.push({ step: "council member", account: A, method: "create_account", hash: created.transaction_outcome.id });
      saved.b = key.toString();
      writeFileSync(savedPath, JSON.stringify(saved));
    }
    accountB = new Account(B, provider, KeyPairSigner.fromSecretKey(saved.b as never));

    // the DAO through the factory, council A and B, proposal period one hour
    const existing = await view<unknown>(DAO, "get_policy").then((p) => p, () => null);
    if (existing === null) {
      const created = buildCreateArgs({ name: DAO_NAME, council: [A, B] });
      await send(accountA, "create DAO", FACTORY, "create", created, 7n * NEAR, 300_000_000_000_000n);
    }
    const policy = await view<{ proposal_period: string; roles: Array<{ name: string; kind: unknown }> }>(DAO, "get_policy");
    expect(policy.proposal_period).toBe("3600000000000");
    expect(JSON.stringify(policy.roles.find((r) => r.name === "council")!.kind)).toContain(B);
    expect(FACTORY_DEPOSIT).toBe("7 NEAR");

    // a fresh circle 0.0.9 whose owner is the DAO
    const initialized = await view(CIRCLE, "get_circle").then(() => true, () => false);
    if (!initialized) {
      const deploy = (await patient(() => accountZ.deployContract(readFileSync(resolve("contracts/target/near/x207_circle.wasm"))))) as any;
      steps.push({ step: "deploy circle", account: CIRCLE, method: "deploy_contract", hash: deploy.transaction_outcome.id });
      await send(accountZ, "init circle", CIRCLE, "new", {
        owner_id: DAO, circle_id: "agents-main", usdt_token_id: USDT, intents_id: "intents.testnet",
        params: { epoch_length: 600, payment_window: 900, proposal_window: 60, base_limit_ratio: 8000, limit_growth: 1000, limit_cap: "1000000000", limit_decay: 0, fees: { clearing_fee_bps: 0, solver_fee_bps: 0 }, admission: "open" },
      }, 0n, 100_000_000_000_000n);
    }
    expect(await view<string>(CIRCLE, "get_owner")).toBe(DAO);
    expect(await view<string>(CIRCLE, "interface_version")).toBe("0.0.9");

    // the proposal: set_params with limit_decay 100
    const current = await view<Record<string, unknown>>(CIRCLE, "get_params");
    expect(current.limit_decay).toBe(0);
    const proposal = buildAddProposalArgs({ contract: CIRCLE, params: { ...current, limit_decay: 100 }, description: "x207 testnet rehearsal: limit_decay 100" });
    const id = (await send(accountA, "add_proposal", DAO, "add_proposal", proposal, NEAR / 10n, 100_000_000_000_000n)) as number;
    const stranger = await send(accountZ, "vote by a non-member", DAO, "act_proposal", buildActProposalArgs({ id, action: "VoteApprove" }), 0n, 100_000_000_000_000n).then(() => "accepted", () => "refused");
    expect(stranger).toBe("refused");
    await send(accountA, "vote A", DAO, "act_proposal", buildActProposalArgs({ id, action: "VoteApprove" }), 0n, 200_000_000_000_000n);
    expect((await view<{ status: string }>(DAO, "get_proposal", { id })).status).toBe("InProgress");
    await send(accountB, "vote B", DAO, "act_proposal", buildActProposalArgs({ id, action: "VoteApprove" }), 0n, 200_000_000_000_000n);
    expect((await view<{ status: string }>(DAO, "get_proposal", { id })).status).toBe("Approved");
    const pending = await view<{ params: { limit_decay: number }; effective_epoch: number } | null>(CIRCLE, "get_pending_params");
    expect(pending?.params.limit_decay).toBe(100);

    // set_params is effective from the next epoch: close the running one (the keeper step) and read the active parameters
    const epoch = await view<{ epoch: number; cutoff_at: string }>(CIRCLE, "get_epoch");
    const cutoffMs = Number(BigInt(epoch.cutoff_at) / 1_000_000n) + 2_000;
    while ((await chainNowMs()) < cutoffMs) await sleep(10_000);
    await send(accountZ, "close_epoch (keeper)", CIRCLE, "close_epoch", { epoch: epoch.epoch }, 0n, 250_000_000_000_000n);
    expect((await view<{ limit_decay: number }>(CIRCLE, "get_params")).limit_decay).toBe(100);
    expect(await view<string>(CIRCLE, "get_owner")).toBe(DAO);
    steps.push({ step: "summary", account: DAO, method: `proposal ${id} approved, get_params.limit_decay = 100 from epoch ${epoch.epoch + 1}`, hash: "-" });
    record();
  }, 2_400_000);
});
