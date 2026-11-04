#!/usr/bin/env node
// UM-104: makes the folder that `railway up` uploads for the epoch keeper of x207-v013.testnet (scripts/keeper.mjs run in a loop).
//   node scripts/railway-keeper-bundle.mjs <out dir>
// The folder holds scripts/keeper.mjs, scripts/lib/keeper.mjs, a sdk/package.json with the one dependency (near-api-js, the version of backend/package.json), the Dockerfile and railway.json.
// No key goes in: KEEPER_SECRET_KEY is a Railway variable, set from the CLI.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [out] = process.argv.slice(2);
if (!out) {
  console.error("usage: node scripts/railway-keeper-bundle.mjs <out dir>");
  process.exit(2);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "scripts/lib"), { recursive: true });
mkdirSync(join(out, "sdk"), { recursive: true });
copyFileSync(join(root, "scripts/keeper.mjs"), join(out, "scripts/keeper.mjs"));
copyFileSync(join(root, "scripts/lib/keeper.mjs"), join(out, "scripts/lib/keeper.mjs"));
const version = JSON.parse(readFileSync(join(root, "backend/package.json"), "utf8")).dependencies["near-api-js"];
writeFileSync(join(out, "sdk/package.json"), JSON.stringify({ name: "x207-keeper-deps", version: "0.0.0", private: true, dependencies: { "near-api-js": version } }, null, 2));
for (const f of ["Dockerfile", "railway.json"]) copyFileSync(join(root, "deploy/railway-keeper", f), join(out, f));
writeFileSync(join(out, ".dockerignore"), "node_modules\n*.log\n.env*\n");
writeFileSync(join(out, ".railwayignore"), "node_modules\n*.log\n.env*\n");
console.log(`bundle in ${out}`);
