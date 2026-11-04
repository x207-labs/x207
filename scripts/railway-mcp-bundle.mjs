#!/usr/bin/env node
// SD-085: makes the folder that `railway up` uploads for the public read-only MCP server (`@x207/mcp`, Streamable HTTP, the six read tools).
//   node scripts/railway-mcp-bundle.mjs <out dir>        (run `npm run build --workspaces --if-present` first)
// The folder holds the built packages `@x207/core`, `@x207/scheme` and `@x207/mcp` (`vendor/`, they are not on the npm registry), a package.json that points to them, the Dockerfile and
// `railway.json`. Nothing secret goes in: the server holds no key, and the variables are public URLs and names (see the README, "Connect your AI agent").
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [out] = process.argv.slice(2);
if (!out) {
  console.error("usage: node scripts/railway-mcp-bundle.mjs <out dir>");
  process.exit(2);
}
const packages = { "x207-core": "core", "x207-scheme": "scheme", "x207-mcp": "mcp" };
for (const dir of Object.values(packages)) if (!existsSync(join(root, "sdk/packages", dir, "dist/index.js"))) throw new Error(`build the SDK first: sdk/packages/${dir}/dist is missing`);

rmSync(out, { recursive: true, force: true });
const read = (dir) => JSON.parse(readFileSync(join(root, "sdk/packages", dir, "package.json"), "utf8"));
for (const [name, dir] of Object.entries(packages)) {
  mkdirSync(join(out, "vendor", name), { recursive: true });
  copyFileSync(join(root, "sdk/packages", dir, "package.json"), join(out, "vendor", name, "package.json"));
  cpSync(join(root, "sdk/packages", dir, "dist"), join(out, "vendor", name, "dist"), { recursive: true });
}
// the vendored packages name each other by version; inside the bundle they are folders
const local = { "@x207/core": "file:vendor/x207-core", "@x207/scheme": "file:vendor/x207-scheme", "@x207/mcp": "file:vendor/x207-mcp" };
for (const [name, dir] of Object.entries(packages)) {
  const file = join(out, "vendor", name, "package.json");
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  for (const dep of Object.keys(pkg.dependencies ?? {})) if (local[dep]) pkg.dependencies[dep] = `file:../${local[dep].split("/").pop()}`;
  delete pkg.devDependencies;
  writeFileSync(file, JSON.stringify(pkg, null, 2));
  void dir;
}
const mcp = read("mcp");
writeFileSync(join(out, "package.json"), JSON.stringify({
  name: "x207-mcp-deploy", version: mcp.version, private: true, type: "module", description: "x207 MCP server, read tools over Streamable HTTP, built from the sdk repo (SD-085)",
  engines: mcp.engines, scripts: { start: "node vendor/x207-mcp/dist/cli.js --http --host 0.0.0.0" },
  dependencies: { "@x207/mcp": local["@x207/mcp"] },
}, null, 2));
for (const f of ["Dockerfile", "railway.json"]) copyFileSync(join(root, "deploy/railway-mcp", f), join(out, f));
writeFileSync(join(out, ".railwayignore"), "node_modules\n*.log\n.env*\n");
writeFileSync(join(out, ".dockerignore"), "node_modules\n*.log\n.env*\n");
console.log(`bundle in ${out}`);
