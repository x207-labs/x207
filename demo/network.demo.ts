// UM-032: end-to-end demo on a real network (testnet or mainnet). A full epoch has run on testnet (2026-11-03, docs/testnet-demo.json); not on mainnet yet.
// Extra variables: DEMO_GAS_KEY_LANES, DEMO_CALL_PAUSE_MS, DEMO_SCHEDULER_MS, RPC_URLS, DEMO_RESUME_EPOCH, X207_DEMO_RECORD.
//   DEMO_NETWORK=testnet npm run demo:testnet        (only prints the plan)
//   DEMO_NETWORK=testnet X207_CONFIRM_REAL_TX=yes npm run demo:testnet
//   DEMO_NETWORK=mainnet X207_CONFIRM_REAL_TX=yes X207_CONFIRM_MAINNET=yes npm run demo:mainnet
// Optional steps (UM-032, UM-036), skipped with a message when their prerequisites are missing:
//   DEMO_BARTER=yes      F5: three-agent ring, commit_bundle, legs paid with vouchers that carry a bundleId. Needs a contract with interface 0.0.4:
//                        set CIRCLE_CONTRACT to a 0.0.4 address (the get_bundle view must exist, otherwise the step is skipped).
//   DEMO_DAO_ACCOUNT=<Sputnik DAO account> DEMO_DAO_COUNCIL=<a,b> DEMO_DAO_PARAMS_FILE=<json>   F7: set_params proposal through the DAO.
//                        Runs only when the contract's get_owner equals the DAO; council member keys are in KEYS_DIR/<network>/<account>.json.
// Without X207_CONFIRM_REAL_TX=yes the script only prints the plan and sends nothing. Mainnet transactions are confirmed by a human.
//
// Variables (names only; values live in .env and are never printed): DEMO_NETWORK, RPC_URL, CIRCLE_CONTRACT, USDT_TOKEN_ID, KEYS_DIR,
// TERMS_HASH, STAKE_AMOUNT, DEMO_PAYMENTS, SPEND_POLICY_FILE,
// KEEPER_ACCOUNT_ID, SOLVER_ACCOUNT_ID, RELAYER_ACCOUNT_ID (key from <NAME>_SECRET_KEY or a key file in KEYS_DIR),
// AGENT_ACCOUNT_TEMPLATE (default `{name}.<CIRCLE_CONTRACT>`, e.g. `x207r-{name}.testnet`), DEMO_MINT_USDT=yes (mint mock USDT, testnet only),
// DEMO_DEFAULT=<agent> (that debtor does not repay). Owner key in KEYS_DIR/<network>/<account>.json (format of scripts/create-accounts.mjs).
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, it } from "vitest";
import { buildClaimCall, buildSettleTransferCall, type ContractAbi } from "@x207/core";
import { createNearSender, createNearView } from "@x207/core/signer";
import { NearRegistrationChain, NearRpc, PendingStore, RegistrationScheduler, createApp, createFacilitatorService } from "@x207/facilitator";
import { defineCircleConfig } from "@x207/scheme";
import { onboardAgents } from "../agents/onboarding/onboard.ts";
import { planDensity, type Density } from "../agents/scenario/density.ts";
import { buildActProposalArgs, buildAddProposalArgs, parseParamsJson } from "../contracts/dao/lib.mjs";
import { createAgentServer } from "../agents/shared/agent-server.ts";
import { loadSpendPolicy, type AgentIdentity } from "../agents/shared/identity.ts";
import { createNearAiClient } from "../agents/shared/nearai.ts";
import { AGENT_NAMES, AGENTS, type AgentName } from "../agents/shared/registry.ts";
import { createAgentBuyer, createSellerPaywall } from "../agents/shared/x207.ts";
import { runBarterRing } from "./barter-step.ts";
import { recordAccounts, recordStep } from "../sdk/test-support/demo-record.ts";
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from "../sdk/node_modules/near-api-js/lib/index.js";
import { keeperPass } from "../scripts/lib/keeper.mjs";
import { serveWeb } from "../agents/test/helpers.ts";

const run = promisify(execFile);

const NETWORKS = {
  testnet: { rpc: "https://rpc.testnet.fastnear.com", usdt: "usdt.x207-deployer.testnet", contract: "circle.x207-deployer.testnet" },
  mainnet: { rpc: "https://rpc.mainnet.fastnear.com", usdt: "usdt.tether-token.near", contract: undefined },
} as const;

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`variable ${name} is required`);
  return value;
};
const out = (line: string) => writeSync(1, `${line}\n`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("demo real network", () => {
  it("plan or execution of one epoch", async () => {
    const network = env("DEMO_NETWORK") as keyof typeof NETWORKS;
    if (!(network in NETWORKS)) throw new Error("DEMO_NETWORK must be testnet or mainnet");
    const defaults = NETWORKS[network];
    const rpcUrl = process.env.RPC_URL ?? defaults.rpc;
    const contract = process.env.CIRCLE_CONTRACT ?? defaults.contract;
    if (!contract) throw new Error("variable CIRCLE_CONTRACT is required");
    const usdt = process.env.USDT_TOKEN_ID ?? defaults.usdt;
    const payments = Number(process.env.DEMO_PAYMENTS ?? 20);
    const density = (process.env.DEMO_DENSITY ?? "medium") as Density;

    out(`Demo plan ${network} (contract ${contract}, USDT ${usdt}, RPC ${rpcUrl})`);
    for (const step of [
      "F1 onboarding: 6 agents join + stake (12 transactions, signed by the owner key)",
      `F2 ${payments} paid calls with vouchers (density ${density}); on-chain registration by the relayer`,
      ...(process.env.DEMO_BARTER === "yes" ? ["F5 (DEMO_BARTER=yes) translator -> summarizer -> scraper ring: three signatures, commit_bundle, 15 leg calls with bundleId; skipped if the contract is not yet 0.0.4"] : []),
      process.env.DEMO_DAO_ACCOUNT
        ? `F7 (DEMO_DAO_ACCOUNT=${process.env.DEMO_DAO_ACCOUNT}) set_params proposal through the DAO, council votes; skipped if the contract is not owned by that DAO`
        : "set_params through a DAO proposal is not run (set DEMO_DAO_ACCOUNT, DEMO_DAO_COUNCIL and DEMO_DAO_PARAMS_FILE for this step, UM-036)",
      "F3 keeper close_epoch (after cutoff_at), solver submit_clearing, keeper commit_epoch; 207 report",
      "F4 debtor pays the residual, keeper finalize_epoch after payment_deadline, creditor claim(epoch, near)",
      "Epoch metrics from the metrics endpoint",
    ]) out(`  - ${step}`);
    if (process.env.X207_CONFIRM_REAL_TX !== "yes") {
      out("No transactions sent. Set X207_CONFIRM_REAL_TX=yes to run.");
      return;
    }
    if (network === "mainnet" && process.env.X207_CONFIRM_MAINNET !== "yes") {
      throw new Error("mainnet needs X207_CONFIRM_MAINNET=yes and human-confirmed transactions");
    }

    const servers: Server[] = [];
    const lines: string[] = [];
    const log = (line: string) => {
      lines.push(line);
      out(line);
    };
    const hashes: Array<{ stage: string; hash: string }> = [];
    const keysDir = resolve(process.env.KEYS_DIR ?? ".keys");
    const ownerKey = (account: string): `ed25519:${string}` => JSON.parse(readFileSync(resolve(keysDir, network, `${account}.json`), "utf8")).secret_key;
    const template = process.env.AGENT_ACCOUNT_TEMPLATE ?? `{name}.${contract}`;
    const accounts = Object.fromEntries(AGENT_NAMES.map((n) => [n, template.replace("{name}", n)])) as Record<AgentName, string>;
    const operatorKey = (prefix: string, accountId: string): `ed25519:${string}` => (process.env[`${prefix}_SECRET_KEY`] as `ed25519:${string}` | undefined) ?? ownerKey(accountId);
    const defaulter = process.env.DEMO_DEFAULT as AgentName | undefined;
    if (defaulter && !AGENT_NAMES.includes(defaulter)) throw new Error(`DEMO_DEFAULT must be one of ${AGENT_NAMES.join(", ")}`);
    // X207_DEMO_RECORD=<file>: every hash goes to that JSON file as soon as it exists (docs/testnet-demo.json), never keys.
    const record = process.env.X207_DEMO_RECORD;
    // The sender of each hash is needed to check it online (check:claims --online): list the accounts of the run, never keys.
    if (record) {
      recordAccounts(record, [
        { id: contract, role: "circle contract" },
        { id: usdt, role: "USDT token" },
        { id: env("KEEPER_ACCOUNT_ID"), role: "keeper" },
        { id: env("SOLVER_ACCOUNT_ID"), role: "solver" },
        { id: env("RELAYER_ACCOUNT_ID"), role: "relayer" },
        ...AGENT_NAMES.map((n) => ({ id: accounts[n], role: `agent ${n}` })),
      ]);
    }
    const note = (stage: string, hash: string) => {
      hashes.push({ stage, hash });
      if (record) recordStep(record, { section: "network-demo", step: stage, hash });
    };
    const stamp = (label: string) => (info: { methodName?: string; hash: string }) => {
      note(`${label}${info.methodName ? `.${info.methodName}` : ""}`, info.hash);
      log(`   tx ${label}${info.methodName ? `.${info.methodName}` : ""} ${info.hash}`);
    };
    const view = createNearView(rpcUrl, contract);

    if (network === "testnet" && process.env.DEMO_MINT_USDT === "yes") {
      log("== mock USDT (testnet only)");
      for (const n of AGENT_NAMES) {
        await createNearSender({ rpcUrl, accountId: accounts[n], secretKey: ownerKey(accounts[n]), onTx: stamp(`${n}.usdt`) })({
          receiverId: usdt, methodName: "mint", args: { account_id: accounts[n], amount: "1000000000" }, deposit: 0n,
        });
      }
    }

    log("== F1 onboarding");
    const outcomes = await onboardAgents({
      agents: AGENT_NAMES.map((n) => {
        const send = createNearSender({ rpcUrl, accountId: accounts[n], secretKey: ownerKey(accounts[n]), onTx: stamp(n) });
        // AG-034: the public testnet RPC sometimes answers 429 or "Internal server error" after the transaction has landed. For the stake transfer, ask the contract
        // whether the member is active before failing; otherwise the voucher key of a half-onboarded agent is lost.
        const sendCall: typeof send = async (call) => {
          try {
            return await send(call);
          } catch (error) {
            if (call.methodName !== "ft_transfer_call") throw error;
            await sleep(10_000);
            const member = (await view("member", { account_id: accounts[n] })) as { status: string } | null;
            if (member?.status !== "active") throw error;
            log(`   ${n}: stake landed although the RPC answered: ${(error as Error).message.slice(0, 80)}`);
            return undefined;
          }
        };
        return { accountId: accounts[n], sendCall };
      }),
      circleContract: contract, circleId: process.env.CIRCLE_ID ?? "agents-main", termsHash: env("TERMS_HASH"), stakeAmount: env("STAKE_AMOUNT"),
      policy: loadSpendPolicy(resolve(env("SPEND_POLICY_FILE"))), view, keysDir, network, usdtTokenId: usdt, log,
    });
    const identity = Object.fromEntries(outcomes.map((o, i) => [AGENT_NAMES[i], o.identity])) as Record<AgentName, AgentIdentity>;

    const pending = new PendingStore(":memory:");
    // The free testnet RPC answers 429 under load: ask again with backoff before the facilitator calls the chain unavailable.
    // RPC_URLS=a,b,c: endpoints tried in order by the facilitator and the buyers; the first one answers 429 or times out under load.
    const rpcUrls = (process.env.RPC_URLS ?? rpcUrl).split(",").map((u) => u.trim()).filter(Boolean);
    const rpc = new NearRpc({ urls: rpcUrls, timeoutMs: 10_000, rateLimit: { attempts: 5, baseMs: 2_000 } });
    const circle = defineCircleConfig({ network: "x207:agents-main", circleContract: contract });
    const relayer = { accountId: env("RELAYER_ACCOUNT_ID"), privateKey: operatorKey("RELAYER", env("RELAYER_ACCOUNT_ID")) };
    // chainCache: the chain reads of /verify are kept for a few seconds (sdk/apps/facilitator/src/chain-cache.ts) so that a paid call does not cost ten RPC requests.
    const facilitatorService = createFacilitatorService({ circles: [circle], rpc, pending, signers: [relayer.accountId], chainCache: {} });
    const facilitatorApp = createApp(facilitatorService);
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
    // SD-031: DEMO_GAS_KEY_LANES=n puts a gas key (NEP-611) with n nonce lanes on the relayer, so registrations run in parallel.
    // The key is kept in KEYS_DIR/<network>/<relayer>.gaskey.json (mode 0600) and reused; it is never printed.
    const lanes = Number(process.env.DEMO_GAS_KEY_LANES ?? 0);
    let gasKey: { privateKey: string; lanes: number } | undefined;
    if (lanes > 0) {
      const file = resolve(keysDir, network, `${relayer.accountId}.gaskey.json`);
      const provider = new JsonRpcProvider({ url: rpcUrl });
      const relayerAccount = new Account(relayer.accountId, provider, KeyPairSigner.fromSecretKey(relayer.privateKey));
      if (existsSync(file)) gasKey = { privateKey: JSON.parse(readFileSync(file, "utf8")).secret_key, lanes };
      else {
        const key = KeyPair.fromRandom("ed25519");
        writeFileSync(file, JSON.stringify({ account_id: relayer.accountId, secret_key: key.toString(), lanes }), { mode: 0o600 });
        try {
          const added = await relayerAccount.addFullAccessGasKey(key.getPublicKey(), lanes);
          note("relayer.add_gas_key", added.transaction.hash);
          const funded = await relayerAccount.transferToGasKey(relayer.accountId, key.getPublicKey(), 2n * 10n ** 24n);
          note("relayer.fund_gas_key", funded.transaction.hash);
        } catch (error) {
          unlinkSync(file); // the key is not on the chain (or not funded): do not reuse it next time
          throw error;
        }
        gasKey = { privateKey: key.toString(), lanes };
      }
      log(`== SD-031 gas key NEP-611 on relayer ${relayer.accountId}, ${lanes} nonce lanes`);
    }
    const registrationChain = new NearRegistrationChain({
      rpc, circleContract: contract, relayer, onHash: (hash) => stamp(gasKey ? "relayer.register(gas key)" : "relayer.register")({ hash }), ...(gasKey ? { gasKey } : {}),
    });
    const scheduler = new RegistrationScheduler({
      circleContract: contract, store: pending, log: (e) => log(`   registration ${JSON.stringify(e)}`),
      chain: registrationChain, concurrency: registrationChain.concurrency,
      onRegistered: ({ payer }) => facilitatorService.invalidatePayer?.(contract, payer),
    });

    // The public testnet RPC and Neardata are rate limited (429; 30 blocks per minute), so an indexer backfill is not possible in one session.
    // The solver reads the obligation snapshot from this shim, built from the contract's `list_obligations` view, in the same shape as the read API.
    const api = createServer(async (req, res) => {
      const match = /\/epochs\/(\d+)\/obligations/.exec(req.url ?? "");
      if (!match) {
        res.writeHead(404).end("{}");
        return;
      }
      const n = Number(match[1]);
      const epochView = (await view("get_epoch", { epoch: n })) as ContractAbi.EpochView;
      const edges = (await view("list_obligations", { epoch: n, from_index: 0, limit: 300 })) as ContractAbi.ObligationView[];
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          circle: "agents-main", epoch: n, phase: epochView.phase, stage: "cutoff", unit: "credit", decimals: 6,
          edgeCount: edges.length, totalObligation: edges.reduce((sum, e) => sum + BigInt(e.cumulative), 0n).toString(),
          edges: edges.map((e) => ({ debtor: e.debtor, creditor: e.creditor, amount: e.cumulative, seq: e.last_seq, cleared: null, remaining: null })),
        }),
      );
    });
    await new Promise<void>((resolveListen) => api.listen(0, "127.0.0.1", resolveListen));
    servers.push(api);
    const readApi = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    const keeperSend = createNearSender({ rpcUrl, accountId: env("KEEPER_ACCOUNT_ID"), secretKey: operatorKey("KEEPER", env("KEEPER_ACCOUNT_ID")), onTx: stamp("keeper") });
    const chainNowMs = async () => Number(BigInt(((await (await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "block", params: { finality: "optimistic" } }) })).json()) as any).result.header.timestamp_nanosec) / 1_000_000n);
    const pass = () =>
      keeperPass({
        view, chainNowMs, lookback: 50,
        send: async ({ methodName, args }: { methodName: string; args: object }) => {
          await keeperSend({ receiverId: contract, methodName, args, deposit: 0n, gas: 200_000_000_000_000n });
          return methodName;
        },
      }) as Promise<Array<{ method: string; epoch: number }>>;
    const phase = async (epoch: number) => ((await view("get_epoch", { epoch })) as ContractAbi.EpochView).phase;
    const waitFor = async (what: string, done: () => Promise<boolean>) => {
      for (;;) {
        await pass();
        if (await done()) return;
        await sleep(15_000);
        log(`   waiting for ${what}`);
      }
    };

    const resume = process.env.DEMO_RESUME_EPOCH ? Number(process.env.DEMO_RESUME_EPOCH) : undefined;
    // Pick an epoch that still has time: close an epoch that is past its cutoff, wait if the remaining time is too short.
    const MIN_REMAINING_MS = 240_000;
    let current: ContractAbi.EpochView = (await view("get_epoch", resume ? { epoch: resume } : {})) as ContractAbi.EpochView;
    while (!resume) {
      await pass();
      current = (await view("get_epoch", {})) as ContractAbi.EpochView;
      const remaining = Number(BigInt(current.cutoff_at) / 1_000_000n) - (await chainNowMs());
      if (current.phase === "open" && remaining >= MIN_REMAINING_MS) break;
      log(`   epoch ${current.epoch} ${Math.round(remaining / 1000)} s left, waiting for the next epoch`);
      await sleep(15_000);
    }
    const epoch = current.epoch;
    if (resume) log(`== Resuming epoch ${epoch} (payments and registration were done in a previous round)`);
    if (!resume) scheduler.start(Number(process.env.DEMO_SCHEDULER_MS ?? 2_000));
    if (!resume && process.env.DEMO_BARTER === "yes") {
      const solverId = env("SOLVER_ACCOUNT_ID");
      await runBarterRing({
        view, rpcUrl, contract, epoch, accounts, identity, urls, log,
        send: createNearSender({ rpcUrl, accountId: solverId, secretKey: operatorKey("SOLVER", solverId), onTx: stamp("solver") }),
      });
    }
    if (!resume) log(`== F2 voucher payments (epoch ${epoch})`);
    // one buyer client per agent: it keeps its own membership and headroom reads between calls
    const buyers = new Map<AgentName, ReturnType<typeof createAgentBuyer>>();
    const buyerOf = (name: AgentName, seller: AgentName) => {
      if (!buyers.has(name)) buyers.set(name, createAgentBuyer(identity[name], { rpcUrls }));
      return buyers.get(name)!(`${urls[seller]}/api/${AGENTS[seller].verb}?input=halo`);
    };
    for (const { buyer, seller } of resume ? [] : planDensity(density, payments, Number(process.env.DEMO_SEED ?? 20261102))) {
      // The free testnet RPC answers 429 now and then; the facilitator then answers 503 before the resource is served (nothing is paid).
      // Ask again a few times, and say what the refusal was when it stays.
      let response: Response;
      for (let attempt = 0; ; attempt += 1) {
        response = await buyerOf(buyer, seller);
        if (response.status !== 503 || attempt >= 6) break;
        log(`   ${buyer} -> ${seller}: HTTP 503, retry ${attempt + 1}/6 after ${4 * (attempt + 1)} seconds`);
        await sleep(4_000 * (attempt + 1));
      }
      await sleep(Number(process.env.DEMO_CALL_PAUSE_MS ?? 0));
      if (response.status !== 200) {
        const required = response.headers.get("PAYMENT-REQUIRED");
        const reason = required ? (JSON.parse(Buffer.from(required, "base64").toString("utf8")) as { error?: string }).error : undefined;
        throw new Error(`${buyer} -> ${seller}: HTTP ${response.status}${reason ? ` (${reason})` : ""} ${(await response.text()).slice(0, 200)}`);
      }
    }
    if (!resume) {
      log(`   ${payments} paid calls done`);
      while (pending.listOpen(contract).length > 0) await sleep(2_000);
      scheduler.stop();
      log("   all pairs registered on-chain");
    }

    log("== F3 clearing");
    await waitFor("close_epoch", async () => !["open", "cutoff"].includes(await phase(epoch)));
    const solved = await run("node", ["solver/dist/cli.js", "--epoch", String(epoch)], {
      env: { PATH: process.env.PATH, X207_READ_API_URL: readApi, X207_CIRCLE_ID: "agents-main", NEAR_RPC_URL: rpcUrl, X207_CONTRACT_ID: contract, SOLVER_ACCOUNT_ID: env("SOLVER_ACCOUNT_ID"), SOLVER_PRIVATE_KEY: operatorKey("SOLVER", env("SOLVER_ACCOUNT_ID")) },
    }).catch((error: { stdout?: string; stderr?: string }) => ({ stdout: error.stdout ?? "", stderr: error.stderr ?? "" }));
    if (!solved.stdout.trim()) log(`   solver: ${(solved.stderr || "no output").trim().split("\n").slice(-2).join(" | ").slice(0, 200)}`);
    const solverTx = /tx[ =:]+([A-Za-z0-9]{40,})/.exec(solved.stderr)?.[1];
    log(`   solver: ${solverTx ? `proposal submitted, tx ${solverTx}` : solved.stdout.trim() ? "proposal computed but not submitted" : "nothing to clear"}`);
    if (solverTx) note("solver.submit_clearing", solverTx);
    await waitFor("commit_epoch", async () => ["payment_window", "finalized"].includes(await phase(epoch)));
    const members = AGENT_NAMES.map((n) => accounts[n]);
    for (const account of members) {
      const position = (await view("net_position", { epoch, account_id: account })) as { net: string; role: string; amount: string; status: string } | null;
      log(`   position ${account}: ${position ? `${position.role} net=${position.net} status=${position.status}` : "zero"}`);
    }

    log("== F4 settlement");
    const stakeBefore = defaulter ? ((await view("member", { account_id: accounts[defaulter] })) as ContractAbi.MemberView).stake : undefined;
    const positions = (await view("list_positions", { epoch, from_index: 0, limit: 100 })) as Array<{ account_id: string; role: string; amount: string; status: string }>;
    for (const name of AGENT_NAMES) {
      const due = positions.find((p) => p.account_id === accounts[name] && p.role === "debtor" && p.status === "due");
      if (!due || name === defaulter) continue;
      await createNearSender({ rpcUrl, accountId: accounts[name], secretKey: ownerKey(accounts[name]), onTx: stamp(`${name}.settle`) })(buildSettleTransferCall({ circleContract: contract, amount: due.amount, epoch, usdtTokenId: usdt }));
    }
    await waitFor("finalize_epoch", async () => (await phase(epoch)) === "finalized");
    for (const name of AGENT_NAMES) {
      if (positions.some((p) => p.account_id === accounts[name] && p.role === "creditor")) {
        await createNearSender({ rpcUrl, accountId: accounts[name], secretKey: ownerKey(accounts[name]), onTx: stamp(`${name}.claim`) })(buildClaimCall({ circleContract: contract, epoch, destination: "near" }));
      }
    }
    if (defaulter) {
      const member = (await view("member", { account_id: accounts[defaulter] })) as ContractAbi.MemberView;
      log(`   ${defaulter}: status=${member.status} limit=${member.limit} stake=${member.stake}`);
      const position = (await view("net_position", { epoch, account_id: accounts[defaulter] })) as { status: string; amount: string } | null;
      log(`   position ${defaulter} after finalize: ${JSON.stringify(position)}`);
      // UM-037: default branch until the payment window ends: stake is slashed, status 409 in the 207 report, limit 0
      const cut = stakeBefore === undefined ? 0n : BigInt(stakeBefore) - BigInt(member.stake);
      log(`   default branch: stake slashed ${cut} of ${stakeBefore}, 207 report status ${position?.status === "defaulted" ? 409 : "not 409 (position " + position?.status + ")"}, limit ${member.limit}`);
    }
    const daoAccount = process.env.DEMO_DAO_ACCOUNT;
    if (daoAccount) {
      log(`== F7 set_params through DAO proposal ${daoAccount}`);
      const owner = (await view("get_owner", {}).catch(() => null)) as string | null;
      const council = (process.env.DEMO_DAO_COUNCIL ?? "").split(",").map((a) => a.trim()).filter(Boolean);
      if (owner !== daoAccount) log(`   skipped: owner of ${contract} is ${owner ?? "unreadable"}, not ${daoAccount}`);
      else if (council.length === 0 || !process.env.DEMO_DAO_PARAMS_FILE) log("   skipped: set DEMO_DAO_COUNCIL and DEMO_DAO_PARAMS_FILE");
      else {
        const daoView = createNearView(rpcUrl, daoAccount);
        const addArgs = buildAddProposalArgs({ contract, params: parseParamsJson(readFileSync(resolve(process.env.DEMO_DAO_PARAMS_FILE), "utf8")) });
        log(`   parameters before: ${JSON.stringify(await view("get_params", {}))}`);
        const proposalId = Number(
          await createNearSender({ rpcUrl, accountId: council[0]!, secretKey: ownerKey(council[0]!), onTx: stamp("dao.add_proposal") })({
            receiverId: daoAccount, methodName: "add_proposal", args: addArgs, deposit: 100_000_000_000_000_000_000_000n, gas: 100_000_000_000_000n,
          }),
        );
        log(`   proposal ${proposalId} submitted by ${council[0]}`);
        let status = "InProgress";
        for (const member of council) {
          await createNearSender({ rpcUrl, accountId: member, secretKey: ownerKey(member), onTx: stamp(`dao.vote.${member}`) })({
            receiverId: daoAccount, methodName: "act_proposal", args: buildActProposalArgs({ id: proposalId }), deposit: 0n, gas: 150_000_000_000_000n,
          });
          status = ((await daoView("get_proposal", { id: proposalId })) as { status: string }).status;
          log(`   vote ${member}: status ${status}`);
          if (status === "Approved") break;
        }
        log(`   parameters after: ${JSON.stringify(await view("get_params", {}))}`);
        if (status !== "Approved") log("   proposal not passed: council has too few votes, no change");
      }
    }
    const finalView = (await view("get_epoch", { epoch })) as ContractAbi.EpochView;
    const edgesNow = (await view("list_obligations", { epoch, from_index: 0, limit: 300 })) as ContractAbi.ObligationView[];
    const voucherCount = edgesNow.reduce((sum, e) => sum + e.last_seq, 0);
    const residualCount = (await view("list_positions", { epoch, from_index: 0, limit: 300 }) as Array<{ role: string }>).filter((p) => p.role === "debtor").length;
    log(`   metrics from the contract view: voucher=${voucherCount} edge=${edgesNow.length} cleared=${finalView.total_cleared} total=${finalView.total_obligation} transfer_residual=${residualCount}`);
    log(`   ${voucherCount} payments became ${residualCount}`);
    log("== Transaction hashes per stage");
    for (const h of hashes) log(`   ${h.stage} ${h.hash}`);

    mkdirSync(".demo", { recursive: true });
    writeFileSync(`.demo/demo-${network}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`, lines.join("\n") + "\n");
    writeFileSync(`.demo/hashes-${network}-epoch${epoch}.json`, JSON.stringify(hashes, null, 2));
    servers.forEach((s) => s.close());
  }, 6 * 3600_000);
});
