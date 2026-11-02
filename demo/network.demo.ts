// UM-032: demo end-to-end di jaringan nyata (testnet atau mainnet). Ditulis tetapi BELUM PERNAH dijalankan dengan transaksi.
//   DEMO_NETWORK=testnet npm run demo:testnet        (hanya mencetak rencana)
//   DEMO_NETWORK=testnet X207_CONFIRM_REAL_TX=yes npm run demo:testnet
//   DEMO_NETWORK=mainnet X207_CONFIRM_REAL_TX=yes X207_CONFIRM_MAINNET=yes npm run demo:mainnet
// Tanpa X207_CONFIRM_REAL_TX=yes skrip hanya mencetak rencana dan tidak mengirim apa pun. Transaksi mainnet dikonfirmasi manusia.
//
// Variabel (nama saja; nilai di .env, tidak pernah dicetak): DEMO_NETWORK, RPC_URL, CIRCLE_CONTRACT, USDT_TOKEN_ID, KEYS_DIR,
// DEMO_START_BLOCK (blok deploy kontrak untuk indexer), TERMS_HASH, STAKE_AMOUNT, DEMO_PAYMENTS, SPEND_POLICY_FILE,
// KEEPER_ACCOUNT_ID, KEEPER_SECRET_KEY, SOLVER_ACCOUNT_ID, SOLVER_SECRET_KEY, RELAYER_ACCOUNT_ID, RELAYER_SECRET_KEY.
// Akun agent `<nama>.<CIRCLE_CONTRACT>` dengan kunci pemilik di KEYS_DIR/<network>/<akun>.json (format scripts/create-accounts.mjs).
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, it } from "vitest";
import { buildClaimCall, buildSettleTransferCall, type ContractAbi } from "@x207/core";
import { createNearSender, createNearView } from "@x207/core/signer";
import { NearRegistrationChain, NearRpc, PendingStore, RegistrationScheduler, createApp, createFacilitatorService } from "@x207/facilitator";
import { defineCircleConfig } from "@x207/scheme";
import { FailoverRpcClient, Indexer, RpcBlockSource, createApiServer, openDatabase, rpcChainReader } from "../backend/src/index.ts";
import { onboardAgents } from "../agents/onboarding/onboard.ts";
import { planDensity, type Density } from "../agents/scenario/density.ts";
import { createAgentServer } from "../agents/shared/agent-server.ts";
import { loadSpendPolicy, type AgentIdentity } from "../agents/shared/identity.ts";
import { createNearAiClient } from "../agents/shared/nearai.ts";
import { AGENT_NAMES, AGENTS, type AgentName } from "../agents/shared/registry.ts";
import { createAgentBuyer, createSellerPaywall } from "../agents/shared/x207.ts";
import { keeperPass } from "../scripts/lib/keeper.mjs";
import { serveWeb } from "../agents/test/helpers.ts";

const run = promisify(execFile);
if (existsSync(".env")) process.loadEnvFile(".env");

const NETWORKS = {
  testnet: { rpc: "https://rpc.testnet.fastnear.com", usdt: "usdt.x207-deployer.testnet", contract: "circle.x207-deployer.testnet" },
  mainnet: { rpc: "https://rpc.mainnet.fastnear.com", usdt: "usdt.tether-token.near", contract: undefined },
} as const;

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`variabel ${name} wajib diisi`);
  return value;
};
const out = (line: string) => writeSync(1, `${line}\n`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("demo jaringan nyata", () => {
  it("rencana atau eksekusi satu epoch", async () => {
    const network = env("DEMO_NETWORK") as keyof typeof NETWORKS;
    if (!(network in NETWORKS)) throw new Error("DEMO_NETWORK harus testnet atau mainnet");
    const defaults = NETWORKS[network];
    const rpcUrl = process.env.RPC_URL ?? defaults.rpc;
    const contract = process.env.CIRCLE_CONTRACT ?? defaults.contract;
    if (!contract) throw new Error("variabel CIRCLE_CONTRACT wajib diisi");
    const usdt = process.env.USDT_TOKEN_ID ?? defaults.usdt;
    const payments = Number(process.env.DEMO_PAYMENTS ?? 20);
    const density = (process.env.DEMO_DENSITY ?? "medium") as Density;

    out(`Rencana demo ${network} (kontrak ${contract}, USDT ${usdt}, RPC ${rpcUrl})`);
    for (const step of [
      "F1 onboarding: 6 agent join + stake (12 transaksi, ditandatangani kunci pemilik)",
      `F2 ${payments} panggilan berbayar dengan voucher (kepadatan ${density}); registrasi on-chain oleh relayer`,
      "set_params dari akun pemilik tidak dijalankan di jaringan nyata (lewat proposal DAO, UM-036)",
      "F3 keeper close_epoch (setelah cutoff_at), solver submit_clearing, keeper commit_epoch; laporan 207",
      "F4 debtor melunasi residual, keeper finalize_epoch setelah payment_deadline, kreditor claim(epoch, near)",
      "Metrik epoch dari endpoint metrics",
    ]) out(`  - ${step}`);
    if (process.env.X207_CONFIRM_REAL_TX !== "yes") {
      out("Tidak ada transaksi dikirim. Set X207_CONFIRM_REAL_TX=yes untuk menjalankan.");
      return;
    }
    if (network === "mainnet" && process.env.X207_CONFIRM_MAINNET !== "yes") {
      throw new Error("mainnet butuh X207_CONFIRM_MAINNET=yes dan transaksi dikonfirmasi manusia");
    }

    const keysDir = resolve(process.env.KEYS_DIR ?? ".keys");
    const ownerKey = (account: string): `ed25519:${string}` => JSON.parse(readFileSync(resolve(keysDir, network, `${account}.json`), "utf8")).secret_key;
    const accounts = Object.fromEntries(AGENT_NAMES.map((n) => [n, `${n}.${contract}`])) as Record<AgentName, string>;
    const view = createNearView(rpcUrl, contract);
    const servers: Server[] = [];
    const lines: string[] = [];
    const log = (line: string) => {
      lines.push(line);
      out(line);
    };
    const hashes: Array<{ stage: string; hash: string }> = [];

    log("== F1 onboarding");
    const outcomes = await onboardAgents({
      agents: AGENT_NAMES.map((n) => {
        const send = createNearSender({ rpcUrl, accountId: accounts[n], secretKey: ownerKey(accounts[n]) });
        return { accountId: accounts[n], sendCall: async (call) => { const value = await send(call); hashes.push({ stage: `${n}.${call.methodName}`, hash: "n/a" }); return value; } };
      }),
      circleContract: contract, circleId: process.env.CIRCLE_ID ?? "agents-main", termsHash: env("TERMS_HASH"), stakeAmount: env("STAKE_AMOUNT"),
      policy: loadSpendPolicy(resolve(env("SPEND_POLICY_FILE"))), view, keysDir, network, usdtTokenId: usdt, log,
    });
    const identity = Object.fromEntries(outcomes.map((o, i) => [AGENT_NAMES[i], o.identity])) as Record<AgentName, AgentIdentity>;

    log("== F2 pembayaran voucher");
    const pending = new PendingStore(":memory:");
    const rpc = new NearRpc({ urls: [rpcUrl], timeoutMs: 10_000 });
    const circle = defineCircleConfig({ network: "x207:agents-main", circleContract: contract });
    const relayer = { accountId: env("RELAYER_ACCOUNT_ID"), privateKey: env("RELAYER_SECRET_KEY") };
    const facilitatorApp = createApp(createFacilitatorService({ circles: [circle], rpc, pending, signers: [relayer.accountId] }));
    const facilitator = await serveWeb((request) => facilitatorApp.fetch(request));
    servers.push(facilitator.server);
    const urls = {} as Record<AgentName, string>;
    for (const name of AGENT_NAMES) {
      const paywall = createSellerPaywall(AGENTS[name], { facilitatorUrl: facilitator.url, circleId: "agents-main", payTo: accounts[name] });
      const server = createAgentServer(AGENTS[name], createNearAiClient({ agent: name }), paywall);
      await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
      servers.push(server);
      urls[name] = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    }
    const scheduler = new RegistrationScheduler({
      circleContract: contract, store: pending, log: (e) => log(`   registrasi ${JSON.stringify(e)}`),
      chain: new NearRegistrationChain({ rpc, circleContract: contract, relayer }),
    });
    scheduler.start(2_000);
    const first = (await view("get_epoch", {})) as ContractAbi.EpochView;
    for (const { buyer, seller } of planDensity(density, payments, Number(process.env.DEMO_SEED ?? 20261102))) {
      const response = await createAgentBuyer(identity[buyer], { rpcUrls: [rpcUrl] })(`${urls[seller]}/api/${AGENTS[seller].verb}?input=halo`);
      if (response.status !== 200) throw new Error(`${buyer} -> ${seller}: HTTP ${response.status}`);
    }
    log(`   ${payments} panggilan berbayar selesai`);

    log("== F3 kliring");
    const db = openDatabase(":memory:");
    const start = Number(env("DEMO_START_BLOCK"));
    const indexer = new Indexer({
      db, source: new RpcBlockSource(rpcChainReader(new FailoverRpcClient({ endpoints: [rpcUrl] })), contract, start), circleId: "agents-main",
      contractId: contract, startBlock: start, fetchParams: () => view("get_params", {}) as Promise<ContractAbi.Params>,
    });
    await indexer.bootstrap();
    const api = createApiServer({ db });
    await new Promise<void>((resolveListen) => api.listen(0, "127.0.0.1", resolveListen));
    servers.push(api);
    const readApi = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    const keeperSend = createNearSender({ rpcUrl, accountId: env("KEEPER_ACCOUNT_ID"), secretKey: env("KEEPER_SECRET_KEY") as `ed25519:${string}` });
    const chainNowMs = async () => Number(BigInt(((await (await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "block", params: { finality: "optimistic" } }) })).json()) as any).result.header.timestamp_nanosec) / 1_000_000n);
    const pass = () =>
      keeperPass({
        view, chainNowMs, log: (a: object) => log(`   keeper ${JSON.stringify(a)}`),
        send: async ({ methodName, args }: { methodName: string; args: object }) => {
          await keeperSend({ receiverId: contract, methodName, args, deposit: 0n, gas: 200_000_000_000_000n });
          return methodName;
        },
      }) as Promise<Array<{ method: string; epoch: number }>>;
    const waitFor = async (what: string, done: () => Promise<boolean>) => {
      for (;;) {
        if (await done()) return;
        await indexer.drain();
        await sleep(15_000);
        log(`   menunggu ${what}`);
      }
    };
    const epoch = first.epoch;
    await waitFor("close_epoch", async () => (await pass()).some((a) => a.epoch === epoch && a.method === "close_epoch"));
    scheduler.stop();
    await waitFor("indexer menyusul cutoff", async () => ((await view("get_epoch", { epoch })) as ContractAbi.EpochView).phase === "clearing" && (db.prepare("select phase from epochs where epoch = ?").get(epoch) as { phase?: string } | undefined)?.phase !== "open");
    await run("node", ["solver/dist/cli.js", "--epoch", String(epoch)], {
      env: { PATH: process.env.PATH, X207_READ_API_URL: readApi, X207_CIRCLE_ID: "agents-main", NEAR_RPC_URL: rpcUrl, X207_CONTRACT_ID: contract, SOLVER_ACCOUNT_ID: env("SOLVER_ACCOUNT_ID"), SOLVER_PRIVATE_KEY: env("SOLVER_SECRET_KEY") },
    });
    await waitFor("commit_epoch", async () => (await pass()).some((a) => a.epoch === epoch && a.method === "commit_epoch"));
    await indexer.drain();
    log(`   laporan 207: ${JSON.stringify(await (await fetch(`${readApi}/x207/circles/agents-main/epochs/${epoch}`)).json())}`);

    log("== F4 settlement");
    const positions = (await view("list_positions", { epoch, from_index: 0, limit: 100 })) as Array<{ account_id: string; role: string; amount: string; status: string }>;
    for (const name of AGENT_NAMES) {
      const due = positions.find((p) => p.account_id === accounts[name] && p.role === "debtor" && p.status === "due");
      if (due) await createNearSender({ rpcUrl, accountId: accounts[name], secretKey: ownerKey(accounts[name]) })(buildSettleTransferCall({ circleContract: contract, amount: due.amount, epoch, usdtTokenId: usdt }));
    }
    await waitFor("finalize_epoch", async () => (await pass()).some((a) => a.epoch === epoch && a.method === "finalize_epoch"));
    for (const name of AGENT_NAMES) {
      if (positions.some((p) => p.account_id === accounts[name] && p.role === "creditor")) {
        await createNearSender({ rpcUrl, accountId: accounts[name], secretKey: ownerKey(accounts[name]) })(buildClaimCall({ circleContract: contract, epoch, destination: "near" }));
      }
    }
    await indexer.drain();
    log(`   metrik: ${JSON.stringify(await (await fetch(`${readApi}/x207/circles/agents-main/epochs/${epoch}/metrics`)).json())}`);

    mkdirSync(".demo", { recursive: true });
    writeFileSync(`.demo/demo-${network}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`, lines.join("\n") + "\n");
    servers.forEach((s) => s.close());
  }, 6 * 3600_000);
});
