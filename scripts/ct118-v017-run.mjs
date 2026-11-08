#!/usr/bin/env node
// CT-118: one epoch on x207-v017.testnet (interface 0.0.17) that shows the relayer fee of request_exit_evm and set_auto_settle_evm.
// Members are fresh 0x agents: A opts in to auto-settle with maxFee 250000 (fee paid from the free stake), B asks to exit with maxFee 250000 (fee paid),
// C does both with maxFee 0 (no fee), D tries join_evm with maxFee 250000 (refused with ERR_EVM_FEE_NOT_ALLOWED). Then the epoch is closed, committed and
// finalized, and get_epoch.params must show relayer_fee 250000 (the rules snapshot). The relayer is x207-v16-rly.testnet; a second relayer,
// x207-v17-nor.testnet, was meant to fail the fee transfer by not being registered with the mock USDT, but the mock registers the receiver on ft_transfer,
// so the fee is paid anyway (run of 2026-11-06: relayer_fee_paid); the failed-fee path is covered by the contract unit and sandbox tests (TC-CT-118-01..05).
// Testnet only. Uses the near CLI (legacy keychain for the relayer, key file for the second one), signs the EIP-712 actions with the SDK (sdk/packages/core/dist/evm.js).
// The EVM keys live in .secrets/testnet-deployer/ct118-evm-keys.json (git-ignored) and are never printed. Result: docs/testnet-epochs/ct118-v017-run.json (hashes and account names only).
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(path.join(root, "sdk/package.json"));
const { generatePrivateKey, privateKeyToAccount } = require("viem/accounts");
const { evmSigner, expectedRelayerFee } = await import(path.join(root, "sdk/packages/core/dist/evm.js"));

const CIRCLE = "x207-v017.testnet";
const USDT = "usdt.x207-deployer.testnet";
const RELAYER = "x207-v16-rly.testnet";
const RELAYER_NOREG = "x207-v17-nor.testnet"; // not registered with the mock USDT: ft_transfer to it fails
const NOREG_KEY = path.resolve(root, "../../.secrets/testnet-deployer/x207-v17-nor.testnet.json");
const CREDIT = 1_000_000n;
const keysFile = path.resolve(root, "../../.secrets/testnet-deployer/ct118-evm-keys.json");
const outFile = path.join(root, "docs/testnet-epochs/ct118-v017-run.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const stateFile = process.env.CT118_STATE; // resume file (steps already done, the epoch in use)
const out = { circle: CIRCLE, relayer: RELAYER, relayerNotRegistered: RELAYER_NOREG, steps: [] };
if (stateFile && fs.existsSync(stateFile)) Object.assign(out, JSON.parse(fs.readFileSync(stateFile, "utf8")));
const saveState = () => stateFile && fs.writeFileSync(stateFile, JSON.stringify(out));

const nap = (s) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, s * 1000);
function view(account, method, args = {}) {
  for (let i = 0; ; i++) {
    try { return viewOnce(account, method, args); } catch (e) { if (i >= 8 || !/rate limit|error sending request|timed out|connection/i.test(String(e.stderr ?? e.message))) throw e; nap(15 * (i + 1)); }
  }
}
function viewOnce(account, method, args = {}) {
  const text = clean(execFileSync("near", ["contract", "call-function", "as-read-only", account, method, "json-args", JSON.stringify(args), "network-config", "testnet-fastnear", "now"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  const body = (text.includes("printed to stdout):") ? text.split("printed to stdout):")[1] : text).split("Here is your console command")[0].trim();
  return body === undefined || body === "" ? null : JSON.parse(body);
}

function call(label, account, method, args, { deposit = "0 NEAR", gas = "100 Tgas", signer = RELAYER, expectFail = false } = {}) {
  const signWith = signer === RELAYER_NOREG ? ["sign-with-access-key-file", NOREG_KEY, "send"] : ["sign-with-legacy-keychain", "send"];
  const done = out.steps.find((s) => s.label === label && !s.failureText);
  if (done && !expectFail) {
    console.log(`${label}: skipped, already done (${done.tx ?? "no hash"})`);
    return done;
  }
  let text;
  try {
    let r; for (let i = 0; i < 8; i++) { r = spawnSync("near", ["contract", "call-function", "as-transaction", account, method, "json-args", JSON.stringify(args), "prepaid-gas", gas, "attached-deposit", deposit, "sign-as", signer, "network-config", "testnet-fastnear", ...signWith], { encoding: "utf8" }); if (!/rate limit|error sending request|timed out|connection/i.test(String(r.stderr) + String(r.stdout))) break; nap(15 * (i + 1)); }
    text = clean(String(r.stdout ?? "") + String(r.stderr ?? ""));
    if (r.status !== 0) throw Object.assign(new Error("near failed"), { stdout: r.stdout, stderr: r.stderr });
  } catch (e) {
    text = clean(String(e.stdout ?? "") + String(e.stderr ?? ""));
    if (!expectFail) throw new Error(`${label} failed: ${text.slice(-600)}`);
  }
  const hash = text.match(/Transaction ID: (\w+)/)?.[1] ?? null;
  const failed = !hash || /FailedReceipt|Smart contract panicked|ERR_[A-Z_]+|Failure/.test(text);
  const events = [...text.matchAll(/EVENT_JSON:(\{.*\})/g)].map((m) => JSON.parse(m[1]));
  const step = { label, tx: hash, events: events.map((e) => ({ event: e.event, data: e.data })) };
  if (failed) step.failureText = (text.match(/ERR_[A-Z_]+[^\n"]*/) ?? ["failed"])[0];
  out.steps.push(step);
  saveState();
  console.log(`${label}: ${hash ?? "no tx"}${failed ? " FAILED " + (step.failureText ?? "") : ""} ${events.map((e) => e.event).join(",")}`);
  if (failed && !expectFail) throw new Error(`${label} failed: ${step.failureText}`);
  return step;
}

const bal = (who) => BigInt(view(USDT, "ft_balance_of", { account_id: who }));
const nowMs = () => Date.now();
const epochNow = () => {
  let n = 1;
  while (view(CIRCLE, "get_epoch", { epoch: n + 1 })) n += 1;
  return view(CIRCLE, "get_epoch", { epoch: n });
};

async function waitUntilNs(ns, label) {
  const target = Number(BigInt(ns) / 1_000_000n);
  while (nowMs() < target + 8000) {
    const left = Math.ceil((target + 8000 - nowMs()) / 1000);
    if (left % 30 === 0) console.log(`waiting ${left}s for ${label}`);
    await sleep(1000);
  }
}

// keys (never printed)
let keys;
if (fs.existsSync(keysFile)) keys = JSON.parse(fs.readFileSync(keysFile, "utf8"));
else {
  keys = { A: generatePrivateKey(), B: generatePrivateKey(), C: generatePrivateKey(), D: generatePrivateKey(), E: generatePrivateKey() };
  fs.writeFileSync(keysFile, JSON.stringify(keys), { mode: 0o600 });
}
const agents = Object.fromEntries(Object.entries(keys).map(([n, k]) => [n, { signer: evmSigner(privateKeyToAccount(k)) }]));
for (const a of Object.values(agents)) a.id = a.signer.id;
out.agents = Object.fromEntries(Object.entries(agents).map(([n, a]) => [n, a.id]));
const deadline = nowMs() + 20 * 3600 * 1000;
const terms = "a".repeat(64);
const relayerFee = BigInt(view(CIRCLE, "get_params").relayer_fee);
out.relayerFee = relayerFee.toString();
console.log("relayer_fee", relayerFee.toString(), "agents", JSON.stringify(out.agents));

// 1. join (no fee: max_fee left out, the signed message has maxFee 0) and stake 12 credit (the relayer holds about 50 mock credit), for A, B, C, E; D only tries a join with a fee
for (const [name, a] of Object.entries(agents)) {
  if (name === "D") continue;
  const m = view(CIRCLE, "member", { account_id: a.id });
  if (!m) {
    const sig = await a.signer.signAction({ circle: CIRCLE, action: "join", epoch: 0, receiver: "", termsHash: terms, nonce: 0, deadline }, { maxFee: 0n });
    call(`join_evm ${name}`, CIRCLE, "join_evm", { address: a.id, terms_hash: terms, deadline, signature: sig }, { deposit: "0.35 NEAR" });
  }
  const m2 = view(CIRCLE, "member", { account_id: a.id });
  if (BigInt(m2.stake) === 0n) {
    call(`stake ${name}`, USDT, "ft_transfer_call", { receiver_id: CIRCLE, amount: (12n * CREDIT).toString(), memo: null, msg: JSON.stringify({ action: "stake", member_id: a.id }) }, { deposit: "1 yoctoNEAR", gas: "150 Tgas" });
  }
}

// 2. join_evm with maxFee > 0 is refused
{
  const sig = await agents.D.signer.signAction({ circle: CIRCLE, action: "join", epoch: 0, receiver: "", termsHash: terms, nonce: 0, deadline }, { maxFee: relayerFee });
  const step = call("join_evm D maxFee 250000 (refused)", CIRCLE, "join_evm", { address: agents.D.id, terms_hash: terms, deadline, signature: sig, max_fee: relayerFee.toString() }, { deposit: "0.35 NEAR", expectFail: true });
  if (step.failureText !== "ERR_EVM_FEE_NOT_ALLOWED: join_evm carries no relayer fee, sign maxFee 0 or leave max_fee out" && !String(step.failureText).startsWith("ERR_EVM_FEE_NOT_ALLOWED")) throw new Error(`join with fee was not refused with ERR_EVM_FEE_NOT_ALLOWED: ${step.failureText}`);
  out.joinWithFeeRefused = { tx: step.tx, error: step.failureText.split(":")[0] };
}

// 3. the circle may still sit in an epoch nobody closed: close it, work in the next one
let e = out.epoch ? view(CIRCLE, "get_epoch", { epoch: out.epoch }) : epochNow();
let epoch = e.epoch;
if (!out.epoch && nowMs() > Number(BigInt(e.cutoff_at) / 1_000_000n)) {
  call(`close_epoch ${epoch} (empty, nobody closed it)`, CIRCLE, "close_epoch", { epoch });
  await sleep(2000);
  epoch += 1;
  e = view(CIRCLE, "get_epoch", { epoch });
}
out.epoch = epoch;
out.paramsAtStart = { relayer_fee: e.params?.relayer_fee ?? null, epoch };
console.log("working in epoch", epoch, "cutoff", e.cutoff_at, "params.relayer_fee", e.params?.relayer_fee);

// 4. actions with a fee, measured on the relayer balance and on the stake of the member
const nonce = { A: 0, B: 0, C: 0, E: 0 };
const feeCall = async (label, n, action, method, extra, maxFee, signer = RELAYER) => {
  const before = { relayer: await bal(signer), stake: BigInt(view(CIRCLE, "member", { account_id: agents[n].id }).stake) };
  const sig = await agents[n].signer.signAction({ circle: CIRCLE, action, epoch: 0, receiver: "", termsHash: "", nonce: nonce[n]++, deadline }, { maxFee });
  const step = call(label, CIRCLE, method, { member: agents[n].id, ...extra, nonce: nonce[n] - 1, deadline, max_fee: maxFee.toString(), signature: sig }, { signer, expectFail: signer === RELAYER_NOREG });
  await sleep(3000);
  const after = { relayer: await bal(signer), stake: BigInt(view(CIRCLE, "member", { account_id: agents[n].id }).stake) };
  step.maxFee = maxFee.toString();
  step.relayerDelta = (after.relayer - before.relayer).toString();
  step.stakeDelta = (after.stake - before.stake).toString();
  console.log(label, "relayer +", step.relayerDelta, "stake", step.stakeDelta);
  saveState();
  return step;
};
await feeCall("set_auto_settle_evm A maxFee 250000", "A", "auto_settle", "set_auto_settle_evm", { enabled: true }, relayerFee);
await feeCall("request_exit_evm B maxFee 250000", "B", "request_exit", "request_exit_evm", {}, relayerFee);
await feeCall("set_auto_settle_evm C maxFee 0", "C", "auto_settle", "set_auto_settle_evm", { enabled: true }, 0n);
await feeCall("request_exit_evm C maxFee 0", "C", "request_exit", "request_exit_evm", {}, 0n);
// fee transfer fails (the relayer is not registered with the mock USDT): the fee goes back to the stake of E
out.failedFee = await feeCall("set_auto_settle_evm E maxFee 250000 (relayer not registered)", "E", "auto_settle", "set_auto_settle_evm", { enabled: true }, relayerFee, RELAYER_NOREG);
out.failedFee.eventNames = out.failedFee.events.map((x) => x.event);
{
  const v = await agents.A.signer.signVoucher({ circle: CIRCLE, payer: agents.A.id, payee: agents.B.id, epoch, seq: 1, cumulativeAmount: (5n * CREDIT).toString(), unit: "credit", resource: "/api/x" });
  const { signature, ...voucher } = v;
  call("register_cumulative A->B", CIRCLE, "register_cumulative", { voucher, signature });
}

// 5. close, commit, finalize; get_epoch.params shows the rules of the epoch
await waitUntilNs(e.cutoff_at, "cutoff");
call(`close_epoch ${epoch}`, CIRCLE, "close_epoch", { epoch });
await sleep(2000);
e = view(CIRCLE, "get_epoch", { epoch });
out.paramsAfterClose = { epoch, relayer_fee: e.params?.relayer_fee ?? null };
await waitUntilNs(e.proposal_deadline, "proposal_deadline");
call(`commit_epoch ${epoch}`, CIRCLE, "commit_epoch", { epoch });
await sleep(2000);
e = view(CIRCLE, "get_epoch", { epoch });
await waitUntilNs(e.payment_deadline, "payment_deadline");
call(`finalize_epoch ${epoch}`, CIRCLE, "finalize_epoch", { epoch });
await sleep(2000);
out.paramsAfterFinalize = { epoch, relayer_fee: view(CIRCLE, "get_epoch", { epoch }).params?.relayer_fee ?? null };
out.members = Object.fromEntries(["A", "B", "C", "E"].map((n) => [n, view(CIRCLE, "member", { account_id: agents[n].id })]));
out.circleUsdt = (await bal(CIRCLE)).toString();
fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + "\n");
console.log("written", path.relative(root, outFile));

