// Tests for scripts/online-hashes.mjs (UM-190). Run: node --test scripts/online-hashes.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashesIn, verifyHashes } from "./online-hashes.mjs";

const REAL = "329TWFnAzGwvKjR2fdRdqTKqVzLLRki7t5wWzR7KL4ox";
const FAKE = "1111111111111111111111111111111111111111111aB";
const FAKE_MIXED = "FaKe5h6UBRqDWZMh5VeXAMUM66QgLNJLdh83z7DG3rZ";
const EVM = "0x347fb05ab7325bb33c0e6144423ef46aa2fd42ff549b27aad0e545f19a72975d";
const json = (body) => ({ ok: true, status: 200, json: async () => body });

// A fake chain: NEAR knows only REAL when asked with sender x207-v013.testnet, Base knows only EVM.
const chain = async (url, init) => {
  const req = JSON.parse(init.body);
  if (req.method === "tx") {
    const { tx_hash, sender_account_id } = req.params;
    if (tx_hash === REAL && sender_account_id === "x207-v013.testnet") return json({ result: { final_execution_status: "FINAL", transaction: { hash: REAL } } });
    return json({ error: { name: "HANDLER_ERROR", cause: { name: "UNKNOWN_TRANSACTION" } } });
  }
  return json({ result: req.params[0] === EVM ? { transactionHash: EVM, status: "0x1" } : null });
};

const doc = (hash) => ({ path: "docs/x.md", text: `Account \`x207-v013.testnet\` did it in \`${hash}\`.\n` });

test("a hash that exists is passed, found with the right signer out of several guesses", async () => {
  const v = await verifyHashes([{ path: "docs/x.md", text: `\`other.testnet\` and \`x207-v013.testnet\`: \`${REAL}\`` }], { fetchImpl: chain });
  assert.deepEqual([v.found, v.checked, v.passed, v.failed, v.skipped], [1, 1, 1, 0, 0]);
});

test("a fake NEAR hash is counted as failed", async () => {
  const v = await verifyHashes([doc(FAKE_MIXED)], { fetchImpl: chain });
  assert.equal(v.failed, 1);
  assert.match(v.rows[0].reason, /unknown to the testnet RPC/);
});

test("an EVM hash is checked on Base Sepolia: a real receipt passes, a made-up one fails", async () => {
  const bad = "0x" + "ab".repeat(32);
  const v = await verifyHashes([{ path: "docs/x.md", text: `${EVM} and ${bad}` }], { fetchImpl: chain });
  assert.deepEqual([v.passed, v.failed], [1, 1]);
});

test("code hashes, keys and mainnet lines are skipped with a reason, not checked", () => {
  const { hashes, skipped } = hashesIn("docs/x.md", `code hash \`${REAL}\`\nmainnet tx \`${FAKE_MIXED}\`\nkey ed25519:${REAL}\n`);
  assert.equal(hashes.length, 0);
  assert.ok(skipped.length >= 2 && skipped.every((s) => s.reason));
});

test("in a JSON record only transaction fields count; codeHash is skipped", () => {
  const text = JSON.stringify({ contract: "x207-v013.testnet", build: { codeHash: REAL }, steps: [{ account: "x207-v013.testnet", hash: FAKE_MIXED }] });
  const { hashes, skipped } = hashesIn("docs/r.json", text);
  assert.deepEqual(hashes.map((h) => h.hash), [FAKE_MIXED]);
  assert.equal(skipped[0].hash, REAL);
});

test("an unreachable RPC is skipped with the reason, never counted as passed", async () => {
  const down = async () => { throw new Error("offline"); };
  const v = await verifyHashes([doc(REAL)], { fetchImpl: down });
  assert.deepEqual([v.passed, v.failed, v.skipped], [0, 0, 1]);
  assert.match(v.rows[0].reason, /unreachable/);
});

test("UNKNOWN from a non-archival RPC alone is skipped, not failed (it forgets old transactions)", async () => {
  const v = await verifyHashes([doc(FAKE_MIXED)], { fetchImpl: chain, nearEndpoints: ["https://rpc.testnet.fastnear.com"] });
  assert.deepEqual([v.passed, v.failed, v.skipped], [0, 0, 1]);
  assert.match(v.rows[0].reason, /non-archival/);
});

test("a failover endpoint answers when the first is down", async () => {
  let calls = 0;
  const flaky = async (url, init) => { if (calls++ === 0) return { ok: false, status: 503, json: async () => ({}) }; return chain(url, init); };
  const v = await verifyHashes([doc(REAL)], { fetchImpl: flaky });
  assert.equal(v.passed, 1);
});

test("check-claims --online exits 1 when a docs file holds a fake hash (RPC replaced by a local stub)", () => {
  const root = mkdtempSync(join(tmpdir(), "claims-"));
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "CLAIMS.md"), "| Claim | Proof |\n| --- | --- |\n| a | none |\n");
  writeFileSync(join(root, "docs", "t.md"), `Account \`x207-v013.testnet\` did it in \`${FAKE_MIXED}\`.\n`);
  const stub = join(root, "stub.mjs");
  writeFileSync(stub, `globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ error: { cause: { name: "UNKNOWN_TRANSACTION" } } }) });\n`);
  const run = spawnSync(process.execPath, ["--import", stub, join(import.meta.dirname, "check-claims.mjs"), "--root", root, "--online"], { encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stdout, /1 hash\(es\) found in the docs, 1 checked, 0 passed, 1 failed, 0 skipped/);
  assert.match(run.stdout, new RegExp(FAKE_MIXED));
  void execFileSync;
});
