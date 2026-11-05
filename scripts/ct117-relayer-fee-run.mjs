#!/usr/bin/env node
// CT-117: one epoch on x207-v016.testnet (interface 0.0.16) that shows the relayer fee of claim_evm and withdraw_stake_evm.
// Members are three fresh 0x agents: A owes B and C 20 credit each (auto_settle from stake), B claims with maxFee 250000 (fee paid),
// C claims with maxFee 0 (no fee), B exits and withdraws with maxFee 100000 (fee paid). The relayer is x207-v16-rly.testnet.
// Testnet only. Uses the near CLI with the key of the relayer in the legacy keychain, signs the EIP-712 actions with the SDK (sdk/packages/core/dist/evm.js).
// The EVM keys live in .secrets/testnet-deployer/ct117-evm-keys.json (git-ignored) and are never printed. Result: docs/testnet-epochs/ct117-relayer-fee-run.json (hashes and account names only).
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

const CIRCLE = "x207-v016.testnet";
const USDT = "usdt.x207-deployer.testnet";
const RELAYER = "x207-v16-rly.testnet";
const RECV = "x207-v16-recv.testnet";
const CREDIT = 1_000_000n;
const keysFile = path.resolve(root, "../../.secrets/testnet-deployer/ct117-evm-keys.json");
const outFile = path.join(root, "docs/testnet-epochs/ct117-relayer-fee-run.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const stateFile = process.env.CT117_STATE; // resume file (steps already done, the epoch in use)
const out = { circle: CIRCLE, relayer: RELAYER, receiver: RECV, steps: [] };
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
  const done = out.steps.find((s) => s.label === label && !s.failureText);
  if (done && !expectFail) {
    console.log(`${label}: skipped, already done (${done.tx ?? "no hash"})`);
    return done;
  }
  let text;
  try {
    let r; for (let i = 0; i < 8; i++) { r = spawnSync("near", ["contract", "call-function", "as-transaction", account, method, "json-args", JSON.stringify(args), "prepaid-gas", gas, "attached-deposit", deposit, "sign-as", signer, "network-config", "testnet-fastnear", "sign-with-legacy-keychain", "send"], { encoding: "utf8" }); if (!/rate limit|error sending request|timed out|connection/i.test(String(r.stderr) + String(r.stdout))) break; nap(15 * (i + 1)); }
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
  keys = { A: generatePrivateKey(), B: generatePrivateKey(), C: generatePrivateKey() };
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

// 1. join + stake (skipped when the member already exists)
for (const [name, a] of Object.entries(agents)) {
  const m = view(CIRCLE, "member", { account_id: a.id });
  if (!m) {
    const sig = await a.signer.signAction({ circle: CIRCLE, action: "join", epoch: 0, receiver: "", termsHash: terms, nonce: 0, deadline }, { maxFee: 0n });
    call(`join_evm ${name}`, CIRCLE, "join_evm", { address: a.id, terms_hash: terms, deadline, signature: sig }, { deposit: "0.35 NEAR" });
  }
  const m2 = view(CIRCLE, "member", { account_id: a.id });
  if (BigInt(m2.stake) === 0n) {
    call(`stake ${name}`, USDT, "ft_transfer_call", { receiver_id: CIRCLE, amount: (100n * CREDIT).toString(), memo: null, msg: JSON.stringify({ action: "stake", member_id: a.id }) }, { deposit: "1 yoctoNEAR", gas: "150 Tgas" });
  }
}

// 2. the circle may still sit in an epoch nobody closed: close it, work in the next one
let e = out.epoch ? view(CIRCLE, "get_epoch", { epoch: out.epoch }) : epochNow();
let epoch = e.epoch;
if (!out.epoch && nowMs() > Number(BigInt(e.cutoff_at) / 1_000_000n)) {
  call(`close_epoch ${epoch} (empty, nobody closed it)`, CIRCLE, "close_epoch", { epoch });
  await sleep(2000);
  epoch += 1;
  e = view(CIRCLE, "get_epoch", { epoch });
}
out.epoch = epoch;
console.log("working in epoch", epoch, "cutoff", e.cutoff_at);

// 3. A opts in to auto-settle, B asks to exit, A owes B and C 20 credit each
let nonce = { A: 0, B: 0, C: 0 };
{
  const sig = await agents.A.signer.signAction({ circle: CIRCLE, action: "auto_settle", epoch: 0, receiver: "", termsHash: "", nonce: nonce.A++, deadline }, { maxFee: 0n });
  call("set_auto_settle_evm A", CIRCLE, "set_auto_settle_evm", { member: agents.A.id, enabled: true, nonce: nonce.A - 1, deadline, signature: sig });
  const sig2 = await agents.B.signer.signAction({ circle: CIRCLE, action: "request_exit", epoch: 0, receiver: "", termsHash: "", nonce: nonce.B++, deadline }, { maxFee: 0n });
  call("request_exit_evm B", CIRCLE, "request_exit_evm", { member: agents.B.id, nonce: nonce.B - 1, deadline, signature: sig2 });
  for (const payee of ["B", "C"]) {
    const v = await agents.A.signer.signVoucher({ circle: CIRCLE, payer: agents.A.id, payee: agents[payee].id, epoch, seq: 1, cumulativeAmount: (20n * CREDIT).toString(), unit: "credit", resource: "/api/x" });
    const { signature, ...voucher } = v;
    call(`register_cumulative A->${payee}`, CIRCLE, "register_cumulative", { voucher, signature });
  }
}

// 4. close, commit, finalize
await waitUntilNs(e.cutoff_at, "cutoff");
call(`close_epoch ${epoch}`, CIRCLE, "close_epoch", { epoch });
await sleep(2000);
e = view(CIRCLE, "get_epoch", { epoch });
await waitUntilNs(e.proposal_deadline, "proposal_deadline");
call(`commit_epoch ${epoch}`, CIRCLE, "commit_epoch", { epoch });
await sleep(2000);
e = view(CIRCLE, "get_epoch", { epoch });
await waitUntilNs(e.payment_deadline, "payment_deadline");
call(`finalize_epoch ${epoch}`, CIRCLE, "finalize_epoch", { epoch });
await sleep(2000);
out.positions = {};
for (const n of ["B", "C"]) out.positions[n] = view(CIRCLE, "net_position", { epoch, account_id: agents[n].id });
out.memberA = view(CIRCLE, "member", { account_id: agents.A.id });

// 5. claims and withdraw
const measure = async (label, f) => {
  const before = { relayer: await bal(RELAYER), recv: await bal(RECV) };
  const step = await f();
  const after = { relayer: await bal(RELAYER), recv: await bal(RECV) };
  step.relayerDelta = (after.relayer - before.relayer).toString();
  step.receiverDelta = (after.recv - before.recv).toString();
  console.log(label, "relayer +", step.relayerDelta, "receiver +", step.receiverDelta);
  return step;
};

const claim = async (n, maxFee) => {
  const base = 20n * CREDIT;
  const sig = await agents[n].signer.signAction({ circle: CIRCLE, action: "claim", epoch, receiver: RECV, termsHash: "", nonce: nonce[n]++, deadline }, { maxFee });
  const step = call(`claim_evm ${n} maxFee ${maxFee}`, CIRCLE, "claim_evm", { member: agents[n].id, epoch, receiver: RECV, nonce: nonce[n] - 1, deadline, max_fee: maxFee.toString(), signature: sig });
  step.expectedFee = expectedRelayerFee({ base, relayerFee, maxFee }).toString();
  return step;
};
await measure("claim B (maxFee = relayer_fee)", () => claim("B", relayerFee));
await measure("claim C (maxFee 0)", () => claim("C", 0n));

const stakeB = BigInt(view(CIRCLE, "member", { account_id: agents.B.id }).stake);
const wMax = 100_000n;
await measure("withdraw B (maxFee 100000)", async () => {
  const sig = await agents.B.signer.signAction({ circle: CIRCLE, action: "withdraw_stake", epoch: 0, receiver: RECV, termsHash: "", nonce: nonce.B++, deadline }, { maxFee: wMax });
  const step = call("withdraw_stake_evm B", CIRCLE, "withdraw_stake_evm", { member: agents.B.id, receiver: RECV, nonce: nonce.B - 1, deadline, max_fee: wMax.toString(), signature: sig });
  step.expectedFee = expectedRelayerFee({ base: stakeB, relayerFee, maxFee: wMax }).toString();
  return step;
});
await sleep(3000);
out.final = { memberB: view(CIRCLE, "member", { account_id: agents.B.id }), positionB: view(CIRCLE, "net_position", { epoch, account_id: agents.B.id }), positionC: view(CIRCLE, "net_position", { epoch, account_id: agents.C.id }) };
out.circleUsdt = (await bal(CIRCLE)).toString();
fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + "\n");
console.log("written", path.relative(root, outFile));
