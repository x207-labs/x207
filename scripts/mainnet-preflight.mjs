#!/usr/bin/env node
// UM-009 / UM-040 preflight for the mainnet rehearsals: READS only, signs and sends nothing, holds no secret key. It reads the accounts of
// `.env.example` (from the environment), their NEAR and USDT balances, the circle contract, the USDT contract, `intents.near` and 1Click, and
// prints what is missing. The only secret that it may read is `ONECLICK_JWT` (for a dry quote), from the environment, never printed.
//
//   node scripts/mainnet-preflight.mjs [--json]
//   X207_CIRCLE_ACCOUNT_ID=... X207_KEEPER_ACCOUNT_ID=... (see .env.example) node scripts/mainnet-preflight.mjs
//   X207_PREFLIGHT_NETWORK=testnet X207_PREFLIGHT_RPC_URLS=... also works against testnet (the USDT contract must then be given).
//
// Exit code 0 when nothing is MISSING, 1 otherwise. "NOT CHECKED" is not a failure but is listed: it means the check needs something that is not set.
//
// The minimums below are ESTIMATES. NEAR figures follow the storage and gas measured on testnet on 2026-11-03 (same prices as mainnet), with a
// margin; USDT figures are a proposal for a small nominal amount. They are in docs/mainnet-runbook.md and the owner may change them in the environment.
import { fileURLToPath } from "node:url";

export const PLAN = {
  /** Minimum NEAR per role (estimate). */
  nearMin: { circle: 8, dao: 0, agent: 0.2, keeper: 0.5, solver: 0.5, relayer: 1.5, daoMember: 0.5 },
  /** NEAR the owner account needs once, to create the Sputnik DAO through the factory (estimate: 7 NEAR deposit of the factory plus gas). */
  daoFactoryDeposit: 7.2,
  /** USDT (smallest unit 1e-6) every agent must hold: stake plus spare for the residual payment (estimate, small nominal). */
  agentUsdtMin: 3_000_000n,
  stakeUsdt: 2_000_000n,
};

export const DEFAULTS = {
  mainnet: { rpc: ["https://rpc.mainnet.fastnear.com", "https://rpc.mainnet.near.org"], usdt: "usdt.tether-token.near", intents: "intents.near", oneClick: "https://1click.chaindefuser.com" },
  testnet: { rpc: ["https://rpc.testnet.fastnear.com"], usdt: undefined, intents: "intents.testnet", oneClick: "https://1click.chaindefuser.com" },
};

const AGENTS = ["TRANSLATOR", "SUMMARIZER", "SCRAPER", "IMAGE", "CLEANER", "GPU"];

/** Accounts of the plan from the environment: { id, role, label }. Names are `.env.example`. */
export function accountsFromEnv(env) {
  const list = [];
  const add = (key, role, label) => {
    if (env[key]) list.push({ id: env[key], role, label });
  };
  add("X207_CIRCLE_ACCOUNT_ID", "circle", "circle contract");
  for (const a of AGENTS) add(`X207_AGENT_${a}_ACCOUNT_ID`, "agent", `agent ${a.toLowerCase()}`);
  add("X207_KEEPER_ACCOUNT_ID", "keeper", "keeper");
  add("X207_SOLVER_ACCOUNT_ID", "solver", "solver");
  add("X207_FACILITATOR_RELAYER_ACCOUNT_ID", "relayer", "facilitator relayer");
  add("X207_DAO_MEMBER_ACCOUNT_ID", "daoMember", "DAO council member");
  return list;
}

/** Names of the variables that the plan needs and the environment lacks. */
export function missingVariables(env) {
  const need = ["X207_CIRCLE_ACCOUNT_ID", ...AGENTS.map((a) => `X207_AGENT_${a}_ACCOUNT_ID`), "X207_KEEPER_ACCOUNT_ID", "X207_SOLVER_ACCOUNT_ID", "X207_FACILITATOR_RELAYER_ACCOUNT_ID", "X207_DAO_MEMBER_ACCOUNT_ID"];
  return need.filter((name) => !env[name]);
}

const near = (yocto) => Number(BigInt(yocto) / 10n ** 20n) / 10_000;
const usdt = (units) => Number(units) / 1_000_000;

/**
 * Pure evaluation of a snapshot (so that tests need no network). `snapshot`:
 * { accounts: [{ id, role, label, exists, nearYocto, usdtUnits, usdtRegistered }], circle: { hasCode, interfaceVersion, owner }, usdtContract: { ok, decimals, symbol },
 *   intents: { hasCode, simulateOk }, oneClick: { tokensOk, usdtListed, baseUsdcListed, quote: "ok"|"fail"|"unchecked", quoteNote } }
 * returns [{ area, item, status: "OK"|"MISSING"|"NOT CHECKED"|"INFO", detail }]
 */
export function evaluate(snapshot, plan = PLAN) {
  const rows = [];
  const row = (area, item, status, detail) => rows.push({ area, item, status, detail });
  for (const a of snapshot.accounts) {
    if (!a.exists) {
      row("account", a.label, "MISSING", `${a.id} does not exist on this network`);
      continue;
    }
    const min = plan.nearMin[a.role] ?? 0;
    const have = near(a.nearYocto);
    row("NEAR", a.label, have >= min ? "OK" : "MISSING", `${a.id}: ${have} NEAR, needs about ${min} (estimate)${have >= min ? "" : `; short by ${(min - have).toFixed(4)}`}`);
    if (a.role === "agent") {
      if (a.usdtRegistered === false) row("USDT", a.label, "MISSING", `${a.id} is not registered on the USDT contract (storage_deposit)`);
      else row("USDT", a.label, a.usdtUnits >= plan.agentUsdtMin ? "OK" : "MISSING", `${a.id}: ${usdt(a.usdtUnits)} USDT, needs about ${usdt(plan.agentUsdtMin)} (stake ${usdt(plan.stakeUsdt)} plus spare; estimate)`);
    }
  }
  const circle = snapshot.circle;
  if (!circle.hasCode) row("circle", "contract code", "MISSING", "the circle account has no contract yet (deploy is a step of the runbook)");
  else {
    row("circle", "interface version", circle.interfaceVersion ? "OK" : "MISSING", `interface_version ${circle.interfaceVersion ?? "unreadable"}`);
    row("circle", "owner", circle.owner ? "INFO" : "MISSING", `get_owner: ${circle.owner ?? "unreadable"}`);
  }
  const t = snapshot.usdtContract;
  row("USDT", "token contract", t.ok && t.decimals === 6 ? "OK" : "MISSING", t.ok ? `${t.symbol}, ${t.decimals} decimals` : "ft_metadata unreadable");
  row("Intents", "intents contract", snapshot.intents.hasCode ? "OK" : "MISSING", snapshot.intents.hasCode ? "has code" : "no contract code");
  row("Intents", "simulate_intents (empty list)", snapshot.intents.simulateOk ? "OK" : "MISSING", snapshot.intents.simulateOk ? "answered, no state touched" : "view failed");
  const o = snapshot.oneClick;
  row("1Click", "token list", o.tokensOk ? "OK" : "MISSING", o.tokensOk ? "reachable" : "not reachable");
  if (o.tokensOk) {
    row("1Click", "USDT on NEAR listed", o.usdtListed ? "OK" : "MISSING", "nep141 USDT as origin asset");
    row("1Click", "USDC on Base listed", o.baseUsdcListed ? "OK" : "MISSING", "destination of the creditor withdrawal");
  }
  row("1Click", "dry quote", o.quote === "ok" ? "OK" : o.quote === "fail" ? "MISSING" : "NOT CHECKED", o.quoteNote);
  return rows;
}

function rpcClient(urls) {
  const call = async (method, params) => {
    const failures = [];
    for (const url of urls) {
      try {
        const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "x207", method, params }), signal: AbortSignal.timeout(15_000) });
        if (!response.ok) {
          failures.push(`${url}: HTTP ${response.status}`);
          continue;
        }
        const body = await response.json();
        if (body.error) throw Object.assign(new Error(JSON.stringify(body.error.cause ?? body.error)), { rpc: true });
        return body.result;
      } catch (error) {
        if (error.rpc) throw error;
        failures.push(`${url}: ${error.message}`);
      }
    }
    throw new Error(`all RPC endpoints failed (${failures.join("; ")})`);
  };
  const view = async (contract, method, args = {}) => {
    const r = await call("query", { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
    return JSON.parse(Buffer.from(r.result).toString("utf8"));
  };
  const account = async (id) => {
    try {
      return await call("query", { request_type: "view_account", finality: "final", account_id: id });
    } catch (error) {
      if (error.rpc && /UnknownAccount|does not exist/i.test(error.message)) return null;
      throw error;
    }
  };
  return { call, view, account };
}

export async function collect(env, net = "mainnet") {
  const d = DEFAULTS[net];
  const rpc = rpcClient((env.X207_PREFLIGHT_RPC_URLS ?? "").split(",").map((u) => u.trim()).filter(Boolean).concat(d.rpc).slice(0, 4));
  const usdtId = env.X207_USDT_CONTRACT_ID || d.usdt;
  const intentsId = env.X207_INTENTS_CONTRACT_ID || d.intents;
  const accounts = [];
  for (const a of accountsFromEnv(env)) {
    const state = await rpc.account(a.id);
    const entry = { ...a, exists: state !== null, nearYocto: state?.amount ?? "0" };
    if (state && a.role === "agent" && usdtId) {
      const storage = await rpc.view(usdtId, "storage_balance_of", { account_id: a.id }).catch(() => undefined);
      entry.usdtRegistered = storage === undefined ? undefined : storage !== null;
      entry.usdtUnits = BigInt(await rpc.view(usdtId, "ft_balance_of", { account_id: a.id }).catch(() => "0"));
    }
    accounts.push(entry);
  }
  const circleId = env.X207_CIRCLE_ACCOUNT_ID;
  const circleState = circleId ? await rpc.account(circleId) : null;
  const circle = { hasCode: Boolean(circleState && circleState.code_hash !== "11111111111111111111111111111111") };
  if (circle.hasCode) {
    circle.interfaceVersion = await rpc.view(circleId, "interface_version").catch(() => undefined);
    circle.owner = await rpc.view(circleId, "get_owner").catch(() => undefined);
  }
  const meta = usdtId ? await rpc.view(usdtId, "ft_metadata").catch(() => undefined) : undefined;
  const usdtContract = { ok: Boolean(meta), decimals: meta?.decimals, symbol: meta?.symbol };
  const intentsState = await rpc.account(intentsId);
  const intents = {
    hasCode: Boolean(intentsState && intentsState.code_hash !== "11111111111111111111111111111111"),
    simulateOk: await rpc.view(intentsId, "simulate_intents", { signed: [] }).then(() => true, () => false),
  };
  const oneClick = { tokensOk: false, usdtListed: false, baseUsdcListed: false, quote: "unchecked", quoteNote: "needs ONECLICK_JWT and X207_PREFLIGHT_BASE_ADDRESS (a Base address that receives nothing: the quote is dry)" };
  const base = (env.ONECLICK_BASE_URL || d.oneClick).replace(/\/+$/, "");
  const headers = { "user-agent": "x207-preflight" };
  if (env.ONECLICK_JWT) headers.authorization = `Bearer ${env.ONECLICK_JWT}`;
  let tokens = [];
  try {
    const response = await fetch(`${base}/v0/tokens`, { headers, signal: AbortSignal.timeout(20_000) });
    if (response.ok) {
      tokens = await response.json();
      oneClick.tokensOk = true;
      oneClick.usdtListed = tokens.some((t) => t.assetId === `nep141:${usdtId}`);
      oneClick.baseUsdcListed = tokens.some((t) => t.blockchain === "base" && t.symbol === "USDC");
    }
  } catch {
    // reported as not reachable
  }
  if (env.ONECLICK_JWT && env.X207_PREFLIGHT_BASE_ADDRESS && oneClick.usdtListed && oneClick.baseUsdcListed && circleId) {
    const destination = tokens.find((t) => t.blockchain === "base" && t.symbol === "USDC");
    const request = {
      dry: true, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: `nep141:${usdtId}`, depositType: "INTENTS", destinationAsset: destination.assetId,
      amount: "1000000", refundTo: circleId, refundType: "INTENTS", recipient: env.X207_PREFLIGHT_BASE_ADDRESS, recipientType: "DESTINATION_CHAIN",
      deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
    };
    try {
      const response = await fetch(`${base}/v0/quote`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(request), signal: AbortSignal.timeout(30_000) });
      const text = await response.text();
      oneClick.quote = response.ok ? "ok" : "fail";
      oneClick.quoteNote = response.ok ? "dry quote for 1 USDT to USDC on Base answered" : `HTTP ${response.status}: ${text.slice(0, 160).replace(/\s+/g, " ")}`;
    } catch (error) {
      oneClick.quote = "fail";
      oneClick.quoteNote = `request failed: ${error.message}`;
    }
  }
  return { accounts, circle, usdtContract, intents, oneClick };
}

export function render(rows) {
  const width = (key) => Math.max(...rows.map((r) => String(r[key]).length));
  const [a, i, s] = [width("area"), width("item"), width("status")];
  return rows.map((r) => `${r.status.padEnd(s)}  ${r.area.padEnd(a)}  ${r.item.padEnd(i)}  ${r.detail}`).join("\n");
}

async function main(argv) {
  const net = process.env.X207_PREFLIGHT_NETWORK === "testnet" ? "testnet" : "mainnet";
  const lacking = missingVariables(process.env);
  if (lacking.length > 0) console.log(`Not set in the environment (see .env.example): ${lacking.join(", ")}\n`);
  const rows = evaluate(await collect(process.env, net));
  if (argv.includes("--json")) console.log(JSON.stringify(rows, null, 2));
  else console.log(render(rows));
  const missing = rows.filter((r) => r.status === "MISSING").length + lacking.length;
  const unchecked = rows.filter((r) => r.status === "NOT CHECKED").length;
  console.log(`\n${missing} missing, ${unchecked} not checked. Nothing was signed or sent.`);
  process.exit(missing > 0 ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
