// UM-208: check that the public text agrees with docs/deployments.json, the one source of the active circle.
//   1. The generated copies in the frontend (src/deployments.generated.ts) and the docs site (src/lib/deployments.generated.ts) equal what
//      scripts/sync-deployments.mjs would write now. A checkout that is missing is skipped and named.
//   2. A sentence that speaks of the active, current, main, newest or default circle, "the active x207-...", "running now" or the hosted
//      build/dashboard must name the active circle (`x207-vNNN.testnet`, `circle=vNNN` or `vNNN.x207.boxd.sh`). A sentence that names only
//      other circles fails. History stays allowed: a sentence about epoch 8 on v013 has none of those phrases. A line with a `%ACTIVE_...%` token (the docs site replaces it at build
//      with the active circle, see docs-site src/lib/remark-active-circle.ts) or the comment `check-deployments: ignore` is skipped.
// Files: README.md, CLAIMS.md and docs/**/*.md of the umbrella; README.md of each submodule; README.md and content/docs/**/*.mdx of the docs site.
// Reads files only; changes nothing.
//
// Usage: node scripts/check-deployments.mjs [--root <umbrella dir>] [--frontend <dir>] [--docs <dir>] [--active <key>]
// `--active vNNN` checks the text as if that circle were active (to see what a switch would flag); it skips step 1.
// Exit code 0 when everything agrees, 1 otherwise.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { TARGETS, loadDeployments, parseArgs, renderModule, targetDir } from './deployments-lib.mjs';

const args = parseArgs(process.argv.slice(2));
const d = loadDeployments(args.root);
const active = args.active ?? d.active;
if (!d.circles.some((c) => c.key === active)) {
  console.error(`--active ${active} is not a circle of ${'docs/deployments.json'}`);
  process.exit(1);
}
const problems = [];

// 1. Generated copies.
if (args.active === undefined) {
  const text = renderModule(d);
  for (const t of TARGETS) {
    const dir = targetDir(args, t);
    if (!existsSync(dir)) {
      console.log(`copy ${t.name}: skipped, ${dir} is not checked out`);
      continue;
    }
    const file = join(dir, t.file);
    if (!existsSync(file)) problems.push(`${t.name}/${t.file}: missing; run npm run sync:deployments`);
    else if (readFileSync(file, 'utf8') !== text) problems.push(`${t.name}/${t.file}: differs from docs/deployments.json; run npm run sync:deployments`);
    else console.log(`copy ${t.name}: current (active ${d.active})`);
  }
}

// 2. Sentences that name the active circle.
const walk = (dir, ext) => {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, ext));
    else if (name.endsWith(ext)) out.push(p);
  }
  return out;
};
const files = [];
const add = (label, path) => {
  if (existsSync(path)) files.push({ label, path });
};
add('README.md', join(args.root, 'README.md'));
add('CLAIMS.md', join(args.root, 'CLAIMS.md'));
for (const p of walk(join(args.root, 'docs'), '.md')) files.push({ label: relative(args.root, p), path: p });
for (const sub of ['contracts', 'sdk', 'backend', 'solver', 'agents']) add(`${sub}/README.md`, join(args.root, sub, 'README.md'));
const fe = targetDir(args, TARGETS[0]);
add('frontend/README.md', join(fe, 'README.md'));
const docs = targetDir(args, TARGETS[1]);
add('docs-site/README.md', join(docs, 'README.md'));
for (const p of walk(join(docs, 'content', 'docs'), '.mdx')) files.push({ label: `docs-site/${relative(docs, p)}`, path: p });

const TRIGGER = /\b(active|current|main|newest|default)( testnet)? circle\b|\bthe active `?x207-|\bnewest is contract\b|\brunning now\b|\bhosted (build|dashboard)\b/i;
const REF = /x207-(v0\d\d)\.testnet|\bcircle=(v0\d\d)\b|\b(v0\d\d)\.x207\.boxd\.sh/g;
let sentences = 0;
for (const f of files) {
  const lines = readFileSync(f.path, 'utf8').split('\n');
  let fence = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence || line.includes('%ACTIVE_') || line.includes('check-deployments: ignore')) return;
    for (const s of line.split(/(?<=[.!?;])\s+(?=[A-Z`*[(<])/)) {
      if (!TRIGGER.test(s)) continue;
      const refs = [...s.matchAll(REF)].map((m) => m[1] ?? m[2] ?? m[3]);
      if (refs.length === 0) continue;
      sentences++;
      if (!refs.includes(active)) problems.push(`${f.label}:${i + 1}: names ${[...new Set(refs)].join(', ')} as active/current, the active circle is ${active}: "${s.trim().slice(0, 160)}"`);
    }
  });
}

console.log(`${files.length} files, ${sentences} sentences name a circle as active or current; active circle ${active}`);
if (problems.length > 0) {
  for (const p of problems) console.error(`  ${p}`);
  console.error(`${problems.length} problem(s).`);
  process.exit(1);
}
console.log('Every copy is current and every sentence names the active circle.');
