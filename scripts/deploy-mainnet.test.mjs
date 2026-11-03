// UM-009: the guards of scripts/deploy-mainnet.mjs, without any network. Run: node --test scripts/deploy-mainnet.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { DeployError, base58OfHex, inspect, parseArgs, planFrom, sumOf } from "./deploy-mainnet.mjs";

const base = ["--network", "mainnet", "--circle", "x207-circle.near", "--owner", "x207.sputnik-dao.near", "--release", "v0.0.12"];
const refuses = (argv, pattern) => assert.throws(() => planFrom(parseArgs(argv)), (e) => e instanceof DeployError && pattern.test(e.message));

test("TC-UM-009-D01 mainnet refuses to send without --yes-owner-approved, and a dry run is allowed", () => {
  refuses(base, /--yes-owner-approved/);
  assert.equal(planFrom(parseArgs([...base, "--dry-run"])).send, false);
  assert.equal(planFrom(parseArgs([...base, "--yes-owner-approved", "--keys-dir", "/safe/keys"])).send, true);
});

test("TC-UM-009-D02 --network is required and only testnet and mainnet exist; the account names must belong to the network", () => {
  refuses(base.slice(2), /--network is required/);
  refuses(["--network", "betanet", ...base.slice(2)], /only testnet and mainnet/);
  refuses(["--network", "mainnet", "--circle", "x.testnet", "--owner", "x207.sputnik-dao.near", "--release", "v1", "--dry-run"], /not a mainnet account/);
  refuses(["--network", "testnet", "--circle", "x.testnet", "--owner", "dao.near", "--release", "v1", "--usdt", "u.testnet"], /not a testnet account/);
});

test("TC-UM-009-D03 the owner is not the contract itself; on mainnet the token and Intents are the real ones and a testnet keys folder is refused", () => {
  refuses(["--network", "mainnet", "--circle", "a.near", "--owner", "a.near", "--release", "v1", "--dry-run"], /must be the DAO/);
  refuses([...base, "--dry-run", "--usdt", "fake.near"], /usdt.tether-token.near/);
  refuses([...base, "--dry-run", "--intents", "fake.near"], /intents.near/);
  refuses([...base, "--yes-owner-approved", "--keys-dir", "/x/.secrets/testnet-deployer"], /testnet folder/);
  const plan = planFrom(parseArgs([...base, "--dry-run"]));
  assert.deepEqual([plan.usdt, plan.intents], ["usdt.tether-token.near", "intents.near"]);
  assert.equal(plan.initArgs.owner_id, "x207.sputnik-dao.near");
});

test("TC-UM-009-D04 testnet needs --usdt; the arguments are strict", () => {
  refuses(["--network", "testnet", "--circle", "c.testnet", "--owner", "d.sputnikv2.testnet", "--release", "v1"], /--usdt is required/);
  assert.throws(() => parseArgs(["--bogus"]), /unknown argument/);
  assert.throws(() => parseArgs(["--network"]), /needs a value/);
});

test("TC-UM-009-D05 sha256 of the release: the SHA256SUMS line is found by name, and the code_hash is the base58 of the sha256", () => {
  const sums = "a9d0c839149a6e84ce4f87c1898b2cf871d2eda117f1988e13d0c59ae13a2f39  x207-circle-v0.0.11.wasm\n3202e5c2393ad1c81d44b9b40e918975f43a0ed0d935490dc8ff3a97e9516867  abi-v0.0.11.json\n";
  assert.equal(sumOf(sums, "x207-circle-v0.0.11.wasm"), "a9d0c839149a6e84ce4f87c1898b2cf871d2eda117f1988e13d0c59ae13a2f39");
  assert.throws(() => sumOf(sums, "other.wasm"), /no line/);
  assert.equal(base58OfHex("a9d0c839149a6e84ce4f87c1898b2cf871d2eda117f1988e13d0c59ae13a2f39"), "CRtYqTc47ADcDkHp7UJaRPLXu5XHS7KYftrTNUnZ8bNx");
});

test("TC-UM-009-D06 inspect: a non-DAO owner, a token with the wrong decimals, a missing Intents on mainnet and an empty circle account are problems", async () => {
  const plan = planFrom(parseArgs([...base, "--dry-run"]));
  const provider = {
    callFunction: async ({ contractId, method }) => {
      if (method === "get_policy") throw new Error("MethodNotFound");
      if (method === "ft_metadata") return { symbol: "USDt", decimals: 18 };
      throw new Error(`${contractId}.${method}`);
    },
    viewAccount: async ({ accountId }) => {
      if (accountId === "intents.near") throw new Error("UNKNOWN_ACCOUNT");
      return { amount: String(2n * 10n ** 24n), code_hash: "11111111111111111111111111111111" };
    },
  };
  const { problems } = await inspect(plan, provider, "X");
  const text = problems.join("\n");
  for (const want of [/not a Sputnik DAO/, /18 decimals/, /intents.near has no code/, /less than 8 NEAR/]) assert.match(text, want);
  const ok = await inspect(plan, { ...provider, callFunction: async ({ method }) => (method === "get_policy" ? { roles: [] } : { symbol: "USDt", decimals: 6 }), viewAccount: async ({ accountId }) => ({ amount: String(9n * 10n ** 24n), code_hash: accountId === "intents.near" ? "AbCdEf" : "11111111111111111111111111111111" }) }, "X");
  assert.deepEqual(ok.problems, []);
});
