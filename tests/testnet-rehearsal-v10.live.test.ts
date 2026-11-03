// Gladi on NEAR testnet (not the sandbox): contract 0.0.9 on x207-circle-v10.testnet, five member accounts, the real backend (indexer fed from the receipts of each transaction,
// read API, marketplace book) on this machine, the solver CLI. Barter: a ring of three intents (F5) and the quick barter with cashback and a seeker
// share (F9: pay and barter paths), commit_bundle, register_in_bundle, clearing (close, solver, commit), residual payment, finalize, claims. Real time:
// an epoch of 10 minutes, 1 minute to propose, 15 minutes of payment window. Every transaction hash is written to the file in X207_REHEARSAL_OUT.
// Intents is not part of it (intents.testnet has no code). Testnet only; the keys stay in .secrets/ and are never printed.
// Run: X207_TESTNET=1 X207_REHEARSAL_OUT=/path/out.json npx vitest run tests/testnet-rehearsal.live.test.ts
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { bundleInput, createCircleViewFn, generateVoucherKeypair, onboardMember, voucherPublicKey, parseEventLog, signVoucher, termsHash, type BundleTerms, type ContractAbi, type ContractCall } from "@x207/core";
import { Indexer, createApiServer, openDatabase, type BlockLog, type BlockSource, type SourceBlock } from "../backend/src/index.ts";
import { marketplaceRoutes } from "../backend/src/marketplace/index.ts";
import { collectBundleSignatures, cycleTerms, findIntentCycles, loadOpenIntents } from "../solver/src/barter/index.ts";
import { QUICK_PARAMS, runQuickBarter } from "../agents/scenario/quick.ts";
import { CALL_PRICE } from "../agents/scenario/ring.ts";
import { BarterAgent, BookClient } from "../agents/shared/barter.ts";
import type { AgentIdentity } from "../agents/shared/identity.ts";
import { keeperPass } from "../scripts/lib/keeper.mjs";
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from "../backend/node_modules/near-api-js/lib/index.js";

const ENABLED = process.env.X207_TESTNET === "1";
const run = promisify(execFile);
const RPC = process.env.X207_TESTNET_RPC ?? "https://rpc.testnet.fastnear.com";

const OWNER = "x207-circle-v10.testnet";
const USDT = "usdt.x207-deployer.testnet";
const NAMES = ["andi", "budi", "citra", "dewi", "eka"] as const;
type Name = (typeof NAMES)[number];
const TERMS_HASH = "a".repeat(64);
const STAKE = "150000000";
const secretsDir = resolve("../../.secrets/testnet-deployer");
const CREDIT = 1_000_000n;
/**
 * The free testnet endpoints (fastnear RPC and neardata) limit the rate far below one block a second, so the indexer cannot follow every block.
 * This source is told about each transaction that the rehearsal sends, reads its receipts once (`tx`, and `block` for the header of each block
 * they ran in) and serves only those blocks; the heights in between are skipped blocks. The events are the real ones from the chain.
 */
class TxFeedSource implements BlockSource {
  readonly endpoint = "tx-feed";
  readonly #blocks = new Map<number, SourceBlock>();
  readonly #headers = new Map<string, { height: number; timestampNs: bigint }>();
  #head: number;

  constructor(readonly contractId: string, startHeight: number, private readonly rpc: (method: string, params: unknown) => Promise<any>) {
    this.#head = startHeight;
  }

  async finalHeight(): Promise<number> {
    return this.#head;
  }

  async getBlock(height: number): Promise<SourceBlock | null> {
    return this.#blocks.get(height) ?? null;
  }

  /** Reads the receipts of a finished transaction and adds the logs that the contract wrote. */
  async add(txHash: string, signer: string): Promise<void> {
    const result = await this.rpc("tx", { tx_hash: txHash, sender_account_id: signer, wait_until: "FINAL" });
    for (const outcome of result.receipts_outcome as Array<any>) {
      if (outcome.outcome.executor_id !== this.contractId || outcome.outcome.logs.length === 0) continue;
      const hash: string = outcome.block_hash;
      let header = this.#headers.get(hash);
      if (!header) {
        const block = await this.rpc("block", { block_id: hash });
        header = { height: block.header.height, timestampNs: BigInt(block.header.timestamp_nanosec) };
        this.#headers.set(hash, header);
      }
      const block = this.#blocks.get(header.height) ?? { height: header.height, hash, timestampNs: header.timestampNs, logs: [] as BlockLog[] };
      (outcome.outcome.logs as string[]).forEach((log, logIndex) => block.logs.push({ receiptId: outcome.id, logIndex, executorId: this.contractId, txHash, log }));
      this.#blocks.set(header.height, block);
      this.#head = Math.max(this.#head, header.height);
    }
  }
}

/** The free endpoints answer 429 when they are asked too often: wait and ask again. A 429 is refused before the node touches the transaction. */
async function patient<T>(what: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const text = `${(error as Error).message} ${JSON.stringify((error as { cause?: unknown }).cause ?? "")}`;
      if (attempt >= 12 || !/429|rate limit/i.test(text)) throw error;
      await new Promise<void>((r) => setTimeout(r, 4000 + attempt * 2000));
      void what;
    }
  }
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe.skipIf(!ENABLED)("rehearsal on testnet: contract 0.0.9, barter, clearing, claims", () => {
  let api: Server | undefined;
  const steps: Array<{ step: string; account: string; method: string; hash: string }> = [];
  const out = process.env.X207_REHEARSAL_OUT;
  afterAll(() => {
    api?.closeAllConnections?.();
    api?.close();
    if (out) writeFileSync(out, JSON.stringify({ contract: OWNER, usdt: USDT, steps }, null, 2));
  });

  it("deploys 0.0.9, onboards five members, runs two bundles through one epoch and pays out", async () => {
    // ---- keys: the owner key comes from .secrets, the agent keys are made here and kept there
    const ownerKey = (JSON.parse(readFileSync(join(secretsDir, `${OWNER}.json`), "utf8")) as { private_key: string }).private_key;
    const keysPath = join(secretsDir, "rehearsal-v10.json");
    const saved: Record<string, { tx: string; voucher: string }> = existsSync(keysPath) ? JSON.parse(readFileSync(keysPath, "utf8")) : {};
    const provider = new JsonRpcProvider({ url: RPC });
    const accountOf = (id: string, secret: string) => new Account(id, provider, KeyPairSigner.fromSecretKey(secret as never));
    const owner = accountOf(OWNER, ownerKey);

    const rpc = async (method: string, params: unknown) => {
      return patient(method, async () => {
        const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        const body = (await response.json().catch(() => ({ error: `HTTP ${response.status}` }))) as { result?: any; error?: unknown };
        if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)} ${response.status}`);
        return body.result;
      });
    };
    const view = async <T>(contract: string, method: string, args: object = {}): Promise<T> => {
      const r = await rpc("query", { request_type: "call_function", finality: "optimistic", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
      return JSON.parse(Buffer.from(r.result).toString("utf8")) as T;
    };
    const chainNowMs = async () => Number(BigInt((await rpc("block", { finality: "optimistic" })).header.timestamp_nanosec) / 1_000_000n);

    let feed: TxFeedSource | undefined;
    type Call = { receiverId: string; methodName: string; args: object; deposit?: bigint; gas?: bigint };
    const send = async (account: Account, step: string, call: Call): Promise<unknown> => {
      const r = (await patient(step, () =>
        account.callFunctionRaw({
          contractId: call.receiverId, methodName: call.methodName, args: call.args, deposit: call.deposit ?? 0n, gas: call.gas ?? 150_000_000_000_000n, waitUntil: "FINAL",
        }),
      )) as any;
      const failed = [r.status, ...(r.receipts_outcome ?? []).map((o: any) => o.outcome.status)].find((s) => s && typeof s === "object" && "Failure" in s);
      const hash: string = r.transaction_outcome.id;
      steps.push({ step, account: account.accountId, method: call.methodName, hash });
      if (out) writeFileSync(out, JSON.stringify({ contract: OWNER, usdt: USDT, steps }, null, 2));
      await feed?.add(hash, account.accountId);
      if (failed) throw new Error(`${step} ${call.methodName}: ${JSON.stringify(failed).slice(0, 400)} (tx ${hash})`);
      const value = r.status?.SuccessValue;
      return value ? JSON.parse(Buffer.from(value, "base64").toString("utf8")) : undefined;
    };
    const logs = async (hash: string, account: string) => {
      const r = (await rpc("tx", [hash, account])) as any;
      return (r.receipts_outcome as any[]).flatMap((o) => o.outcome.logs as string[]).flatMap((l) => (parseEventLog(l) ?? []) as Array<Record<string, any> & { event: string }>);
    };

    // ---- deploy 0.0.9 and init (once)
    const wasmPath = resolve("contracts/target/near/x207_circle.wasm");
    let deployedBlock = Number(saved.__block?.tx ?? 0);
    const initialized = await view(OWNER, "get_circle").then(() => true, () => false);
    if (!initialized) {
      deployedBlock = Number((await rpc("status", [])).sync_info.latest_block_height) - 3;
      const deploy = (await owner.deployContract(readFileSync(wasmPath))) as any;
      steps.push({ step: "deploy", account: OWNER, method: "deploy_contract", hash: deploy.transaction_outcome.id });
      await send(owner, "init", {
        receiverId: OWNER, methodName: "new",
        args: {
          owner_id: OWNER, circle_id: "agents-main", usdt_token_id: USDT, intents_id: "intents.testnet",
          params: { epoch_length: 600, payment_window: 900, proposal_window: 60, base_limit_ratio: 8000, limit_growth: 1000, limit_cap: "1000000000", limit_decay: 0, fees: { clearing_fee_bps: 0, solver_fee_bps: 0 }, admission: "open" },
        },
      });
      saved.__block = { tx: String(deployedBlock), voucher: "" };
      writeFileSync(keysPath, JSON.stringify(saved));
    }
    expect((await view<{ contract_id: string }>(OWNER, "get_circle")).contract_id).toBe(OWNER);
    expect(await view<string>(OWNER, "interface_version")).toBe("0.0.9");

    // ---- five member accounts: created, funded with mock USDT, joined and staked
    const circleView = createCircleViewFn({ circleContract: OWNER, rpcUrls: [RPC] });
    const accounts = {} as Record<Name, Account>;
    const identity = {} as Record<Name, AgentIdentity>;
    for (const name of NAMES) {
      const id = `${name}.${OWNER}`;
      if (!saved[name]) {
        const tx = KeyPair.fromRandom("ed25519");
        const voucher = generateVoucherKeypair();
        const created = (await owner.createAccount({ newAccountId: id, publicKey: tx.getPublicKey(), nearToTransfer: 250_000_000_000_000_000_000_000n })) as any;
        steps.push({ step: "account", account: OWNER, method: "create_account", hash: created.transaction_outcome.id });
        saved[name] = { tx: tx.toString(), voucher: voucher.secretKey };
        writeFileSync(keysPath, JSON.stringify(saved));
      }
      accounts[name] = accountOf(id, saved[name]!.tx);
    }
    for (const name of NAMES) {
      const account = accounts[name];
      const existing = await view<{ status: string } | null>(OWNER, "member", { account_id: account.accountId });
      if (existing?.status !== "active") {
        await send(account, "usdt", { receiverId: USDT, methodName: "mint", args: { account_id: account.accountId, amount: (1000n * CREDIT).toString() } });
        const joined = await onboardMember(
          {
            sendCall: (c: ContractCall) => send(account, "onboard", { receiverId: c.receiverId, methodName: c.methodName, args: c.args, deposit: BigInt(c.deposit ?? 0), ...(c.gas ? { gas: BigInt(c.gas) } : {}) }),
            view: circleView, pollIntervalMs: 2000, timeoutMs: 120_000,
          },
          { circleContract: OWNER, circleId: "agents-main", accountId: account.accountId, termsHash: TERMS_HASH, stakeAmount: STAKE, secretKey: saved[name]!.voucher as `ed25519:${string}`, usdtTokenId: USDT },
        );
        expect(joined.member.status).toBe("active");
      }
      identity[name] = {
        accountId: account.accountId, voucherSecretKey: saved[name]!.voucher as `ed25519:${string}`, voucherPublicKey: voucherPublicKey(saved[name]!.voucher as `ed25519:${string}`),
        policy: { maxPerCall: "1000000000", maxPerEpoch: "1000000000" },
      };
    }

    feed = new TxFeedSource(OWNER, Number((await rpc("status", [])).sync_info.latest_block_height), rpc);
    const feedStart = Number((await rpc("status", [])).sync_info.latest_block_height);

    // ---- keeper helpers (the owner account runs them) and a guard: a fresh epoch needs at least 6 minutes before its cutoff
    const keeper = () =>
      keeperPass({
        log: () => {}, view: (m: string, a: object) => view(OWNER, m, a), chainNowMs,
        send: async ({ methodName, args }: { methodName: string; args: object }) => {
          await send(owner, `keeper ${methodName}`, { receiverId: OWNER, methodName, args, gas: 250_000_000_000_000n });
          return steps[steps.length - 1]!.hash;
        },
      }) as Promise<Array<{ method: string; epoch: number }>>;
    const epochView = (n: number) => view<ContractAbi.EpochView>(OWNER, "get_epoch", { epoch: n });
    const waitUntilChain = async (ns: string | null | undefined) => {
      const target = Number(BigInt(ns!) / 1_000_000n) + 2_000;
      while ((await chainNowMs()) < target) await sleep(10_000);
    };
    {
      const current = await view<ContractAbi.EpochView>(OWNER, "get_epoch");
      if (Number(BigInt(current.cutoff_at) / 1_000_000n) - (await chainNowMs()) < 360_000) {
        await waitUntilChain(current.cutoff_at);
        await keeper();
      }
    }

    // ---- backend on this machine: indexer fed from the transactions, read API, book
    const db = openDatabase(":memory:");
    const indexer = new Indexer({
      db, source: feed, circleId: "agents-main", contractId: OWNER, startBlock: feedStart, fetchParams: () => view<ContractAbi.Params>(OWNER, "get_params"),
    });
    await indexer.bootstrap();
    // members joined before the feed started: seed them from the views of the contract (the same data the events carry)
    for (const name of NAMES) {
      const m = await view<ContractAbi.MemberView>(OWNER, "member", { account_id: accounts[name].accountId });
      db.prepare(
        `INSERT OR REPLACE INTO members (circle_id, account_id, pubkey_voucher, terms_hash, stake, credit_limit, outstanding_debt, status, admitted, settled_history, joined_at_ns, updated_block)
         VALUES ('agents-main', ?, ?, ?, ?, ?, 0, ?, 0, 0, ?, ?)`,
      ).run(m.account_id, m.pubkey_voucher, m.terms_hash, m.stake, m.limit, m.status, m.joined_at, feedStart);
    }
    const API_NOW = () => Date.now();
    api = createApiServer({ db, now: API_NOW, extraRoutes: marketplaceRoutes(db, { chainView: (contractId, method, args) => view(contractId, method, args as object) }) });
    await new Promise<void>((r) => api!.listen(0, "127.0.0.1", r));
    const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    const catchUp = async (done: () => boolean, seconds = 120) => {
      for (let i = 0; i < seconds / 2; i++) {
        try {
          await indexer.drain();
          if (done()) return;
        } catch (error) {
          if (!/rate limit|429|All RPC endpoints failed/i.test(String((error as Error).message))) throw error;
          await sleep(5000); // the free endpoints limit the rate: wait and go on from the same block
        }
        await sleep(2000);
      }
      throw new Error(`indexer did not catch up in ${seconds}s`);
    };
    const count = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);
    const phaseOf = () => (db.prepare("select phase from epochs where epoch = ?").get(epoch) as { phase: string } | undefined)?.phase;
    await catchUp(() => count("select count(*) as n from members where status = 'active'") >= 5);
    const epoch = (await view<ContractAbi.EpochView>(OWNER, "get_epoch")).epoch;
    const book = new BookClient({ baseUrl: apiUrl, circleId: "agents-main" });
    const id = identity;
    const bundles: Array<{ name: string; terms: BundleTerms; signatures: Array<{ account_id: string; signature: string }> }> = [];

    // ---- F9 quick barter 100 / 10 / 3: andi sells, budi pays, citra barters, dewi seeks, eka is a bystander
    const quick = await runQuickBarter({
      book, contractId: OWNER, now: () => Math.floor(Date.now() / 1000), params: QUICK_PARAMS,
      identities: { seller: id.andi, payer: id.budi, barterer: id.citra, seeker: id.dewi, bystander: id.eka },
    });
    expect(quick.pay).toMatchObject({ status: "ready", counterpartyPays: String(93 * 1_000_000) });
    expect(quick.barter).toMatchObject({ status: "ready" });
    expect(quick.seekerRevenue).toBe(String(6 * 1_000_000));
    const ready = new Map<string, any>();
    for (const n of ["andi", "budi", "citra"] as const) for (const p of await book.proposals(id[n].accountId, "ready")) ready.set(p.termsHash, p);
    expect(ready.size).toBe(2);
    for (const p of ready.values()) bundles.push({ name: `quick-${p.termsHash.slice(0, 6)}`, terms: p.terms, signatures: p.signatures.map((s: any) => ({ account_id: s.account, signature: s.signature })) });

    // ---- F5 ring citra -> dewi -> eka -> citra (no pair shared with the quick barter)
    const ringNames = ["citra", "dewi", "eka"] as const;
    const agents = new Map(ringNames.map((n) => [n, new BarterAgent({ identity: id[n], book, contractId: OWNER, now: () => Math.floor(Date.now() / 1000) })]));
    const services = { citra: "scrape", dewi: "image", eka: "translate" } as const;
    const side = (n: keyof typeof services) => ({ service: services[n], calls: 5, value: String(5 * CALL_PRICE) });
    for (const [i, n] of ringNames.entries()) await agents.get(n)!.postIntent(side(n), side(ringNames[(i + 1) % ringNames.length]!));
    const open = await loadOpenIntents({ readApiUrl: apiUrl, circle: "agents-main" });
    const [cycle] = findIntentCycles(open);
    expect(cycle!.members).toHaveLength(3);
    const { terms: ringTerms, termsHash: ringHash } = cycleTerms(cycle!, OWNER, epoch);
    const pubkeys = Object.fromEntries(ringNames.map((n) => [id[n].accountId, id[n].voucherPublicKey]));
    const byAccount = new Map(ringNames.map((n) => [id[n].accountId, agents.get(n)!]));
    const collected = await collectBundleSignatures(ringTerms, pubkeys, async (account) => byAccount.get(account)!.signTerms(ringTerms));
    expect(collected).not.toBeNull();
    expect(termsHash(collected!.terms)).toBe(ringHash);
    bundles.push({ name: "ring", terms: ringTerms, signatures: collected!.signatures.map((s) => ({ account_id: s.account, signature: s.signature })) });

    // ---- commit_bundle from the owner account (permissionless) and the legs paid with vouchers of the bundle
    const committed = new Map<string, number>();
    for (const bundle of bundles) {
      const hash = steps.length;
      await send(owner, `commit_bundle ${bundle.name}`, { receiverId: OWNER, methodName: "commit_bundle", args: { bundle: bundleInput(bundle.terms), signatures: bundle.signatures }, gas: 200_000_000_000_000n });
      const events = await logs(steps[hash]!.hash, OWNER);
      committed.set(bundle.name, Number(events.find((e) => e.event === "bundle_committed")!.bundle_id));
    }
    const nameOf = new Map(NAMES.map((n) => [id[n].accountId, n]));
    const net = new Map<string, bigint>();
    for (const bundle of bundles) {
      for (const leg of bundle.terms.legs) {
        const payer = nameOf.get(leg.payer)!;
        const { signature, ...voucher } = signVoucher(
          { circle: OWNER, payer: leg.payer, payee: leg.payee, epoch, seq: 1, cumulativeAmount: leg.max_amount, unit: "credit", resource: `x207:bundle:${committed.get(bundle.name)}` },
          id[payer].voucherSecretKey,
        );
        await send(accounts[payer], `leg ${bundle.name}`, {
          receiverId: OWNER, methodName: "register_in_bundle", args: { bundle_id: committed.get(bundle.name), voucher, signature }, gas: 100_000_000_000_000n,
        });
        net.set(leg.payer, (net.get(leg.payer) ?? 0n) - BigInt(leg.max_amount));
        net.set(leg.payee, (net.get(leg.payee) ?? 0n) + BigInt(leg.max_amount));
      }
    }

    await waitUntilChain((await epochView(epoch)).cutoff_at);
    expect((await keeper()).filter((a) => a.epoch === epoch).map((a) => a.method)).toEqual(["close_epoch"]);
    await catchUp(() => phaseOf() !== "open");
    const solverEnv = { PATH: process.env.PATH, X207_READ_API_URL: apiUrl, X207_CIRCLE_ID: "agents-main", NEAR_RPC_URL: RPC, X207_CONTRACT_ID: OWNER, SOLVER_ACCOUNT_ID: OWNER, SOLVER_PRIVATE_KEY: ownerKey };
    const solver = await run("node", ["solver/dist/cli.js", "--epoch", String(epoch)], { env: solverEnv as NodeJS.ProcessEnv });
    steps.push({ step: "solver submit_clearing", account: OWNER, method: "submit_clearing", hash: (solver.stderr.match(/[1-9A-HJ-NP-Za-km-z]{43,44}/) ?? ["see stderr"])[0]! });
    await waitUntilChain((await epochView(epoch)).proposal_deadline);
    expect((await keeper()).filter((a) => a.epoch === epoch).map((a) => a.method)).toEqual(["commit_epoch"]);
    await catchUp(() => ["payment_window", "finalized"].includes(phaseOf() ?? ""));

    // ---- residual: every net debtor pays what is due; then finalize at the payment deadline, then the creditors claim
    const positions = await view<Array<{ account_id: string; role: string; status: string; amount: string }>>(OWNER, "list_positions", { epoch, from_index: 0, limit: 50 });
    const debtors = positions.filter((p) => p.role === "debtor" && p.status === "due");
    const creditors = positions.filter((p) => p.role === "creditor" && p.status === "claimable");
    expect(positions.length).toBeGreaterThan(0);
    for (const d of debtors) {
      await send(accounts[nameOf.get(d.account_id)!]!, "settle residual", {
        receiverId: USDT, methodName: "ft_transfer_call", args: { receiver_id: OWNER, amount: d.amount, msg: JSON.stringify({ action: "settle", epoch }) }, deposit: 1n, gas: 150_000_000_000_000n,
      });
    }
    for (const d of debtors) expect((await view<{ status: string }>(OWNER, "net_position", { epoch, account_id: d.account_id })).status).toBe("paid");
    await waitUntilChain((await epochView(epoch)).payment_deadline);
    expect((await keeper()).filter((a) => a.epoch === epoch).map((a) => a.method)).toEqual(["finalize_epoch"]);
    // the last creditor waits: prune_epoch runs after the other claims, and the claim that was not taken must still work afterwards
    const claimNow = creditors.slice(0, -1);
    const claimLater = creditors.slice(-1);
    for (const c of claimNow) {
      await send(accounts[nameOf.get(c.account_id)!]!, "claim", { receiverId: OWNER, methodName: "claim", args: { epoch, destination: "near" }, deposit: 1n, gas: 150_000_000_000_000n });
      expect((await view<{ status: string }>(OWNER, "net_position", { epoch, account_id: c.account_id })).status).toBe("claimed");
    }
    // ---- prune_epoch (0.0.8): anybody; D2/D3 entries of the finalized epoch go, the positions stay
    const positionsBefore = await view<unknown[]>(OWNER, "list_positions", { epoch, from_index: 0, limit: 50 });
    const obligationsBefore = await view<unknown[]>(OWNER, "list_obligations", { epoch, from_index: 0, limit: 100 });
    expect(obligationsBefore.length).toBeGreaterThan(0);
    let pruned = 0;
    for (let call = 0; call < 20; call += 1) {
      const n = (await send(accounts[NAMES[0]]!, "prune_epoch", { receiverId: OWNER, methodName: "prune_epoch", args: { epoch, max_items: 20 }, gas: 200_000_000_000_000n })) as number;
      if (n === 0) break;
      pruned += n;
    }
    expect(pruned).toBeGreaterThan(0);
    expect(await view<unknown[]>(OWNER, "list_obligations", { epoch, from_index: 0, limit: 100 })).toEqual([]);
    expect(await view<unknown[]>(OWNER, "list_positions", { epoch, from_index: 0, limit: 50 })).toEqual(positionsBefore);
    steps.push({ step: "prune_epoch", account: OWNER, method: `removed ${pruned} entries, ${obligationsBefore.length} obligations gone, ${positionsBefore.length} positions unchanged`, hash: "-" });
    for (const c of claimLater) {
      await send(accounts[nameOf.get(c.account_id)!]!, "claim after prune_epoch", { receiverId: OWNER, methodName: "claim", args: { epoch, destination: "near" }, deposit: 1n, gas: 150_000_000_000_000n });
      expect((await view<{ status: string }>(OWNER, "net_position", { epoch, account_id: c.account_id })).status).toBe("claimed");
    }
    // the net position of every member equals the difference of its registered legs
    for (const [account, expected] of net) {
      const p = positions.find((x) => x.account_id === account);
      if (expected === 0n) continue;
      expect(p, account).toBeDefined();
    }
    steps.push({ step: "summary", account: OWNER, method: `epoch ${epoch}: ${debtors.length} debtors paid, ${creditors.length} creditors claimed, bundles ${[...committed.values()].join(",")}`, hash: "-" });
  }, 3_600_000);
});

