#!/usr/bin/env node
// UM-124: one epoch of the six named agents on NEAR testnet, on a circle of its own made from the v0.0.13 release wasm (the circle x207-v013.testnet is not touched).
// The same 15 trades as `npm run demo:swarm` (demo/swarm-traffic.ts). Every agent is a testnet account that signs and registers its own vouchers; a keeper account closes, proposes (the real
// solver code of this repository), commits and finalizes; the debtors pay their residual with ft_transfer_call and the creditors claim. Hashes and names go to docs/testnet-swarm.json
// (no key, no secret).
//
//   node scripts/testnet-swarm.mjs                       the plan only: accounts, balances, the 15 trades, the time; reads the chain, sends nothing
//   node scripts/testnet-swarm.mjs --execute             sends the transactions (about 25 minutes of real time: the windows of the circle are 300 s, 60 s and 900 s)
//   options: --keys-dir <dir> (default .keys, git-ignored)  --out <file> (default docs/testnet-swarm.json)
//
// Accounts (all `.testnet`, keys in the keys dir, mode 0600, never printed): the six agents are x207r-translator, x207r-summarizer, x207r-scraper, x207r-image, x207r-cleaner and x207r-gpu;
// the keeper is x207r-circle; the circle is the sub-account x207-swarm.x207r-deploy.testnet that x207r-deploy creates. The token is the open mock USDT of the testnet guide.
// Needs `npm ci` and `npm run build --workspaces --if-present` once, and the release wasm in the cache of `npm run demo:quick` (node scripts/demo-quick.mjs --release-wasm --check-only).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const { Account, JsonRpcProvider, KeyPairSigner, KeyPair, parseNearAmount } = createRequire(resolve(root, "backend/package.json"))("near-api-js");

export const RPC = process.env.X207_TESTNET_RPC ?? "https://rpc.testnet.fastnear.com";
export const USDT = "usdt.x207-deployer.testnet";
export const INTENTS = "intents.testnet";
export const OWNER = "x207r-deploy.testnet";
export const KEEPER = "x207r-circle.testnet";
export const CIRCLE = "x207-swarm.x207r-deploy.testnet";
export const CIRCLE_ID = "swarm-demo";
export const TAG = "v0.0.13";
export const STAKE = "150000000"; // 150 credit
export const AGENT_ACCOUNTS = { translator: "x207r-translator.testnet", summarizer: "x207r-summarizer.testnet", scraper: "x207r-scraper.testnet", image: "x207r-image.testnet", cleaner: "x207r-cleaner.testnet", gpu: "x207r-gpu.testnet" };
export const PARAMS = { epoch_length: 300, payment_window: 900, proposal_window: 60, base_limit_ratio: 8000, limit_growth: 1000, limit_cap: "1000000000", limit_decay: 0, fees: { clearing_fee_bps: 0, solver_fee_bps: 0 }, admission: "open" };
const TERMS_HASH = "a".repeat(64);
const CREDIT = 1_000_000n;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function parseArgs(argv) {
  const o = { execute: false, keysDir: ".keys", out: "docs/testnet-swarm.json" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--execute") o.execute = true;
    else if (a === "--keys-dir") o.keysDir = argv[++i];
    else if (a === "--out") o.out = argv[++i];
    else throw new Error(`unknown option ${a} (use --execute, --keys-dir, --out)`);
  }
  return o;
}

/** Net position of every agent from the trades: what it is owed minus what it owes, in credit. */
export function netByAgent(trades) {
  const net = {};
  for (const t of trades) {
    net[t.buyer] = (net[t.buyer] ?? 0) - t.credit;
    net[t.seller] = (net[t.seller] ?? 0) + t.credit;
  }
  return net;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const keysDir = resolve(opts.keysDir);
  const outPath = resolve(opts.out);
  const { trafficFor } = await import(pathToFileURL(join(root, "demo/swarm-traffic.ts")));
  const trades = trafficFor(0);
  const provider = new JsonRpcProvider({ url: RPC });
  const secretOf = (id) => JSON.parse(readFileSync(join(keysDir, "testnet", `${id}.json`), "utf8")).secret_key;
  const accountOf = (id) => new Account(id, provider, KeyPairSigner.fromSecretKey(secretOf(id)));
  const balance = async (id) => provider.viewAccount({ accountId: id }).then((s) => Number(BigInt(s.amount) / 10n ** 20n) / 10000, () => null);

  const names = Object.keys(AGENT_ACCOUNTS);
  const need = [OWNER, KEEPER, ...Object.values(AGENT_ACCOUNTS)];
  const missing = need.filter((id) => !existsSync(join(keysDir, "testnet", `${id}.json`)));
  console.log(`UM-124 plan: circle ${CIRCLE} (id ${CIRCLE_ID}, ${TAG}), token ${USDT}, keeper ${KEEPER}`);
  for (const id of need) console.log(`  ${id.padEnd(30)} ${(await balance(id)) ?? "does not exist"} NEAR${missing.includes(id) ? "  KEY FILE MISSING" : ""}`);
  const net = netByAgent(trades);
  console.log(`${trades.length} trades, total ${trades.reduce((n, t) => n + t.credit, 0)} credit; net per agent: ${names.map((n) => `${n} ${net[n] > 0 ? "+" : ""}${net[n]}`).join(", ")}`);
  if (missing.length > 0) throw new Error(`key files missing in ${keysDir}/testnet: ${missing.join(", ")}`);
  if (!opts.execute) {
    console.log("plan only; add --execute to send (testnet only)");
    return;
  }

  const wasmFile = join(root, "node_modules/.cache/x207-quick", `x207-circle-${TAG}.wasm`);
  if (!existsSync(wasmFile)) throw new Error(`no release wasm at ${wasmFile}; run: node scripts/demo-quick.mjs --release-wasm --check-only`);
  const { KNOWN_SHA256 } = await import(pathToFileURL(join(here, "deploy-mainnet.mjs")));
  const wasm = readFileSync(wasmFile);
  const sha = createHash("sha256").update(wasm).digest("hex");
  if (sha !== KNOWN_SHA256[TAG]) throw new Error(`wasm sha256 ${sha} is not the pinned ${KNOWN_SHA256[TAG]}`);

  const core = await import(pathToFileURL(join(root, "sdk/packages/core/dist/index.js")));
  const solver = await import(pathToFileURL(join(root, "solver/dist/mincostflow/index.js")));
  const steps = [];
  const record = (step, account, method, hash) => {
    steps.push({ step, account, method, hash });
    console.log(`  ${step}: ${hash}`);
  };
  const rawView = async (contract, method, args = {}) => {
    for (let i = 0; ; i++) {
      try {
        const r = await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "optimistic", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }) })).json();
        if (r.error || !r.result?.result) throw new Error(JSON.stringify(r.error ?? r.result).slice(0, 200));
        return JSON.parse(Buffer.from(r.result.result).toString());
      } catch (e) {
        if (i >= 4) throw e;
        await sleep(1500);
      }
    }
  };
  const view = (method, args) => rawView(CIRCLE, method, args);
  const chainMs = async () => {
    const r = await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "block", params: { finality: "optimistic" } }) })).json();
    return Number(BigInt(r.result.header.timestamp_nanosec) / 1_000_000n);
  };
  const waitUntil = async (ns, slackMs = 2000) => {
    const target = Number(BigInt(ns) / 1_000_000n) + slackMs;
    while ((await chainMs()) < target) await sleep(5000);
  };
  /** One call, to FINAL; the hash is recorded; a failed receipt throws. */
  const send = async (accountId, step, call) => {
    const r = await accountOf(accountId).callFunctionRaw({ contractId: call.receiverId, methodName: call.methodName, args: call.args ?? {}, deposit: call.deposit ?? 0n, gas: call.gas ?? 100_000_000_000_000n, waitUntil: "FINAL" });
    const failure = [r.status, ...(r.receipts_outcome ?? []).map((o) => o.outcome.status)].find((s) => s && typeof s === "object" && "Failure" in s);
    const hash = r.transaction?.hash ?? r.transaction_outcome?.id;
    record(step, accountId, call.methodName, hash);
    if (failure) throw new Error(`${step}: ${JSON.stringify(failure).slice(0, 400)}`);
    const sv = r.status?.SuccessValue;
    return { hash, value: sv ? JSON.parse(Buffer.from(sv, "base64").toString()) : undefined, logs: (r.receipts_outcome ?? []).flatMap((o) => o.outcome.logs) };
  };
  const save = (extra = {}) => writeFileSync(outPath, `${JSON.stringify({ note: "UM-124: one epoch of six named agents on NEAR testnet; hashes and names only", circle: CIRCLE, circleId: CIRCLE_ID, release: TAG, wasmSha256: sha, token: USDT, keeper: KEEPER, agents: AGENT_ACCOUNTS, params: PARAMS, ...extra, steps }, null, 2)}\n`);

  // ---- 1. the circle account, the contract, `new`
  console.log("\n== 1. circle");
  if (!(await balance(CIRCLE))) {
    const key = KeyPair.fromRandom("ed25519");
    await accountOf(OWNER).createAccount({ newAccountId: CIRCLE, publicKey: key.getPublicKey(), nearToTransfer: BigInt(parseNearAmount("9")) });
    const file = join(keysDir, "testnet", `${CIRCLE}.json`);
    writeFileSync(file, JSON.stringify({ account_id: CIRCLE, secret_key: key.toString() }), { mode: 0o600 });
    record("create circle account (9 NEAR from owner)", OWNER, "create_account", "see account history");
  }
  const circleAccount = accountOf(CIRCLE);
  const deployed = await circleAccount.deployContract(wasm);
  record("deploy v0.0.13 wasm", CIRCLE, "deploy_contract", deployed.transaction?.hash ?? deployed.transaction_outcome?.id);
  await send(CIRCLE, "new", { receiverId: CIRCLE, methodName: "new", args: { owner_id: OWNER, circle_id: CIRCLE_ID, usdt_token_id: USDT, intents_id: INTENTS, params: PARAMS } });
  save();

  // ---- 2. the six agents join with a stake of 150 credit (mint, join, stake in parallel per agent)
  console.log("\n== 2. agents join");
  const circleView = core.createCircleViewFn({ circleContract: CIRCLE, rpcUrls: [RPC] });
  const voucherKeys = {};
  await Promise.all(
    names.map(async (name) => {
      const id = AGENT_ACCOUNTS[name];
      await send(id, `mint stake ${name}`, { receiverId: USDT, methodName: "mint", args: { account_id: id, amount: STAKE }, gas: 30_000_000_000_000n });
      const joined = await core.onboardMember(
        {
          view: circleView, pollIntervalMs: 2000, timeoutMs: 90_000,
          sendCall: async (c) => (await send(id, `${c.methodName === "join" ? "join" : "stake"} ${name}`, { receiverId: c.receiverId, methodName: c.methodName, args: c.args, deposit: c.deposit, gas: c.gas })).value,
        },
        { circleContract: CIRCLE, circleId: CIRCLE_ID, accountId: id, termsHash: TERMS_HASH, stakeAmount: STAKE, usdtTokenId: USDT },
      );
      voucherKeys[name] = joined.secretKey;
    }),
  );
  save();

  // ---- 3. the trades: each agent signs one cumulative voucher per service it bought and registers it itself
  console.log("\n== 3. vouchers");
  let epochInfo = await view("get_epoch");
  const epoch = epochInfo.epoch;
  const left = Number(BigInt(epochInfo.cutoff_at) / 1_000_000n) - (await chainMs());
  if (epochInfo.phase !== "open" || left < 60_000) throw new Error(`epoch ${epoch} is ${epochInfo.phase} with ${Math.round(left / 1000)} s to its cutoff: too late to register; the onboarding took too long, run the script again on a new circle account`);
  const t0 = Date.now();
  const sent = {};
  await Promise.all(
    names.map(async (buyer) => {
      const seq = new Map();
      for (const t of trades.filter((x) => x.buyer === buyer)) {
        const n = (seq.get(t.seller) ?? 0) + 1;
        seq.set(t.seller, n);
        const { signature, ...voucher } = core.signVoucher({ circle: CIRCLE, payer: AGENT_ACCOUNTS[buyer], payee: AGENT_ACCOUNTS[t.seller], epoch, seq: n, cumulativeAmount: (BigInt(t.credit) * CREDIT).toString(), unit: "credit", resource: `x207:service:${t.seller}` }, voucherKeys[buyer]);
        const r = await send(AGENT_ACCOUNTS[buyer], `voucher ${buyer}->${t.seller} ${t.credit}`, { receiverId: CIRCLE, methodName: "register_cumulative", args: { voucher, signature }, gas: 50_000_000_000_000n });
        (sent[buyer] ??= []).push({ to: t.seller, credit: t.credit, hash: r.hash });
      }
    }),
  );
  const obligations = await view("list_obligations", { epoch, from_index: 0, limit: 200 });
  if (obligations.length !== trades.length) throw new Error(`${obligations.length} obligations on chain, ${trades.length} trades sent`);
  const registerSeconds = Math.round((Date.now() - t0) / 1000);
  save();

  // ---- 4. cutoff, close, the clearing of the solver of this repository, proposal
  console.log("\n== 4. close, clearing, commit");
  await waitUntil(epochInfo.cutoff_at);
  const close = await send(KEEPER, "close_epoch", { receiverId: CIRCLE, methodName: "close_epoch", args: { epoch } });
  const graph = {
    circle: CIRCLE, epoch, members: Object.values(AGENT_ACCOUNTS),
    edges: obligations.map((o) => ({ debtor: o.debtor, creditor: o.creditor, amount: BigInt(o.obligation) })).sort((a, b) => (a.debtor + a.creditor < b.debtor + b.creditor ? -1 : 1)),
    totalObligation: obligations.reduce((n, o) => n + BigInt(o.obligation), 0n),
  };
  const clearing = solver.solveClearing(graph);
  if (clearing.status !== "ok") throw new Error(`solver status ${clearing.status}`);
  const submit = await send(KEEPER, "submit_clearing", { receiverId: CIRCLE, methodName: "submit_clearing", args: { epoch, edges: clearing.proposal.edges }, gas: 100_000_000_000_000n });
  epochInfo = await view("get_epoch", { epoch });
  await waitUntil(epochInfo.proposal_deadline);
  const commit = await send(KEEPER, "commit_epoch", { receiverId: CIRCLE, methodName: "commit_epoch", args: { epoch }, gas: 250_000_000_000_000n });
  const committed = await view("get_epoch", { epoch });
  const positions = await view("list_positions", { epoch, from_index: 0, limit: 100 });
  save();

  // ---- 5. the payment window: every debtor mints and pays its residual with ft_transfer_call (message settle)
  console.log("\n== 5. residuals");
  const debtors = positions.filter((p) => p.role === "debtor" && BigInt(p.amount) > 0n);
  const paid = {};
  await Promise.all(
    debtors.map(async (p) => {
      await send(p.account_id, `mint residual ${p.account_id}`, { receiverId: USDT, methodName: "mint", args: { account_id: p.account_id, amount: p.amount }, gas: 30_000_000_000_000n });
      const r = await send(p.account_id, `settle ${p.account_id} ${p.amount}`, { receiverId: USDT, methodName: "ft_transfer_call", deposit: 1n, gas: 100_000_000_000_000n, args: { receiver_id: CIRCLE, amount: p.amount, msg: JSON.stringify({ action: "settle", epoch }) } });
      paid[p.account_id] = { amount: p.amount, hash: r.hash };
    }),
  );
  save();

  // ---- 6. finalize, claims
  console.log("\n== 6. finalize and claims");
  epochInfo = await view("get_epoch", { epoch });
  await waitUntil(epochInfo.payment_deadline);
  const fin = await send(KEEPER, "finalize_epoch", { receiverId: CIRCLE, methodName: "finalize_epoch", args: { epoch }, gas: 200_000_000_000_000n });
  const finalState = await view("get_epoch", { epoch });
  const creditors = positions.filter((p) => p.role === "creditor" && BigInt(p.amount) > 0n);
  const claims = {};
  for (const c of creditors) {
    const r = await send(c.account_id, `claim ${c.account_id}`, { receiverId: CIRCLE, methodName: "claim", args: { epoch, destination: "near" }, deposit: 1n });
    claims[c.account_id] = { claimable: c.amount, hash: r.hash, status: (await view("net_position", { epoch, account_id: c.account_id })).status };
  }

  // ---- 7. one line per agent
  const byAccount = Object.fromEntries(names.map((n) => [AGENT_ACCOUNTS[n], n]));
  const perAgent = names.map((name) => {
    const id = AGENT_ACCOUNTS[name];
    const out = trades.filter((t) => t.buyer === name);
    const inn = trades.filter((t) => t.seller === name);
    const pos = positions.find((p) => p.account_id === id);
    return {
      agent: name, account: id,
      bought: { vouchers: out.length, credit: out.reduce((n, t) => n + t.credit, 0), from: out.map((t) => t.seller) },
      sold: { vouchers: inn.length, credit: inn.reduce((n, t) => n + t.credit, 0), to: inn.map((t) => t.buyer) },
      netTradeCredit: net[name] ?? 0,
      position: pos ? { role: pos.role, amount: pos.amount, status: pos.status } : null,
      residualPaid: paid[id] ?? null,
      claim: claims[id] ?? null,
    };
  });
  const cleared = BigInt(committed.total_cleared);
  const obligation = BigInt(committed.total_obligation);
  save({
    epoch,
    result: {
      vouchers: trades.length, registerSeconds, obligation: obligation.toString(), cleared: cleared.toString(), clearedRatio: Math.round(Number((cleared * 10000n) / obligation)) / 10000,
      clearingEdges: clearing.proposal.edges.length, debtors: debtors.length, creditors: creditors.length, finalPhase: finalState.phase,
      hashes: { closeEpoch: close.hash, submitClearing: submit.hash, commitEpoch: commit.hash, finalizeEpoch: fin.hash },
    },
    perAgent, byAccount,
  });
  console.log(`\nepoch ${epoch}: ${trades.length} vouchers, obligation ${Number(obligation) / 1e6}, cleared ${Number(cleared) / 1e6}, phase ${finalState.phase}; written to ${outPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  });
}
