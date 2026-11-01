// UM-008 tests against near-sandbox. Run from the umbrella repo root: node --test scripts/create-accounts.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { AGENTS, planAccounts } from "./lib/accounts.mjs";
import { startSandbox } from "./lib/sandbox.mjs";

const script = resolve(fileURLToPath(import.meta.url), "../create-accounts.mjs");
const contractId = "x207-circle.test.near";
let sandbox;
let keysDir;

function run() {
  return execFileSync(
    "node",
    [script, "--network", "sandbox", "--rpc-url", sandbox.rpcUrl, "--funder-id", sandbox.rootAccountId, "--keys-dir", keysDir],
    { encoding: "utf8", env: { ...process.env, X207_FUNDER_KEY: sandbox.rootSecretKey } },
  );
}

async function view(accountId) {
  const r = await fetch(sandbox.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "t", method: "query", params: { request_type: "view_account", finality: "optimistic", account_id: accountId } }),
  });
  return (await r.json()).result;
}

describe("UM-008 account script on near-sandbox", () => {
  let firstOutput;
  let secondOutput;
  before(async () => {
    sandbox = await startSandbox();
    keysDir = mkdtempSync(join(tmpdir(), "x207-keys-"));
    firstOutput = run();
    secondOutput = run();
  }, { timeout: 180_000 });
  after(async () => {
    await sandbox?.stop();
    if (keysDir) rmSync(keysDir, { recursive: true, force: true });
  });

  it("plans the contract account and six agent sub-accounts", () => {
    const plan = planAccounts(contractId);
    assert.equal(plan.length, 7);
    assert.deepEqual(AGENTS, ["translator", "summarizer", "scraper", "image", "cleaner", "gpu"]);
    assert.ok(plan.includes("image.x207-circle.test.near"));
  });

  it("TC-UM-008-01 creates seven accounts and prints them", () => {
    for (const id of planAccounts(contractId)) assert.match(firstOutput, new RegExp(`created ${id.replaceAll(".", "\\.")}`));
  });

  it("TC-UM-008-02 all seven accounts exist with a balance above zero", async () => {
    for (const id of planAccounts(contractId)) {
      const info = await view(id);
      assert.ok(info && BigInt(info.amount) > 0n, `${id} has no balance`);
    }
  });

  it("TC-UM-008-03 a second run creates nothing and reports existing accounts", () => {
    assert.doesNotMatch(secondOutput, /created /);
    for (const id of planAccounts(contractId)) assert.match(secondOutput, new RegExp(`exists  ${id.replaceAll(".", "\\.")}`));
  });

  it("TC-UM-008-04 no secret key in the output, key files are private", () => {
    const files = readdirSync(join(keysDir, "sandbox"));
    assert.equal(files.length, 7);
    for (const f of files) {
      assert.equal(statSync(join(keysDir, "sandbox", f)).mode & 0o077, 0);
      const secret = JSON.parse(readFileSync(join(keysDir, "sandbox", f), "utf8")).secret_key;
      assert.ok(!firstOutput.includes(secret) && !secondOutput.includes(secret));
    }
    assert.ok(!firstOutput.includes(sandbox.rootSecretKey));
  });
});
