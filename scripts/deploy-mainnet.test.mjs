// UM-009: the guards of scripts/deploy-mainnet.mjs, without any network. Run: node --test scripts/deploy-mainnet.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DeployError, KNOWN_SHA256, base58OfHex, fetchRelease, inspect, parseArgs, planFrom, sumOf } from "./deploy-mainnet.mjs";
import { estimateCosts, reserveNear } from "./lib/costs.mjs";

const base = ["--network", "mainnet", "--circle", "x207-circle.near", "--owner", "x207.sputnik-dao.near", "--release", "v0.0.16"];
const refuses = (argv, pattern) => assert.throws(() => planFrom(parseArgs(argv)), (e) => e instanceof DeployError && pattern.test(e.message));

test("TC-UM-009-D01 (CT-049) nothing is sent by default; mainnet --execute needs --yes-owner-approved, and --yes alone means nothing", () => {
  assert.equal(planFrom(parseArgs(base)).send, false);
  assert.equal(planFrom(parseArgs([...base, "--dry-run"])).send, false);
  refuses([...base, "--execute"], /--yes-owner-approved/);
  refuses([...base, "--yes-owner-approved"], /together with --execute/);
  refuses([...base, "--execute", "--dry-run", "--yes-owner-approved"], /exclude each other/);
  assert.equal(planFrom(parseArgs([...base, "--execute", "--yes-owner-approved", "--keys-dir", "/safe/keys"])).send, true);
});

test("TC-CT-049-D01 the sha256 is pinned: v0.0.13 is known, another tag on mainnet needs --expect-sha256, a bad number is refused", () => {
  const v13 = ["--network", "mainnet", "--circle", "x207-circle.near", "--owner", "x207.sputnik-dao.near", "--release", "v0.0.13"];
  assert.equal(planFrom(parseArgs(v13)).expectSha256, KNOWN_SHA256["v0.0.13"]);
  assert.equal(KNOWN_SHA256["v0.0.13"], "b9327f2b5d64b1180ba76dd619c6091ae57b48964f520a784e366c131e787054");
  assert.equal(base58OfHex(KNOWN_SHA256["v0.0.13"]), "DTw5rUUdJSbWjD361MmBxKW4nm4ETnNkex63mfUCjsjh");
  // CT-119: an unlisted tag needs --expect-sha256; a listed tag cannot be re-pinned; v0.0.16 is listed
  const v99 = [...base.slice(0, -1), "v0.0.99"];
  assert.equal(planFrom(parseArgs([...v99, "--expect-sha256", "a".repeat(64)])).expectSha256, "a".repeat(64));
  refuses(v99, /no pinned sha256 for v0\.0\.99/);
  refuses([...base, "--expect-sha256", "a".repeat(64)], /conflicts with the pinned sha256 of v0\.0\.16/);
  assert.equal(planFrom(parseArgs(base)).expectSha256, KNOWN_SHA256["v0.0.16"]);
  assert.equal(planFrom(parseArgs([...base, "--expect-sha256", KNOWN_SHA256["v0.0.16"]])).expectSha256, KNOWN_SHA256["v0.0.16"]);
  refuses([...v99, "--expect-sha256", "XYZ"], /64 lowercase hex/);
  refuses(["--network", "testnet", "--circle", "c.testnet", "--owner", "d.testnet", "--usdt", "u.testnet", "--wasm", "/tmp/x.wasm"], /no pinned sha256 for this wasm/);
  refuses(["--network", "mainnet", "--circle", "x207-circle.near", "--owner", "x207.sputnik-dao.near", "--wasm", "/tmp/x.wasm"], /--release <tag> or --expect-sha256/);
});

test("TC-CT-049-D02 costs per account come from the size of the wasm and the reserve rule", () => {
  const r = estimateCosts({ wasmBytes: 682707 });
  const by = Object.fromEntries(r.rows.map((x) => [x.account, x]));
  assert.ok(by.circle.minimum > 6.8 && by.circle.recommended < 9);
  assert.ok(by.keeper.minimum >= 0.16 && by.keeper.minimum < 0.2);
  assert.ok(by.solver.minimum >= 0.07 && by.solver.minimum < 0.1);
  assert.equal(reserveNear(150), 0.1509);
  assert.throws(() => estimateCosts({ wasmBytes: 0 }), /wasmBytes/);
});

test("TC-UM-009-D02 --network is required and only testnet and mainnet exist; the account names must belong to the network", () => {
  refuses(base.slice(2), /--network is required/);
  refuses(["--network", "betanet", ...base.slice(2)], /only testnet and mainnet/);
  refuses(["--network", "mainnet", "--circle", "x.testnet", "--owner", "x207.sputnik-dao.near", "--release", "v1", "--dry-run"], /not a mainnet account/);
  refuses(["--network", "testnet", "--circle", "x.testnet", "--owner", "dao.near", "--release", "v1", "--usdt", "u.testnet"], /not a testnet account/);
});

test("TC-UM-009-D03 the owner is not the contract itself; on mainnet the token and Intents are the real ones and a testnet keys folder is refused", () => {
  refuses(["--network", "mainnet", "--circle", "a.near", "--owner", "a.near", "--release", "v1", "--dry-run"], /must be the DAO/);
  refuses([...base, "--usdt", "fake.near"], /usdt.tether-token.near/);
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

test("TC-CT-049-D03 print-class-proposals: one command per class, those already registered are left out, nothing signs", async () => {
  const { commandsFor } = await import("./print-class-proposals.mjs");
  const { CATALOG, toArgs } = await import("./lib/asset-catalog.mjs");
  const o = { network: "mainnet", dao: "x207.sputnik-dao.near", contract: "x207-circle.near", signer: "a.near" };
  const all = commandsFor(o);
  assert.equal(all.length, CATALOG.length);
  assert.match(all[0].command, /^near contract call-function as-transaction x207\.sputnik-dao\.near add_proposal/);
  assert.match(all[0].command, /sign-as a\.near network-config mainnet/);
  const existing = new Map([[CATALOG[0].assetType, toArgs(CATALOG[0]).entry]]);
  assert.equal(commandsFor({ ...o, existing }).length, CATALOG.length - 1);
  assert.equal(commandsFor({ ...o, only: [CATALOG[1].assetType] }).length, 1);
});

// CT-119: the `--release` path with a stubbed `gh`: the download is checked against SHA256SUMS, and the number that the run is pinned to is a separate check
const stubGh = (wasmBytes, sumsHex) => (cmd, args) => {
  assert.equal(cmd, "gh");
  const dir = args[args.indexOf("-D") + 1];
  const tag = args[2];
  writeFileSync(join(dir, `x207-circle-${tag}.wasm`), wasmBytes);
  writeFileSync(join(dir, "SHA256SUMS"), `${sumsHex}  x207-circle-${tag}.wasm\n`);
  return { status: 0, stdout: "", stderr: "" };
};

test("TC-CT-119-D01 --release path with a stubbed gh: the wasm must match SHA256SUMS, and the pin of a listed tag cannot be replaced", () => {
  const wasm = Buffer.from("fake wasm of v0.0.16");
  const sha = createHash("sha256").update(wasm).digest("hex");
  const got = fetchRelease("v0.0.16", stubGh(wasm, sha));
  assert.equal(got.sha, sha);
  assert.throws(() => fetchRelease("v0.0.16", stubGh(wasm, "0".repeat(64))), (e) => e instanceof DeployError && /SHA256SUMS says/.test(e.message));
  assert.throws(() => fetchRelease("v0.0.16", () => ({ status: 1, stdout: "", stderr: "not found" })), (e) => e instanceof DeployError && /gh release download/.test(e.message));
  // the run is pinned to the list: a download whose sha is not KNOWN_SHA256["v0.0.16"] (even with matching SHA256SUMS) is not the pinned release
  assert.notEqual(got.sha, KNOWN_SHA256["v0.0.16"]);
  const args = ["--network", "testnet", "--circle", "c.testnet", "--owner", "d.testnet", "--usdt", "u.testnet"];
  assert.equal(planFrom(parseArgs([...args, "--release", "v0.0.16"])).expectSha256, KNOWN_SHA256["v0.0.16"]);
  // v0.0.15 with the pin of v0.0.16 is refused before anything is downloaded
  assert.throws(
    () => planFrom(parseArgs([...args, "--release", "v0.0.15", "--expect-sha256", KNOWN_SHA256["v0.0.16"]])),
    (e) => e instanceof DeployError && /conflicts with the pinned sha256 of v0\.0\.15/.test(e.message),
  );
});
