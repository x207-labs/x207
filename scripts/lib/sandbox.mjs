// UM-008: start and stop a local near-sandbox node for the account script and its test.
// The binary comes from X207_SANDBOX_BIN, or from the build output of the contracts repo
// (near-workspaces downloads it there when `cargo test` first runs).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function findSandboxBinary() {
  if (process.env.X207_SANDBOX_BIN) return process.env.X207_SANDBOX_BIN;
  const build = resolve(here, "../../contracts/target/debug/build");
  if (existsSync(build)) {
    for (const dir of readdirSync(build)) {
      const nearDir = join(build, dir, "out/.near");
      if (!dir.startsWith("near-sandbox-") || !existsSync(nearDir)) continue;
      for (const version of readdirSync(nearDir)) {
        const bin = join(nearDir, version, "near-sandbox");
        if (existsSync(bin)) return bin;
      }
    }
  }
  throw new Error("near-sandbox binary not found. Set X207_SANDBOX_BIN, or run `cargo test` in contracts once.");
}

function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
  });
}

async function waitForRpc(rpcUrl, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`near-sandbox exited early with code ${child.exitCode}`);
    try {
      const body = { jsonrpc: "2.0", id: "x", method: "status", params: [] };
      const r = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (j.result?.sync_info?.latest_block_height > 0) return;
    } catch {
      // node not listening yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("near-sandbox did not become ready in time");
}

/** Returns { rpcUrl, rootAccountId, rootSecretKey, stop }. */
export async function startSandbox({ timeoutMs = 60_000 } = {}) {
  const bin = findSandboxBinary();
  const home = mkdtempSync(join(tmpdir(), "x207-sandbox-"));
  const init = spawnSync(bin, ["--home", home, "init", "--chain-id", "localnet"], { encoding: "utf8" });
  if (init.status !== 0) throw new Error(`near-sandbox init failed: ${init.stderr}`);
  const rpcPort = await freePort();
  const netPort = await freePort();
  const configPath = join(home, "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.rpc.addr = `127.0.0.1:${rpcPort}`;
  config.network.addr = `127.0.0.1:${netPort}`;
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  const validator = JSON.parse(readFileSync(join(home, "validator_key.json"), "utf8"));
  const child = spawn(bin, ["--home", home, "run"], { stdio: "ignore" });
  const rpcUrl = `http://127.0.0.1:${rpcPort}`;
  try {
    await waitForRpc(rpcUrl, child, timeoutMs);
  } catch (err) {
    child.kill("SIGKILL");
    throw err;
  }
  return {
    rpcUrl,
    rootAccountId: validator.account_id,
    rootSecretKey: validator.secret_key,
    stop: () =>
      new Promise((res) => {
        if (child.exitCode !== null) return res();
        child.once("exit", () => res());
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5000).unref();
      }),
  };
}
