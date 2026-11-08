#!/usr/bin/env node
// UM-105: check the links of the Markdown files of this repository. Reads git and (for github.com/x207-labs links) the network; changes nothing.
//   - A relative link must point to a file or folder that is in the git tree of this repository. A path inside a submodule (contracts, sdk, backend, frontend, solver, agents)
//     does not count: on GitHub it is a dead link, so it must be an absolute URL.
//   - An anchor (`file.md#heading`) must be a heading of that file.
//   - A link to https://github.com/x207-labs/... must answer with a status below 400 (a 404 fails). With --external every other http(s) link is checked too.
//     5xx, 429 and no response are tried again three times (2 s, 4 s, 8 s); other 4xx fail at once. One request at a time goes to github.com.
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

async function statusOnce(url, fetchFn) {
  const init = { redirect: "follow", headers: { "user-agent": "x207-check-links (+https://github.com/x207-labs/x207)" } };
  const head = await fetchFn(url, { ...init, method: "HEAD" }).catch(() => null);
  // a HEAD that is refused, limited or answered by a busy server is asked again as a GET, which is what a browser sends
  if (head && head.status < 400) return head.status;
  if (head && head.status === 404) return head.status;
  const get = await fetchFn(url, { ...init, method: "GET" }).catch(() => null);
  return get ? get.status : 0;
}

/** A server that is busy or limiting us is not a dead link: 5xx, 429 and no response are tried again, after these delays. Any other 4xx fails at once. */
export const RETRY_DELAYS_MS = [2000, 4000, 8000];
const retryable = (code) => code === 0 || code === 429 || code >= 500;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

export async function status(url, fetchFn, { delays = RETRY_DELAYS_MS, sleep = wait } = {}) {
  let code = await statusOnce(url, fetchFn);
  for (const ms of delays) {
    if (!retryable(code)) break;
    await sleep(ms);
    code = await statusOnce(url, fetchFn);
  }
  return code;
}

/** At most `max` tasks at a time. */
function limiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || queue.length === 0) return;
    active++;
    const { task, resolve: ok, reject } = queue.shift();
    task().then(ok, reject).finally(() => {
      active--;
      next();
    });
  };
  return (task) => new Promise((resolve, reject) => { queue.push({ task, resolve, reject }); next(); });
}

/**
 * Hosts that answer 403 to every client that is not a browser (bot protection), so a script cannot say whether such a link is alive (audit A-UM-05, UM-197).
 * `--external` does not ask them; the links stay in the documents. Check a transaction without the explorer:
 * `curl https://api-testnet.nearblocks.io/v3/txns/<hash>`, or `npm run check:claims -- --online` (RPC), which asks the chain itself.
 */
export const BOT_BLOCKED_HOSTS = {
  "testnet.nearblocks.io": "403 to non-browser clients (verified 2026-11-08); the API api-testnet.nearblocks.io/v3 answers",
  "sepolia.basescan.org": "403 to non-browser clients (verified 2026-11-08); `eth_getTransactionReceipt` on a Base Sepolia RPC answers",
};
const botBlocked = (link) => new URL(link).host in BOT_BLOCKED_HOSTS;

/** One request at a time to github.com (it answers 504 to a burst), four to any other host. */
export const HOST_LIMITS = { "github.com": 1, default: 4 };

/** Problems of absolute links given as `{ file, link }`, in the order given: a status of 400 or more (a 404 above all) after the retries. A URL that appears twice is asked once. */
export async function checkUrls(entries, { external = false, fetchFn = fetch, delays = RETRY_DELAYS_MS, sleep = wait, limits = HOST_LIMITS } = {}) {
  const runners = new Map();
  const runnerOf = (host) => {
    if (!runners.has(host)) runners.set(host, limiter(limits[host] ?? limits.default));
    return runners.get(host);
  };
  const asked = new Map();
  const codeOf = (link) => {
    const url = link.split("#")[0];
    if (!asked.has(url)) asked.set(url, runnerOf(new URL(url).host)(() => status(url, fetchFn, { delays, sleep })));
    return asked.get(url);
  };
  const wanted = entries.filter(({ link }) => /^https?:/.test(link) && !botBlocked(link) && (external || link.startsWith("https://github.com/x207-labs/")));
  const codes = await Promise.all(wanted.map(({ link }) => codeOf(link)));
  return wanted.flatMap(({ file, link }, i) => (codes[i] === 0 || codes[i] >= 400 ? [`${file}: ${link} answers ${codes[i] === 0 ? "no response" : codes[i]}`] : []));
}

/** Problems of the absolute links of one file. `fetchFn`, `delays` and `sleep` are injectable for tests. */
export function urlProblems(file, links, options = {}) {
  return checkUrls(links.map((link) => ({ file, link })), options);
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
  const entries = [];
  let count = 0;
  for (const file of files) {
    const links = linksOf(readFileSync(join(root, file), "utf8"));
    count += links.length;
    problems.push(...relativeProblems(file, links, inTree, anchors));
    entries.push(...links.map((link) => ({ file, link })));
  }
  if (!argv.includes("--offline")) problems.push(...(await checkUrls(entries, { external: argv.includes("--external") })));
  process.stdout.write(`${files.length} Markdown files, ${count} links\n`);
  for (const p of problems) process.stdout.write(`  ${p}\n`);
  process.stdout.write(problems.length === 0 ? "Every link resolves.\n" : `${problems.length} link(s) do not resolve.\n`);
  return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));
