#!/usr/bin/env node
// UM-105: check the links of the Markdown files of this repository. Reads git and (for github.com/x207-labs links) the network; changes nothing.
//   - A relative link must point to a file or folder that is in the git tree of this repository. A path inside a submodule (contracts, sdk, backend, frontend, solver, agents)
//     does not count: on GitHub it is a dead link, so it must be an absolute URL.
//   - A link to https://github.com/x207-labs/... must answer with a status below 400 (a 404 fails). With --external every other http(s) link is checked too.
//
// Usage: node scripts/check-links.mjs [--root <umbrella dir>] [--offline] [--external]
// Exit code 0 when every link resolves, 1 otherwise.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const SUBMODULES = ["contracts", "sdk", "backend", "frontend", "solver", "agents"];

/** Links of a Markdown text: inline `[text](target)` and bare `<https://...>` targets, without fragments and without code blocks. */
export function linksOf(markdown) {
  const text = markdown.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  const out = new Set();
  for (const m of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) out.add(m[1].split("#")[0]);
  for (const m of text.matchAll(/<(https?:\/\/[^>\s]+)>/g)) out.add(m[1].split("#")[0]);
  out.delete("");
  return [...out];
}

/** Problems of one file: relative links that are not in the tree, links into a submodule. `inTree` is injectable for tests. */
export function relativeProblems(file, links, inTree) {
  const problems = [];
  for (const link of links) {
    if (/^(https?:|mailto:|tel:)/.test(link) || link.startsWith("#")) continue;
    const target = normalize(join(dirname(file), decodeURIComponent(link))).replace(/\/$/, "");
    if (SUBMODULES.includes(target.split(sep)[0]) && target.split(sep).length > 1) problems.push(`${file}: ${link} points into a submodule; use an absolute https://github.com/x207-labs/ URL`);
    else if (!inTree(target)) problems.push(`${file}: ${link} is not in the repository`);
  }
  return problems;
}

async function status(url, fetchFn) {
  const head = await fetchFn(url, { method: "HEAD", redirect: "follow" }).catch(() => null);
  if (head && head.status !== 405 && head.status !== 403) return head.status;
  const get = await fetchFn(url, { method: "GET", redirect: "follow" }).catch(() => null);
  return get ? get.status : 0;
}

/** Problems of the absolute links: a status of 400 or more (a 404 above all). `fetchFn` is injectable for tests. */
export async function urlProblems(file, links, { external = false, fetchFn = fetch } = {}) {
  const problems = [];
  for (const link of links) {
    if (!/^https?:/.test(link)) continue;
    if (!external && !link.startsWith("https://github.com/x207-labs/")) continue;
    const code = await status(link, fetchFn);
    if (code === 0 || code >= 400) problems.push(`${file}: ${link} answers ${code === 0 ? "no response" : code}`);
  }
  return problems;
}

async function main(argv) {
  const rootArg = argv.indexOf("--root");
  const root = resolve(rootArg >= 0 ? argv[rootArg + 1] : join(dirname(fileURLToPath(import.meta.url)), ".."));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  const files = git("ls-files", "*.md").split("\n").filter(Boolean).filter((f) => !SUBMODULES.includes(f.split("/")[0]));
  const tree = new Set(git("ls-files").split("\n").filter(Boolean));
  const dirs = new Set([...tree].flatMap((f) => f.split("/").slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join("/"))));
  const gitlinks = new Set(git("ls-files", "-s").split("\n").filter((l) => l.startsWith("160000")).map((l) => l.split("\t")[1]));
  const inTree = (p) => tree.has(p) || dirs.has(p) || gitlinks.has(p);
  const problems = [];
  let count = 0;
  for (const file of files) {
    const links = linksOf(readFileSync(join(root, file), "utf8"));
    count += links.length;
    problems.push(...relativeProblems(file, links, inTree));
    if (!argv.includes("--offline")) problems.push(...(await urlProblems(file, links, { external: argv.includes("--external") })));
  }
  process.stdout.write(`${files.length} Markdown files, ${count} links\n`);
  for (const p of problems) process.stdout.write(`  ${p}\n`);
  process.stdout.write(problems.length === 0 ? "Every link resolves.\n" : `${problems.length} link(s) do not resolve.\n`);
  return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));
