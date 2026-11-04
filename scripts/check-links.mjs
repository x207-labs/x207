#!/usr/bin/env node
// UM-105: check the links of the Markdown files of this repository. Reads git and (for github.com/x207-labs links) the network; changes nothing.
//   - A relative link must point to a file or folder that is in the git tree of this repository. A path inside a submodule (contracts, sdk, backend, frontend, solver, agents)
//     does not count: on GitHub it is a dead link, so it must be an absolute URL.
//   - An anchor (`file.md#heading`) must be a heading of that file.
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
  for (const m of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) out.add(m[1]);
  for (const m of text.matchAll(/<(https?:\/\/[^>\s]+)>/g)) out.add(m[1]);
  out.delete("");
  return [...out];
}

/** The anchors that GitHub makes of the headings of a Markdown text. */
export function anchorsOf(markdown) {
  const text = markdown.replace(/```[\s\S]*?```/g, "");
  const set = new Set();
  for (const m of text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    set.add(m[1].toLowerCase().replace(/[`*_]/g, "").replace(/[^\p{L}\p{N}\- ]/gu, "").trim().replace(/ /g, "-"));
  }
  return set;
}

/** Problems of one file: relative links that are not in the tree, links into a submodule, anchors that no heading has. `inTree` and `anchors` (path -> Set, or null) are injectable for tests. */
export function relativeProblems(file, links, inTree, anchors = () => null) {
  const problems = [];
  for (const link of links) {
    if (/^(https?:|mailto:|tel:)/.test(link)) continue;
    const [path, fragment = ""] = link.split("#");
    if (path === "" && fragment === "") continue;
    const target = path === "" ? file : normalize(join(dirname(file), decodeURIComponent(path))).replace(/\/$/, "");
    if (SUBMODULES.includes(target.split(sep)[0]) && target.split(sep).length > 1) problems.push(`${file}: ${link} points into a submodule; use an absolute https://github.com/x207-labs/ URL`);
    else if (!inTree(target)) problems.push(`${file}: ${link} is not in the repository`);
    else if (fragment !== "" && target.endsWith(".md")) {
      const set = anchors(target);
      if (set && !set.has(decodeURIComponent(fragment).toLowerCase())) problems.push(`${file}: ${link} has no heading with that anchor in ${target}`);
    }
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
    const code = await status(link.split("#")[0], fetchFn);
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
  const cache = new Map();
  const anchors = (p) => {
    if (!cache.has(p)) cache.set(p, tree.has(p) ? anchorsOf(readFileSync(join(root, p), "utf8")) : null);
    return cache.get(p);
  };
  const problems = [];
  let count = 0;
  for (const file of files) {
    const links = linksOf(readFileSync(join(root, file), "utf8"));
    count += links.length;
    problems.push(...relativeProblems(file, links, inTree, anchors));
    if (!argv.includes("--offline")) problems.push(...(await urlProblems(file, links, { external: argv.includes("--external") })));
  }
  process.stdout.write(`${files.length} Markdown files, ${count} links\n`);
  for (const p of problems) process.stdout.write(`  ${p}\n`);
  process.stdout.write(problems.length === 0 ? "Every link resolves.\n" : `${problems.length} link(s) do not resolve.\n`);
  return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));
