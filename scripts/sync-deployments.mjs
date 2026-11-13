// UM-208: write the generated copy of docs/deployments.json into the frontend (src/deployments.generated.ts) and the docs site
// (src/lib/deployments.generated.ts). A checkout that is missing is skipped and named. Commit each copy in its own repository afterwards.
//
// Usage: node scripts/sync-deployments.mjs [--root <umbrella dir>] [--frontend <frontend dir>] [--docs <docs-site dir>]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TARGETS, loadDeployments, parseArgs, renderModule, targetDir } from './deployments-lib.mjs';

const args = parseArgs(process.argv.slice(2));
const d = loadDeployments(args.root);
const text = renderModule(d);
for (const t of TARGETS) {
  const dir = targetDir(args, t);
  if (!existsSync(dir)) {
    console.log(`${t.name}: skipped, ${dir} is not checked out`);
    continue;
  }
  const file = join(dir, t.file);
  const before = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (before === text) {
    console.log(`${t.name}: ${t.file} is current`);
    continue;
  }
  writeFileSync(file, text);
  console.log(`${t.name}: wrote ${t.file} (active ${d.active})`);
}
