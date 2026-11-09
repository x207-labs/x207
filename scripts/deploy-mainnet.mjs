#!/usr/bin/env node
// UM-009: deploys the circle contract from the wasm of a GitHub RELEASE, with the Sputnik DAO as owner (ADR-20), and checks that the code on chain is the code of the release.
// It is written to be rehearsed on testnet and to be run on mainnet only by the owner. CT-049: it only READS unless `--execute` is given; on mainnet `--execute` also needs
// `--yes-owner-approved`. The sha256 of a known release is pinned in the script (KNOWN_SHA256) and `--expect-sha256` pins another; a mismatch stops before anything is signed.
// Nothing in this repository ran it on mainnet.
//
//   node scripts/deploy-mainnet.mjs --network testnet|mainnet --circle <account> --owner <sputnik dao account> --release v0.0.12 \
//        [--wasm <file> (instead of the download)] [--params-file <json>] [--usdt <account>] [--intents <account>] [--circle-id agents-main] \
//        [--keys-dir <dir>] [--out <file>] [--expect-sha256 <hex>] [--execute [--yes-owner-approved]]
//
// What it does, in order, and where it stops:
//   1. arguments: `--network` is required; `--owner` must be a Sputnik DAO (view `get_policy` answers); on mainnet the token is `usdt.tether-token.near` and Intents is `intents.near`;
//   2. the wasm: downloaded with `gh release download <tag> -R x207-labs/contracts` (or `--wasm`), its sha256 compared with the `SHA256SUMS` of the release; the expected `code_hash` is the base58 of it;
//   3. views only: the owner is a DAO, the USDT contract answers `ft_metadata` with 6 decimals (testnet: a warning, the mock token has none), Intents has code (mainnet: required; testnet: a warning, `intents.testnet` has none), the circle account exists, has at
//      least 8 NEAR and holds no code (or the very code of the release);
//   4. (default, no flag) prints the plan and the `new` arguments and stops here. Nothing is signed, no key is read.
//   5. otherwise (and on mainnet only with `--yes-owner-approved`): reads the key of the circle account from `<keys-dir>/<network>/<circle>.json`, deploys the wasm, calls `new`, and checks that the `code_hash` on chain equals the
//      release, `interface_version` equals the tag, and `get_owner` answers the DAO. Every hash goes to `--out`.
// A key of testnet is never read for mainnet: the keys folder must have a `mainnet` subfolder, and a folder whose path says `testnet` is refused for mainnet.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { estimateCosts } from "./lib/costs.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));

export const NETWORKS = {
  mainnet: { rpc: ["https://rpc.mainnet.fastnear.com", "https://rpc.mainnet.near.org"], usdt: "usdt.tether-token.near", intents: "intents.near", suffix: ".near" },
  testnet: { rpc: ["https://rpc.testnet.fastnear.com"], usdt: undefined, intents: "intents.testnet", suffix: ".testnet" },
};
/** The parameters tested on testnet (runbook, decision 4). The owner may pass another file. */
export const DEFAULT_PARAMS = {
  epoch_length: 600, payment_window: 900, proposal_window: 60, base_limit_ratio: 8000, limit_growth: 1000, limit_cap: "1000000000", limit_decay: 0,
  fees: { clearing_fee_bps: 0, solver_fee_bps: 0 }, admission: "open",
};
/** Releases whose sha256 was checked by a person (reproducible build, twice, byte-identical). A tag listed here must match, whatever SHA256SUMS says. */
export const KNOWN_SHA256 = {
  // CT-111: reproducible build of commit 69b129f (scripts/repro-build.sh); the code of x207-v014.testnet
  "v0.0.15": "f832e53f01bf6b0739efb54bf0977d70544dd9bcece2234abd3e18525b4900de", // reproducible build of contracts HEAD at 3bf2044 (CT-111); the code of x207-v015.testnet
  "v0.0.16": "4295351f395d0cc31419d43adf10e5b60f3c2a0e546ae0e912c5da4fef5aebe7", // reproducible build of contracts 93f8d8e (CT-117); the code of x207-v016.testnet
  "v0.0.17": "cbb8a9108f975ba8fca86dc6f6d470e3e377b91309fce56b2ec18a77ff4a4b97", // reproducible build of contracts 83cc5d7 and of the merge d6fdd66 (CT-118); the code of x207-v017.testnet
  "v0.0.18": "4701ecce4168d18b0674b6b4af9f789219afc33be99d89c09f3a433c0bd0d198", // reproducible build of contracts f551f51 (CT-129), twice byte-identical (P1, UM-076); tag v0.0.18; the code of x207-v018.testnet since the redeploy Bx2qeVrB9z8WTH2FXnHvxp5DztEpmuJRGPaQ3SwgzTXu (the first build of 0.0.18 was e64d4ec7…, not pinned)
  "v0.0.14": "7d731dfb15db44aa3a1ca95c28616a6e2faecbf11b87de538940991da33d39f9",
  "v0.0.13": "b9327f2b5d64b1180ba76dd619c6091ae57b48964f520a784e366c131e787054",
  // not a release: the mock USDT that the quick demo deploys (UM-107, contracts/prebuilt/mock_ft.wasm; a test fixture, never for a real network)
  "mock_ft": "65d8a18be9152a4f9a62799f963c91f0542b73a68982c68c2625837252b2c897",
};
export const MIN_CIRCLE_NEAR = 8n * 10n ** 24n;
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export class DeployError extends Error {}
const fail = (message) => {
  throw new DeployError(message);
};

export function base58OfHex(hex) {
  let n = BigInt(`0x${hex}`);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  return out;
}

export function parseArgs(argv) {
  const flags = new Set(["--dry-run", "--execute", "--yes-owner-approved"]);
  const values = new Set(["--network", "--circle", "--owner", "--release", "--wasm", "--params-file", "--usdt", "--intents", "--circle-id", "--keys-dir", "--out", "--expect-sha256"]);
  const out = { dryRun: false, execute: false, yes: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--execute") out.execute = true;
    else if (a === "--yes-owner-approved") out.yes = true;
    else if (values.has(a)) {
      if (argv[i + 1] === undefined || argv[i + 1].startsWith("--")) fail(`${a} needs a value`);
      out[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[(i += 1)];
    } else fail(`unknown argument ${a}${flags.has(a) ? "" : ""}`);
  }
  return out;
}

/** Checks the arguments that need no network. Returns the plan. */
export function planFrom(args) {
  if (!args.network) fail("--network is required (testnet or mainnet)");
  const net = NETWORKS[args.network];
  if (!net) fail(`--network ${args.network}: only testnet and mainnet`);
  if (!args.circle || !args.owner) fail("--circle and --owner are required");
  if (!args.release && !args.wasm) fail("--release <tag> (or --wasm <file>) is required");
  for (const [name, id] of [["--circle", args.circle], ["--owner", args.owner]]) {
    if (!id.endsWith(net.suffix)) fail(`${name} ${id} is not a ${args.network} account (it must end with ${net.suffix})`);
  }
  if (args.circle === args.owner) fail("the owner must be the DAO, not the contract account itself (ADR-20)");
  if (args.network === "mainnet") {
    if (args.usdt && args.usdt !== net.usdt) fail(`on mainnet the token is ${net.usdt}, not ${args.usdt}`);
    if (args.intents && args.intents !== net.intents) fail(`on mainnet Intents is ${net.intents}, not ${args.intents}`);
    if (args.execute && !args.yes) fail("mainnet: refusing to send anything without --yes-owner-approved (the owner signs and funds mainnet; without --execute the script only reads)");
    if (!args.release && !args.expectSha256) fail("mainnet: pass --release <tag> or --expect-sha256 <hex>, the number a person checked");
    if (args.keysDir && /testnet/i.test(resolve(args.keysDir))) fail("mainnet: the keys folder looks like a testnet folder; a key of testnet is never used on mainnet");
  }
  if (args.execute && args.dryRun) fail("--execute and --dry-run exclude each other");
  if (args.yes && !args.execute) fail("--yes-owner-approved only means something together with --execute");
  if (args.expectSha256 && !/^[0-9a-f]{64}$/.test(args.expectSha256)) fail("--expect-sha256 must be 64 lowercase hex characters");
  const usdt = args.usdt ?? net.usdt;
  if (!usdt) fail(`--usdt is required on ${args.network}`);
  // CT-119: every run, dry run included, is pinned to a sha256 that a person checked: the list for a known tag, or --expect-sha256. A tag in the list cannot be
  // re-pinned to another number, and a wasm with no pin at all (unknown tag or no tag) is refused.
  const known = args.release ? KNOWN_SHA256[args.release] : undefined;
  if (known && args.expectSha256 && args.expectSha256 !== known) fail(`--expect-sha256 ${args.expectSha256} conflicts with the pinned sha256 of ${args.release} (${known})`);
  if (!known && !args.expectSha256) fail(`no pinned sha256 for ${args.release ?? "this wasm"}: add it to KNOWN_SHA256 after a reproducible build or pass --expect-sha256 <hex> checked by a person`);
  const params = args.paramsFile ? JSON.parse(readFileSync(args.paramsFile, "utf8")) : DEFAULT_PARAMS;
  for (const k of Object.keys(DEFAULT_PARAMS)) if (!(k in params)) fail(`params file: missing ${k}`);
  return {
    network: args.network, circle: args.circle, owner: args.owner, usdt, intents: args.intents ?? net.intents, circleId: args.circleId ?? "agents-main",
    release: args.release, wasm: args.wasm, params, dryRun: !args.execute, send: Boolean(args.execute), expectSha256: args.expectSha256 ?? KNOWN_SHA256[args.release], keysDir: args.keysDir, out: args.out,
    initArgs: { owner_id: args.owner, circle_id: args.circleId ?? "agents-main", usdt_token_id: usdt, intents_id: args.intents ?? net.intents, params },
  };
}

/** The sha256 that the file SHA256SUMS of a release gives for `name`. */
export function sumOf(sums, name) {
  const line = sums.split("\n").map((l) => l.trim().split(/\s+/)).find((p) => p.length === 2 && p[1].replace(/^\*/, "") === name);
  if (!line) fail(`SHA256SUMS has no line for ${name}`);
  return line[0].toLowerCase();
}

export function fetchRelease(tag, runner = spawnSync) {
  const dir = mkdtempSync(join(tmpdir(), "x207-release-"));
  const r = runner("gh", ["release", "download", tag, "-R", "x207-labs/contracts", "-D", dir], { encoding: "utf8" });
  if (r.status !== 0) fail(`gh release download ${tag} failed: ${(r.stderr || r.stdout || "").slice(0, 200)}`);
  const name = `x207-circle-${tag}.wasm`;
  const wasm = readFileSync(join(dir, name));
  const sha = createHash("sha256").update(wasm).digest("hex");
  const expected = sumOf(readFileSync(join(dir, "SHA256SUMS"), "utf8"), name);
  if (sha !== expected) fail(`sha256 of ${name} is ${sha} but SHA256SUMS says ${expected}`);
  return { wasm, sha, source: `gh release download ${tag} -R x207-labs/contracts` };
}

async function loadChain(plan) {
  const { JsonRpcProvider } = createRequire(resolve(here, "../backend/package.json"))("near-api-js");
  return new JsonRpcProvider({ url: NETWORKS[plan.network].rpc[0] });
}

const viewCall = async (provider, account, method, args = {}) => {
  const r = await provider.callFunction({ contractId: account, method, args });
  return r;
};

/** Views only. Returns the facts and the problems. */
export async function inspect(plan, provider, expectedCodeHash) {
  const problems = [];
  const warnings = [];
  const facts = {};
  const accountOrNull = async (id) => provider.viewAccount({ accountId: id }).catch((e) => (/does not exist|UNKNOWN_ACCOUNT|UnknownAccount/i.test(`${e?.type ?? ""} ${e?.message ?? ""}`) ? null : Promise.reject(e)));
  try {
    const policy = await viewCall(provider, plan.owner, "get_policy");
    facts.ownerIsDao = Boolean(policy && Array.isArray(policy.roles));
    if (!facts.ownerIsDao) problems.push(`${plan.owner} answers get_policy but without roles: not a Sputnik DAO`);
  } catch {
    facts.ownerIsDao = false;
    problems.push(`${plan.owner} is not a Sputnik DAO (view get_policy failed); the owner of the circle must be a DAO (ADR-20)`);
  }
  try {
    const meta = await viewCall(provider, plan.usdt, "ft_metadata");
    facts.usdt = { symbol: meta.symbol, decimals: meta.decimals };
    if (meta.decimals !== 6) problems.push(`${plan.usdt} has ${meta.decimals} decimals, the circle expects 6`);
  } catch {
    facts.usdt = null;
    (plan.network === "mainnet" ? problems : warnings).push(`${plan.usdt} does not answer ft_metadata${plan.network === "mainnet" ? "" : " (the mock token of testnet has none)"}`);
  }
  const intents = await accountOrNull(plan.intents);
  facts.intentsHasCode = Boolean(intents && intents.code_hash !== "11111111111111111111111111111111");
  if (!facts.intentsHasCode) (plan.network === "mainnet" ? problems : warnings).push(`${plan.intents} has no code`);
  const circle = await accountOrNull(plan.circle);
  if (!circle) problems.push(`${plan.circle} does not exist: the owner creates and funds it first`);
  else {
    facts.circleNear = (BigInt(circle.amount) / 10n ** 21n).toString();
    if (BigInt(circle.amount) < MIN_CIRCLE_NEAR) problems.push(`${plan.circle} has less than 8 NEAR (the code locks about 6 NEAR of storage)`);
    facts.circleCodeHash = circle.code_hash;
    if (circle.code_hash !== "11111111111111111111111111111111" && circle.code_hash !== expectedCodeHash) problems.push(`${plan.circle} already holds other code (${circle.code_hash})`);
    facts.alreadyDeployed = circle.code_hash === expectedCodeHash;
  }
  return { facts, problems, warnings };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = planFrom(args);
  const release = plan.wasm ? (() => { const wasm = readFileSync(plan.wasm); return { wasm, sha: createHash("sha256").update(wasm).digest("hex"), source: `file ${plan.wasm}` }; })() : fetchRelease(plan.release);
  const expectedCodeHash = base58OfHex(release.sha);
  if (plan.expectSha256 && release.sha !== plan.expectSha256) fail(`sha256 of the wasm is ${release.sha} but the pinned number is ${plan.expectSha256}: nothing was sent`);
  const provider = await loadChain(plan);
  const { facts, problems, warnings } = await inspect(plan, provider, expectedCodeHash);
  const report = { network: plan.network, circle: plan.circle, owner: plan.owner, release: { tag: plan.release ?? null, source: release.source, wasmSha256: release.sha, codeHash: expectedCodeHash }, initArgs: plan.initArgs, pinnedSha256: plan.expectSha256 ?? null, costs: estimateCosts({ wasmBytes: release.wasm.length }), facts, warnings, problems, steps: [] };
  console.log(JSON.stringify(report, null, 2));
  if (problems.length > 0) {
    console.error(`STOP: ${problems.length} problem(s), nothing was sent`);
    process.exit(1);
  }
  if (plan.dryRun) {
    console.log("dry run (default): nothing signed, no key read. To send, repeat the same command with --execute (and --yes-owner-approved on mainnet).");
    return;
  }
  const keysDir = plan.keysDir ? resolve(plan.keysDir) : fail("--keys-dir is required to send");
  const keyFile = join(keysDir, plan.network, `${plan.circle}.json`);
  if (!existsSync(keyFile)) fail(`no key file ${keyFile}`);
  const { Account, KeyPairSigner } = createRequire(resolve(here, "../backend/package.json"))("near-api-js");
  const j = JSON.parse(readFileSync(keyFile, "utf8"));
  const account = new Account(plan.circle, provider, KeyPairSigner.fromSecretKey(j.secret_key ?? j.private_key));
  const save = () => plan.out && writeFileSync(plan.out, JSON.stringify(report, null, 2));
  if (!facts.alreadyDeployed) {
    const deployed = await account.deployContract(release.wasm);
    report.steps.push({ step: "deploy", hash: deployed.transaction.hash });
    save();
    const init = await account.callFunctionRaw({ contractId: plan.circle, methodName: "new", args: plan.initArgs, deposit: 0n, gas: 100_000_000_000_000n, waitUntil: "FINAL" });
    report.steps.push({ step: "init", hash: init.transaction.hash });
    save();
  }
  const after = await provider.viewAccount({ accountId: plan.circle });
  const owner = await viewCall(provider, plan.circle, "get_owner");
  const version = await viewCall(provider, plan.circle, "interface_version");
  report.check = { codeHash: after.code_hash, codeHashIsTheRelease: after.code_hash === expectedCodeHash, owner, ownerIsTheDao: owner === plan.owner, interfaceVersion: version, interfaceIsTheTag: plan.release ? `v${version}` === plan.release : null };
  save();
  console.log(JSON.stringify(report.check, null, 2));
  if (!report.check.codeHashIsTheRelease || !report.check.ownerIsTheDao || report.check.interfaceIsTheTag === false) {
    console.error("STOP: the contract on chain is not what was asked; do not use it");
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof DeployError ? `refused: ${e.message}` : e);
    process.exit(1);
  });
}
