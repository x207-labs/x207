// UM-084: the ten on-chain kinds of batch 1 (catalog 1 to 10: NFT, ticket, game item, coupon, license, NEP-141, RWA, LST, Intents balance, pool share) bartered in ONE circle on NEAR
// testnet, with the wasm DOWNLOADED FROM THE RELEASE v0.0.11 (X207_RELEASE_WASM), not a local build. The scenario is the one of AG-023 (agents/test/batch1-scenario.ts): per kind
// `offer_grant`, the deposit of the asset into the escrow, `complete_escrow` with a voucher of the buyer, and the check on the side of the asset; then one invalid listing per group.
// Limit, written on purpose: the "Intents balance" kind runs with probes/mock_mt, not with the real Intents contract (intents.near has no testnet twin that we control), so the real
// Intents balance stays a sandbox test (`mock_intents`). The code_hash of the circle account is compared with the sha256 of the release wasm.
// Every transaction hash goes to X207_BATCH1_OUT (docs/testnet-batch1.json) from the first one on: names and hashes only, no keys. Testnet only; keys stay in .secrets/.
// Run: X207_TESTNET=1 X207_RELEASE_WASM=/path/x207-circle-v0.0.11.wasm X207_BATCH1_OUT=docs/testnet-batch1.json npx vitest run tests/testnet-batch1-v011.live.test.ts
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAssetTemplate, createCircleViewFn, generateVoucherKeypair, onboardMember, type ContractCall } from "@x207/core";
// @ts-expect-error script .mjs without types
import { CATALOG, registerCatalog } from "../scripts/lib/asset-catalog.mjs";
import { BATCH1_KINDS, batch1Inputs, runBatch1 } from "../agents/test/batch1-scenario.ts";
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from "../backend/node_modules/near-api-js/lib/index.js";
import { Recorder, patient } from "./support/testnet-kit.ts";

const ENABLED = process.env.X207_TESTNET === "1";
const RPC = process.env.X207_TESTNET_RPC ?? "https://rpc.testnet.fastnear.com";
const CIRCLE = "x207-b1-v011.testnet";
const AUX = "x207-b1-aux.testnet";
const USDT = "usdt.x207-deployer.testnet";
const TERMS_HASH = "a".repeat(64);
const STAKE = "50000000";
const NEAR = 10n ** 24n;
const secretsDir = resolve("../../.secrets/testnet-deployer");
const contractsDir = resolve("contracts/target/near");
const MOCK = { nft: "mock_nft/mock_nft.wasm", rwa: "mock_rwa/mock_rwa.wasm", mt: "mock_mt/mock_mt.wasm" };
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

describe.skipIf(!ENABLED)("UM-084: ten kinds of batch 1 in one circle on testnet, wasm of the release v0.0.11", () => {
  it("deploys the release, registers the kinds, onboards two members and runs the ten kinds", async () => {
    const wasmPath = process.env.X207_RELEASE_WASM ?? "";
    if (!wasmPath) throw new Error("X207_RELEASE_WASM must name the wasm downloaded from the release");
    const wasm = readFileSync(wasmPath);
    const wasmSha = createHash("sha256").update(wasm).digest("hex");
    const outPath = process.env.X207_BATCH1_OUT ?? resolve("docs/testnet-batch1.json");
    const recorder = new Recorder(outPath, {
      contract: CIRCLE, aux: AUX, usdt: USDT,
      release: { tag: "v0.0.11", wasmSha256: wasmSha, codeHash: base58(wasmSha), source: "gh release download v0.0.11 --repo x207-labs/contracts" },
      limits: ["the Intents balance kind runs with probes/mock_mt: the real Intents contract is only in the sandbox"],
    });
    const provider = new JsonRpcProvider({ url: RPC });
    const keyOf = (id: string): string => {
      const file = join(secretsDir, "testnet", `${id}.json`);
      const j = JSON.parse(readFileSync(file, "utf8")) as { private_key?: string; secret_key?: string };
      return (j.private_key ?? j.secret_key) as string;
    };
    const accountOf = (id: string, secret: string) => new Account(id, provider, KeyPairSigner.fromSecretKey(secret as never));
    const owner = accountOf(CIRCLE, keyOf(CIRCLE));
    const aux = accountOf(AUX, keyOf(AUX));
    const keysPath = join(secretsDir, "batch1-v011.json");
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
      const r = (await patient(() =>
        account.callFunctionRaw({ contractId: call.receiverId, methodName: call.methodName, args: call.args, deposit: call.deposit ?? 0n, gas: call.gas ?? 150_000_000_000_000n, waitUntil: "FINAL" }),
      )) as any;
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
    const deployMock = async (name: string, wasmFile: string, funding: bigint): Promise<Account> => {
      const id = `${name}.${AUX}`;
      const account = await create(aux, id, funding, `account ${name}`);
      if (!(await hasCode(id))) {
        const deployed = (await patient(() => account.deployContract(readFileSync(join(contractsDir, wasmFile))))) as any;
        recorder.add({ step: `deploy ${name}`, account: id, method: "deploy_contract", hash: deployed.transaction_outcome.id });
        await send(account, `init ${name}`, { receiverId: id, methodName: "new", args: {} });
      }
      return account;
    };

    // ---- the circle: the code of the release, then init (once)
    if (!(await hasCode(CIRCLE))) {
      const deployed = (await patient(() => owner.deployContract(wasm))) as any;
      recorder.add({ step: "deploy", account: CIRCLE, method: "deploy_contract", hash: deployed.transaction_outcome.id });
      await send(owner, "init", {
        receiverId: CIRCLE, methodName: "new",
        args: {
          owner_id: CIRCLE, circle_id: "agents-main", usdt_token_id: USDT, intents_id: "intents.testnet",
          params: { epoch_length: 86_400, payment_window: 900, proposal_window: 60, base_limit_ratio: 8000, limit_growth: 1000, limit_cap: "1000000000", limit_decay: 0, fees: { clearing_fee_bps: 0, solver_fee_bps: 0 }, admission: "open" },
        },
      });
    }
    const codeHash = ((await rpc("query", { request_type: "view_account", finality: "final", account_id: CIRCLE })) as { code_hash: string }).code_hash;
    expect(codeHash).toBe(base58(wasmSha));
    expect(await view<string>(CIRCLE, "interface_version")).toBe("0.0.11");

    // ---- the assets: one NFT contract, three NEP-141 contracts (the RWA one with a whitelist), one multi-token contract
    const nft = await deployMock("nft", MOCK.nft, 1_700_000_000_000_000_000_000_000n);
    const tokft = await deployMock("tokft", MOCK.rwa, 1_700_000_000_000_000_000_000_000n);
    const tokrwa = await deployMock("tokrwa", MOCK.rwa, 1_700_000_000_000_000_000_000_000n);
    const toklst = await deployMock("toklst", MOCK.rwa, 1_700_000_000_000_000_000_000_000n);
    const mt = await deployMock("mt", MOCK.mt, 1_800_000_000_000_000_000_000_000n);

    // ---- the registry: only the asset types that the ten kinds use
    const now = Math.floor(Date.now() / 1000);
    const world = { nft: nft.accountId, tokens: { ft: tokft.accountId, rwa: tokrwa.accountId, lst: toklst.accountId }, mt: mt.accountId };
    const needed = new Set(Object.values(batch1Inputs(world, now)).map((input) => buildAssetTemplate(input, now).assetType));
    const catalog = (CATALOG as Array<{ assetType: string }>).filter((e) => needed.has(e.assetType));
    expect(catalog.length).toBe(needed.size);
    const registered = await registerCatalog({
      view: (method: string, args: object) => view(CIRCLE, method, args),
      send: async ({ methodName, args }: { methodName: string; args: object }) => {
        await send(owner, `set_asset_class ${(args as { asset_type?: string }).asset_type ?? ""}`, { receiverId: CIRCLE, methodName, args, gas: 100_000_000_000_000n });
        return recorder.steps[recorder.steps.length - 1]!.hash;
      },
      catalog,
    });
    expect(registered).toMatchObject({ missing: [], wrong: [] });

    // ---- two members: created under the circle account, funded with mock USDT, joined and staked
    const members = {} as Record<"grantor" | "buyer", Account>;
    const circleView = createCircleViewFn({ circleContract: CIRCLE, rpcUrls: [RPC] });
    for (const name of ["grantor", "buyer"] as const) {
      const id = `${name}.${CIRCLE}`;
      members[name] = await create(owner, id, 700_000_000_000_000_000_000_000n, `account ${name}`);
      const existing = await view<{ status: string } | null>(CIRCLE, "member", { account_id: id });
      if (existing?.status !== "active") {
        await send(members[name], `usdt ${name}`, { receiverId: USDT, methodName: "mint", args: { account_id: id, amount: "1000000000" } });
        const joined = await onboardMember(
          {
            sendCall: (c: ContractCall) => send(members[name], `onboard ${name}`, { receiverId: c.receiverId, methodName: c.methodName, args: c.args, deposit: BigInt(c.deposit ?? 0), ...(c.gas ? { gas: BigInt(c.gas) } : {}) }),
            view: circleView, pollIntervalMs: 2000, timeoutMs: 120_000,
          },
          { circleContract: CIRCLE, circleId: "agents-main", accountId: id, termsHash: TERMS_HASH, stakeAmount: STAKE, secretKey: saved[id]!.voucher as `ed25519:${string}`, usdtTokenId: USDT },
        );
        expect(joined.member.status).toBe("active");
      }
    }

    // ---- the assets of the grantor
    const g = members.grantor.accountId;
    if ((await view<unknown>(nft.accountId, "nft_token", { token_id: "t1" })) === null) {
      for (const id of ["t1", "t2", "t3", "t4", "t5", "t6"]) await send(nft, `mint ${id}`, { receiverId: nft.accountId, methodName: "nft_mint", args: { token_id: id, owner_id: g } });
      for (const token of [tokft, tokrwa, toklst]) await send(token, `mint ${token.accountId}`, { receiverId: token.accountId, methodName: "mint", args: { account_id: g, amount: "100000000" } });
      await send(tokrwa, "whitelist on", { receiverId: tokrwa.accountId, methodName: "set_whitelist_on", args: { on: true } });
      for (const who of [CIRCLE, g, members.buyer.accountId]) await send(tokrwa, `whitelist ${who}`, { receiverId: tokrwa.accountId, methodName: "set_whitelisted", args: { account_id: who, whitelisted: true } });
      await send(mt, "mint intents balance", { receiverId: mt.accountId, methodName: "mint", args: { account_id: g, token_id: "nep141:usdt.tether-token.near", amount: "5000000" } });
      await send(mt, "mint pool share", { receiverId: mt.accountId, methodName: "mint", args: { account_id: g, token_id: "pool:1", amount: "1000" } });
    }

    // ---- the ten kinds
    const epoch = (await view<{ epoch: number }>(CIRCLE, "get_epoch")).epoch;
    const accounts = new Map<string, Account>([[g, members.grantor], [members.buyer.accountId, members.buyer]]);
    const steps = await runBatch1(
      {
        circle: CIRCLE, grantor: g, buyer: members.buyer.accountId, buyerVoucherKey: saved[members.buyer.accountId]!.voucher as `ed25519:${string}`, epoch,
        nft: nft.accountId, tokens: world.tokens, mt: mt.accountId,
        send: (account, c) => raw(accounts.get(account)!, `${c.methodName}`, { receiverId: c.receiverId, methodName: c.methodName, args: c.args as object, deposit: c.deposit ?? 0n, ...(c.gas ? { gas: c.gas } : {}) }),
        view: (contractId, method, args) => view(contractId, method, args as object),
      },
      now,
    );
    const header = JSON.parse(readFileSync(outPath, "utf8")) as Record<string, unknown>;
    writeFileSync(outPath, JSON.stringify({ ...header, codeHash, result: steps.map((s) => ({ kind: s.kind, step: s.step, ok: s.ok, detail: s.detail })) }, null, 2));
    for (const s of steps) console.log(`UM-084 ${s.kind} ${s.step}: ${s.ok ? "ok" : "FAILED"} (${s.detail})`);

    expect(steps.filter((s) => !s.ok), JSON.stringify(steps.filter((s) => !s.ok))).toEqual([]);
    for (const kind of BATCH1_KINDS) expect(steps.filter((s) => s.kind === kind).map((s) => s.step), kind).toEqual(["offer_grant", "deposit", "complete_escrow"]);
  }, 3_600_000);
});
