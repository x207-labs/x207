#!/usr/bin/env node
// UM-107: the quick demo path, with no Rust toolchain. It downloads the wasm of the circle from the GitHub release, checks its sha256 against the number written in this repository, and only then
// runs the sandbox demo with that wasm. A wasm with another hash stops the script before anything runs.
//
//   npm run demo:quick                    = node scripts/demo-quick.mjs --release-wasm      (v0.0.13)
//   node scripts/demo-quick.mjs --release-wasm --tag v0.0.13 --cache <dir> --check-only     download and verify, run nothing
//
// What it needs besides Node: the packages installed and built (`npm ci`, `npm run build --workspaces --if-present`). What it fetches and checks:
//   1. x207-circle-<tag>.wasm from https://github.com/x207-labs/contracts/releases (public); its sha256 must equal KNOWN_SHA256[tag] (the same table that deploy-mainnet.mjs uses);
//   2. the near-sandbox binary 2.13.4 from build.nearprotocol.com (the URL that the near-sandbox npm package uses), unless X207_SANDBOX_BIN names one; `--version` must say 2.13.4;
//   3. contracts/prebuilt/mock_ft.wasm (the mock USDT, committed); its sha256 must equal KNOWN_SHA256.mock_ft, the same table as the wasm of the release.
// Then `npm run demo:sandbox` runs with X207_CIRCLE_WASM, X207_MOCK_FT_WASM and X207_SANDBOX_BIN set. Nothing is installed globally and nothing is sent to a network except the two downloads.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { arch, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KNOWN_SHA256 } from "./deploy-mainnet.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const MOCK_FT_SHA256 = KNOWN_SHA256.mock_ft; // the same table as the wasm of the release (scripts/deploy-mainnet.mjs)
export const SANDBOX_VERSION = "2.13.4";
export const DEFAULT_TAG = "v0.0.13";

export class DemoStop extends Error {}

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export const releaseUrl = (tag) => `https://github.com/x207-labs/contracts/releases/download/${tag}/x207-circle-${tag}.wasm`;

/** The URL of the near-sandbox binary for this machine (the one the near-sandbox package of npm uses), or a DemoStop when the machine is not supported. */
export function sandboxUrl(os = platform(), cpu = arch(), version = SANDBOX_VERSION) {
  const key = `${os}-${cpu}`;
  const dir = { "linux-x64": "Linux-x86_64", "linux-arm64": "Linux-aarch64", "darwin-arm64": "Darwin-arm64" }[key];
  if (!dir) throw new DemoStop(`no near-sandbox binary for ${key} (supported: Linux x64 and arm64, macOS arm64); set X207_SANDBOX_BIN to a binary of your own`);
  return `https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/${dir}/${version}/near-sandbox.tar.gz`;
}

/** Checks `bytes` against the pinned sha256 of `tag`. A tag that is not pinned, or a different hash, stops the demo. */
export function verifyRelease(tag, bytes, table = KNOWN_SHA256) {
  const expected = table[tag];
  if (!expected) throw new DemoStop(`release ${tag} has no pinned sha256 in this repository (scripts/deploy-mainnet.mjs, KNOWN_SHA256); the demo did not run`);
  const actual = sha256(bytes);
  if (actual !== expected) throw new DemoStop(`STOP: the wasm of ${tag} has sha256 ${actual} but this repository pins ${expected}; the demo did not run`);
  return actual;
}

export function parseArgs(argv) {
  const out = { tag: DEFAULT_TAG, cache: join(root, "node_modules/.cache/x207-quick"), checkOnly: false, local: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--release-wasm") out.local = false;
    else if (a === "--check-only") out.checkOnly = true;
    else if (a === "--tag" || a === "--cache") {
      const v = argv[(i += 1)];
      if (!v || v.startsWith("--")) throw new DemoStop(`${a} needs a value`);
      out[a.slice(2)] = a === "--cache" ? resolve(v) : v;
    } else throw new DemoStop(`unknown argument ${a} (usage: demo-quick.mjs [--release-wasm] [--tag vX] [--cache dir] [--check-only])`);
  }
  return out;
}

async function download(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new DemoStop(`${url} answered HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function circleWasm(opts) {
  const file = join(opts.cache, `x207-circle-${opts.tag}.wasm`);
  if (existsSync(file)) {
    try {
      verifyRelease(opts.tag, readFileSync(file));
      console.log(`wasm of ${opts.tag}: cached, sha256 checked`);
      return file;
    } catch {
      rmSync(file, { force: true }); // a bad cached file is never reused
    }
  }
  console.log(`downloading ${releaseUrl(opts.tag)}`);
  const bytes = await download(releaseUrl(opts.tag));
  const hash = verifyRelease(opts.tag, bytes);
  writeFileSync(file, bytes);
  console.log(`wasm of ${opts.tag}: ${bytes.length} bytes, sha256 ${hash} equals the pinned number`);
  return file;
}

async function sandboxBinary(opts) {
  if (process.env.X207_SANDBOX_BIN) return process.env.X207_SANDBOX_BIN;
  const dir = join(opts.cache, `near-sandbox-${SANDBOX_VERSION}`);
  const bin = join(dir, "near-sandbox");
  if (!existsSync(bin)) {
    mkdirSync(dir, { recursive: true });
    const url = sandboxUrl();
    console.log(`downloading ${url}`);
    const tarball = join(opts.cache, "near-sandbox.tar.gz");
    writeFileSync(tarball, await download(url));
    const extracted = spawnSync("tar", ["-xzf", tarball, "-C", dir], { encoding: "utf8" });
    if (extracted.status !== 0) throw new DemoStop(`tar could not unpack the near-sandbox archive: ${extracted.stderr}`);
    rmSync(tarball, { force: true });
    // the archive holds one folder with the binary in it
    const found = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? found(join(d, e.name)) : e.name === "near-sandbox" ? [join(d, e.name)] : []));
    const [inside] = found(dir);
    if (!inside) throw new DemoStop("the near-sandbox archive has no near-sandbox binary");
    if (inside !== bin) {
      writeFileSync(bin, readFileSync(inside));
    }
    chmodSync(bin, 0o755);
  }
  const version = spawnSync(bin, ["--version"], { encoding: "utf8" });
  if (version.status !== 0 || !version.stdout.includes(`release ${SANDBOX_VERSION}`)) throw new DemoStop(`${bin} is not near-sandbox ${SANDBOX_VERSION}: ${(version.stdout || version.stderr).trim().slice(0, 120)}`);
  console.log(`near-sandbox ${SANDBOX_VERSION}: ${bin}`);
  return bin;
}

function mockToken() {
  const file = join(root, "contracts/prebuilt/mock_ft.wasm");
  if (!existsSync(file)) throw new DemoStop(`${file} is missing`);
  const actual = sha256(readFileSync(file));
  if (actual !== MOCK_FT_SHA256) throw new DemoStop(`STOP: contracts/prebuilt/mock_ft.wasm has sha256 ${actual} but this script pins ${MOCK_FT_SHA256}; the demo did not run`);
  return file;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  mkdirSync(opts.cache, { recursive: true });
  const wasm = await circleWasm(opts);
  const sandbox = await sandboxBinary(opts);
  const mock = mockToken();
  if (opts.checkOnly) {
    console.log("check only: everything was downloaded and verified, the demo was not run");
    return;
  }
  if (!existsSync(join(root, "sdk/packages/core/dist/index.js"))) throw new DemoStop("the packages are not built: run `npm ci` and `npm run build --workspaces --if-present` first");
  console.log("running the sandbox demo with the release wasm\n");
  const run = spawnSync("npm", ["run", "demo:sandbox"], { cwd: root, stdio: "inherit", env: { ...process.env, X207_CIRCLE_WASM: wasm, X207_MOCK_FT_WASM: mock, X207_SANDBOX_BIN: sandbox } });
  process.exit(run.status ?? 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof DemoStop ? e.message : e);
    process.exit(1);
  });
}
