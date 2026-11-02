#!/usr/bin/env node
// UM-050: report commits of the product repos that fall outside the build window 2026-11-01T00:00Z .. 2026-11-14T23:59Z
// (How to Submit). Both the author date and the committer date count, on every branch. Reads git only; changes nothing.
//
// Usage: node scripts/check-window.mjs [--root <umbrella dir>] [--json]
// Exit code 0 when no commit is outside the window, 1 otherwise.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const WINDOW = { start: "2026-11-01T00:00:00Z", end: "2026-11-14T23:59:00Z" };
export const REPOS = [".", "contracts", "sdk", "backend", "frontend", "solver", "agents"];

const inside = (iso) => Date.parse(iso) >= Date.parse(WINDOW.start) && Date.parse(iso) <= Date.parse(WINDOW.end);

/** Commits of one repo with a date outside the window. `git` is injectable for tests. */
export function outsideWindow(dir, git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8" })) {
  const log = git(["log", "--all", "--format=%H%x09%aI%x09%cI%x09%s"], dir).trim();
  const commits = log ? log.split("\n").map((line) => line.split("\t")) : [];
  const bad = commits
    .filter(([, author, committer]) => !inside(author) || !inside(committer))
    .map(([hash, author, committer, subject]) => ({ hash: hash.slice(0, 7), author, committer, subject }));
  return { total: commits.length, bad };
}

function main(argv) {
  const rootArg = argv.indexOf("--root");
  const root = resolve(rootArg >= 0 ? argv[rootArg + 1] : join(dirname(fileURLToPath(import.meta.url)), ".."));
  const report = {};
  for (const repo of REPOS) {
    const dir = join(root, repo);
    report[repo === "." ? "x207 (umbrella)" : repo] = existsSync(join(dir, ".git")) ? outsideWindow(dir) : { total: 0, bad: [], missing: true };
  }
  const bad = Object.values(report).reduce((n, r) => n + r.bad.length, 0);
  if (argv.includes("--json")) process.stdout.write(`${JSON.stringify({ window: WINDOW, report }, null, 2)}\n`);
  else {
    process.stdout.write(`Build window ${WINDOW.start} .. ${WINDOW.end}\n`);
    for (const [name, r] of Object.entries(report)) {
      process.stdout.write(`${name}: ${r.missing ? "no git repository here" : `${r.total} commits, ${r.bad.length} outside`}\n`);
      for (const c of r.bad) process.stdout.write(`  ${c.hash} author ${c.author} committer ${c.committer} ${c.subject.slice(0, 80)}\n`);
    }
    process.stdout.write(bad === 0 ? "All commits are inside the window.\n" : `${bad} commit(s) outside the window.\n`);
  }
  return bad === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
