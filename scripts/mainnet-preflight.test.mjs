// The preflight evaluates a snapshot without a network (UM-009). It must say what is missing, must not call a state-changing RPC method, and must hold no key.
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLAN, accountsFromEnv, base58ToHex, evaluate, missingVariables, render } from "./mainnet-preflight.mjs";

const agent = (n, near, usdtUnits, usdtRegistered = true) => ({ id: `${n}.x207-circle.near`, role: "agent", label: `agent ${n}`, exists: true, nearYocto: String(BigInt(Math.round(near * 1e4)) * 10n ** 20n), usdtUnits, usdtRegistered });
const okSnapshot = () => ({
  accounts: [
    { id: "x207-circle.near", role: "circle", label: "circle contract", exists: true, nearYocto: String(9n * 10n ** 24n) },
    agent("translator", 0.3, 3_000_000n),
  ],
  circle: { hasCode: true, interfaceVersion: "0.0.8", owner: "dao.sputnik-dao.near" },
  usdtContract: { ok: true, decimals: 6, symbol: "USDt" },
  intents: { hasCode: true, simulateOk: true },
  oneClick: { tokensOk: true, usdtListed: true, baseUsdcListed: true, quote: "unchecked", quoteNote: "needs ONECLICK_JWT" },
});

test("TC-UM-009-10 a complete snapshot has nothing MISSING and lists the dry quote as NOT CHECKED without a JWT", () => {
  const rows = evaluate(okSnapshot());
  assert.equal(rows.filter((r) => r.status === "MISSING").length, 0);
  assert.equal(rows.find((r) => r.item === "dry quote").status, "NOT CHECKED");
});

test("TC-UM-009-11 short balances, an unregistered agent, a missing account and a missing contract are each reported", () => {
  const snapshot = okSnapshot();
  snapshot.accounts = [
    { id: "x207-circle.near", role: "circle", label: "circle contract", exists: true, nearYocto: String(2n * 10n ** 24n) },
    agent("translator", 0.05, 1_000_000n),
    agent("scraper", 1, 0n, false),
    { id: "keeper.near", role: "keeper", label: "keeper", exists: false, nearYocto: "0" },
  ];
  snapshot.circle = { hasCode: false };
  snapshot.intents = { hasCode: true, simulateOk: false };
  snapshot.oneClick = { tokensOk: true, usdtListed: true, baseUsdcListed: false, quote: "fail", quoteNote: "HTTP 401" };
  const missing = evaluate(snapshot).filter((r) => r.status === "MISSING").map((r) => `${r.area}:${r.item}`);
  assert.deepEqual(missing.sort(), [
    "1Click:USDC on Base listed", "1Click:dry quote", "Intents:simulate_intents (empty list)", "NEAR:agent translator", "NEAR:circle contract",
    "USDT:agent scraper", "USDT:agent translator", "account:keeper", "circle:contract code",
  ].sort());
});

test("TC-UM-009-15 intents_balance is shown when the circle has the view, and left out when it has not", () => {
  const withView = okSnapshot();
  withView.circle.intentsBalance = 2_500_000n;
  assert.match(evaluate(withView).find((r) => r.item === "intents_balance").detail, /^2\.5 USDT/);
  assert.equal(evaluate(okSnapshot()).some((r) => r.item === "intents_balance"), false);
});

test("TC-UM-009-12 accounts and missing variables come from the names of .env.example", () => {
  const env = { X207_CIRCLE_ACCOUNT_ID: "c.near", X207_AGENT_GPU_ACCOUNT_ID: "gpu.c.near", X207_KEEPER_ACCOUNT_ID: "k.near" };
  assert.deepEqual(accountsFromEnv(env).map((a) => a.role), ["circle", "agent", "keeper"]);
  assert.ok(missingVariables(env).includes("X207_SOLVER_ACCOUNT_ID"));
  assert.ok(!missingVariables(env).includes("X207_KEEPER_ACCOUNT_ID"));
  const names = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  for (const name of missingVariables({})) assert.ok(names.includes(name), `${name} is not in .env.example`);
});

test("TC-UM-009-13 the script reads views only: no signing, no transaction method, no secret key variable", () => {
  const source = readFileSync(new URL("./mainnet-preflight.mjs", import.meta.url), "utf8");
  for (const word of ["broadcast_tx", "send_tx", "KeyPair", "SECRET_KEY", "PRIVATE_KEY", "signTransaction", "callFunctionRaw"]) assert.ok(!source.includes(word), `uses ${word}`);
  assert.ok(source.includes('"call_function"') && source.includes('"view_account"'));
  assert.ok(PLAN.nearMin.circle >= 5.6, "the circle minimum covers the measured code storage");
});

test("TC-UM-009-14 the table is printed with one line per check", () => {
  const rows = evaluate(okSnapshot());
  assert.equal(render(rows).split("\n").length, rows.length);
});

test("TC-UM-009-16 the code hash of the circle account is compared with the sha256 of the release wasm", () => {
  const ok = okSnapshot();
  assert.equal(evaluate(ok).find((r) => r.item === "code_hash against the release").status, "NOT CHECKED");
  ok.circle.codeHashHex = "ab".repeat(32);
  ok.circle.expectedWasmSha256 = "AB".repeat(32);
  assert.equal(evaluate(ok).find((r) => r.item === "code_hash against the release").status, "OK");
  ok.circle.expectedWasmSha256 = "cd".repeat(32);
  assert.equal(evaluate(ok).find((r) => r.item === "code_hash against the release").status, "MISSING");
});

test("TC-UM-009-17 base58ToHex turns a NEAR code_hash into the hex of the sha256 ", () => {
  // "11111111111111111111111111111111" is the hash of an account without code: 32 zero bytes
  assert.equal(base58ToHex("11111111111111111111111111111111"), "00".repeat(32));
  assert.equal(base58ToHex("2"), "01");
  assert.equal(base58ToHex("5Q"), "ff");
  assert.equal(base58ToHex("12"), "0001"); // a leading 1 is a zero byte
});
