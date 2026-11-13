// UM-208: shared code of sync-deployments.mjs and check-deployments.mjs. `docs/deployments.json` is the one source of the circles and of the
// active one; the frontend and the docs site get a generated TypeScript copy each, because they are separate repositories that build on their own.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const SOURCE = 'docs/deployments.json';

/** Where the generated copies go, relative to the frontend checkout and to the docs site checkout. */
export const TARGETS = [
  { name: 'frontend', option: 'frontend', defaultDir: 'frontend', file: 'src/deployments.generated.ts' },
  { name: 'docs-site', option: 'docs', defaultDir: 'docs-site', file: 'src/lib/deployments.generated.ts' },
];

/** `--root <dir>`, `--frontend <dir>`, `--docs <dir>`, `--active <key>`. */
export function parseArgs(argv) {
  const out = { root: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!['--root', '--frontend', '--docs', '--active'].includes(flag)) throw new Error(`unknown argument ${flag}`);
    if (value === undefined) throw new Error(`${flag} needs a value`);
    out[flag.slice(2)] = value;
    i++;
  }
  out.root = resolve(out.root);
  return out;
}

export function targetDir(args, target) {
  return args[target.option] ? resolve(args[target.option]) : join(args.root, target.defaultDir);
}

/** Reads and validates the source. Throws with a clear message when a rule is broken. */
export function loadDeployments(root) {
  const d = JSON.parse(readFileSync(join(root, SOURCE), 'utf8'));
  const keys = new Set();
  if (!Array.isArray(d.circles) || d.circles.length === 0) throw new Error(`${SOURCE}: circles must be a non-empty list`);
  for (const c of d.circles) {
    if (!/^v0\d\d$/.test(c.key)) throw new Error(`${SOURCE}: bad key ${c.key}`);
    if (keys.has(c.key)) throw new Error(`${SOURCE}: duplicate key ${c.key}`);
    keys.add(c.key);
    if (c.contract !== `x207-${c.key}.${d.network}`) throw new Error(`${SOURCE}: ${c.key} contract must be x207-${c.key}.${d.network}, is ${c.contract}`);
    if (!/^\d+\.\d+\.\d+$/.test(c.interface)) throw new Error(`${SOURCE}: ${c.key} bad interface ${c.interface}`);
    if (c.apiUrl !== null && !/^https:\/\/[a-z0-9.-]+$/.test(c.apiUrl)) throw new Error(`${SOURCE}: ${c.key} apiUrl must be an https origin or null`);
    if (typeof c.note !== 'string' || c.note === '') throw new Error(`${SOURCE}: ${c.key} needs a note`);
  }
  const active = d.circles.find((c) => c.key === d.active);
  if (!active) throw new Error(`${SOURCE}: active ${d.active} is not in circles`);
  if (active.apiUrl === null) throw new Error(`${SOURCE}: the active circle ${d.active} needs an apiUrl`);
  return d;
}

/** The generated module, byte for byte. */
export function renderModule(d) {
  return [
    '// Generated from x207/docs/deployments.json by scripts/sync-deployments.mjs (UM-208). Do not edit by hand:',
    '// change the source in the umbrella repository and run `npm run sync:deployments` there.',
    '',
    `export const DEPLOYMENTS = ${JSON.stringify(d, null, 2)} as const;`,
    '',
  ].join('\n');
}
