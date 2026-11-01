#!/usr/bin/env node
// UM-007: fail when an external dependency is not pinned exactly (ADR-32, K-52).
//
//   npm:   every dependency in every package.json must be an exact version (no ^, ~, range, tag).
//   Cargo: every crate in every Cargo.toml must be written "=x.y.z" (a bare "x.y.z" is a caret range in Cargo).
//   Peta Modul: the packages named in the module map must have the version of that table.
//   Lockfiles: package-lock.json and Cargo.lock must exist and be committed in each repo that needs them.
//
// Usage: node scripts/check-pins.mjs [--root <dir>]   (default: the umbrella repo root)
// Exit code 0 when all checks pass, 1 otherwise. Needs no dependencies.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_DIRS = new Set(["node_modules", "dist", "target", ".git", "out", "build"]);
const NPM_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const CARGO_SECTION = /^(?:workspace\.)?(?:dev-|build-)?dependencies$|^target\..+\.(?:dev-|build-)?dependencies$/;
const NPM_EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const CARGO_EXACT = /^=\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

// Versions from the module map (x207 - Peta Modul, ADR-11). Tools such as cargo-near are not dependencies.
export const PETA_MODUL = {
  npm: {
    "@x402/core": "2.28.0",
    "@x402/near": "2.28.0",
    "@x402/fetch": "2.28.0",
    "near-api-js": "7.4.0",
    "@defuse-protocol/one-click-sdk-typescript": "0.1.26",
    "@defuse-protocol/intents-sdk": "0.93.0",
  },
  cargo: { "near-sdk": "5.29.1" },
};

function walk(dir, found = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (name === "package.json" || name === "Cargo.toml") found.push(path);
  }
  return found;
}

function checkPackageJson(file, root, errors) {
  const rel = relative(root, file);
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  for (const section of NPM_SECTIONS) {
    for (const [name, spec] of Object.entries(pkg[section] ?? {})) {
      if (!NPM_EXACT.test(spec)) errors.push(`${rel}: ${name}@${spec} in ${section} is not an exact version`);
      const want = PETA_MODUL.npm[name];
      if (want && NPM_EXACT.test(spec) && spec !== want) errors.push(`${rel}: ${name}@${spec} differs from Peta Modul (${want})`);
    }
  }
}

// Minimal reader for the dependency tables of a Cargo.toml. It handles `name = "x"`,
// `name = { version = "x", ... }`, and `[dependencies.name]` sub-tables.
function cargoDependencies(text) {
  const deps = [];
  let section = "";
  let subTable = null;
  const flush = () => {
    if (subTable) deps.push(subTable);
    subTable = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const header = line.match(/^\[\s*([^\]]+?)\s*\]$/);
    if (header) {
      flush();
      section = header[1];
      const sub = section.match(/^(.*dependencies)\.(.+)$/);
      if (sub && CARGO_SECTION.test(sub[1])) subTable = { name: sub[2].replace(/"/g, ""), body: "" };
      continue;
    }
    if (subTable) {
      subTable.body += ` ${line}`;
      continue;
    }
    if (!CARGO_SECTION.test(section)) continue;
    const entry = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (entry) deps.push({ name: entry[1], body: entry[2] });
  }
  flush();
  return deps.map(({ name, body }) => {
    const short = body.trim().match(/^"([^"]*)"$/);
    if (short) return { name, version: short[1], spec: body };
    return {
      name,
      version: (body.match(/\bversion\s*=\s*"([^"]*)"/) ?? [])[1],
      path: /\bpath\s*=/.test(body),
      workspace: /\bworkspace\s*=\s*true/.test(body),
      git: /\bgit\s*=/.test(body),
      rev: /\brev\s*=/.test(body),
    };
  });
}

function checkCargoToml(file, root, errors) {
  const rel = relative(root, file);
  for (const dep of cargoDependencies(readFileSync(file, "utf8"))) {
    if (dep.path || dep.workspace) continue;
    if (dep.git && dep.rev && !dep.version) continue;
    if (dep.version === undefined) {
      errors.push(`${rel}: ${dep.name} has no version`);
      continue;
    }
    if (!CARGO_EXACT.test(dep.version)) errors.push(`${rel}: ${dep.name} "${dep.version}" must be written "=x.y.z"`);
    const want = PETA_MODUL.cargo[dep.name];
    if (want && CARGO_EXACT.test(dep.version) && dep.version !== `=${want}`) errors.push(`${rel}: ${dep.name} "${dep.version}" differs from Peta Modul (=${want})`);
  }
}

function isTracked(dir, name) {
  try {
    execFileSync("git", ["-C", dir, "ls-files", "--error-unmatch", name], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// A lockfile is needed in the umbrella root and in every nested folder that has its own .git.
function checkLockfiles(root, manifests, errors) {
  const repoDirs = new Set([root]);
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (!SKIP_DIRS.has(name) && statSync(path).isDirectory() && existsSync(join(path, ".git"))) repoDirs.add(path);
  }
  for (const dir of repoDirs) {
    const own = manifests.filter((f) => f.startsWith(dir + "/") && !(dir === root && [...repoDirs].some((d) => d !== root && f.startsWith(d + "/"))));
    const needs = [];
    if (own.some((f) => f.endsWith("package.json") && dirname(f) === dir)) needs.push("package-lock.json");
    if (own.some((f) => f.endsWith("Cargo.toml") && dirname(f) === dir)) needs.push("Cargo.lock");
    for (const lock of needs) {
      const rel = relative(root, join(dir, lock)) || lock;
      if (!existsSync(join(dir, lock))) errors.push(`${rel}: lockfile is missing`);
      else if (existsSync(join(dir, ".git")) && !isTracked(dir, lock)) errors.push(`${rel}: lockfile is not committed`);
    }
  }
}

export function checkPins(root) {
  const errors = [];
  const manifests = walk(root);
  for (const file of manifests) {
    if (file.endsWith("package.json")) checkPackageJson(file, root, errors);
    else checkCargoToml(file, root, errors);
  }
  checkLockfiles(root, manifests, errors);
  return { errors, manifests: manifests.map((f) => relative(root, f)) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--root");
  const root = resolve(i > 0 ? process.argv[i + 1] : join(dirname(fileURLToPath(import.meta.url)), ".."));
  const { errors, manifests } = checkPins(root);
  if (errors.length > 0) {
    for (const message of errors) console.error(`FAIL ${message}`);
    console.error(`${errors.length} problem(s) in ${manifests.length} manifest(s).`);
    process.exit(1);
  }
  console.log(`OK ${manifests.length} manifests: all dependencies pinned exactly, lockfiles committed.`);
}
