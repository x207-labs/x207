#!/usr/bin/env node
// SD-049: adoption metrics of x207, read-only, no key.
//   npm run metrics:adoption                 prints JSON, then a short summary on stderr
//   node scripts/adoption-metrics.mjs --out docs/adoption-metrics.json
//   node scripts/adoption-metrics.mjs --offline   skips the network and prints the shape (used by the test)
// What it reads:
//   1. every repository of the GitHub organization `x207-labs`: stars, forks, watchers, open issues; views and clones of the last 14 days
//      when the `gh` login can read traffic (it needs push access to the repository; otherwise the field says so, nothing is guessed);
//   2. npm downloads of the last week for @x207/core, @x207/scheme and @x207/mcp (api.npmjs.org; a package that is new may have no data yet);
//   3. the x402 issue of the binding proposal (x402-foundation/x402#4131): state, comments, labels, reactions;
//   4. the members of the circle `x207-v013.testnet` on NEAR testnet (view `list_members`), by status.
// Private repositories are left out. Views and clones include the team's own clones and CI runs, so read them as an upper bound of outside interest.
// Every source is read on its own: one that fails reports its error and the others still print.
import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);
const ORG = process.env.X207_GH_ORG ?? "x207-labs";
const PACKAGES = ["@x207/core", "@x207/scheme", "@x207/mcp"];
const ISSUE = { repo: "x402-foundation/x402", number: 4131 };
const CIRCLE = process.env.X207_CIRCLE ?? "x207-v013.testnet";
const RPC = process.env.X207_TESTNET_RPC ?? "https://rpc.testnet.fastnear.com";
const args = process.argv.slice(2);
const offline = args.includes("--offline");
const outPath = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;

const errorText = (e) => String(e?.stderr || e?.message || e).split("\n").find((l) => l.trim()) ?? "error";
async function gh(path) {
  try {
    const { stdout } = await run("gh", ["api", path], { maxBuffer: 16 * 1024 * 1024 });
    return { ok: true, data: JSON.parse(stdout) };
  } catch (e) {
    // no `gh`, or no login: fall back to the public API, which is rate limited but needs no key
    if (e?.code === "ENOENT" || /auth|login|token/i.test(errorText(e))) {
      const r = await fetch(`https://api.github.com/${path}`, { headers: { accept: "application/vnd.github+json", "user-agent": "x207-adoption-metrics" } });
      return r.ok ? { ok: true, data: await r.json() } : { ok: false, error: `HTTP ${r.status}` };
    }
    return { ok: false, error: errorText(e) };
  }
}

async function repositories() {
  const list = await gh(`orgs/${ORG}/repos?per_page=100`);
  if (!list.ok) return { error: list.error };
  const rows = [];
  for (const r of list.data.filter((x) => !x.private)) {
    const row = { name: r.name, stars: r.stargazers_count, forks: r.forks_count, watchers: r.subscribers_count ?? null, openIssues: r.open_issues_count };
    for (const kind of ["views", "clones"]) {
      const t = await gh(`repos/${ORG}/${r.name}/traffic/${kind}`);
      row[kind] = t.ok ? { count: t.data.count, uniques: t.data.uniques, days: 14 } : { unavailable: t.error.includes("403") || t.error.includes("push access") ? "needs push access to the repository" : t.error };
    }
    rows.push(row);
  }
  return { organization: ORG, repositories: rows };
}

async function npmDownloads() {
  const out = {};
  for (const name of PACKAGES) {
    try {
      const r = await fetch(`https://api.npmjs.org/downloads/point/last-week/${name}`);
      const j = await r.json();
      out[name] = r.ok ? { downloadsLastWeek: j.downloads, from: j.start, to: j.end } : { unavailable: j.error ?? `HTTP ${r.status}` };
      const meta = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}`);
      if (meta.ok) out[name].latest = (await meta.json())["dist-tags"]?.latest ?? null;
    } catch (e) {
      out[name] = { unavailable: errorText(e) };
    }
  }
  return out;
}

async function issue() {
  const r = await gh(`repos/${ISSUE.repo}/issues/${ISSUE.number}`);
  if (!r.ok) return { error: r.error };
  const d = r.data;
  const reactions = d.reactions ? Object.fromEntries(Object.entries(d.reactions).filter(([k, v]) => k !== "url" && v > 0)) : {};
  return { url: d.html_url, title: d.title, state: d.state, comments: d.comments, labels: d.labels.map((l) => l.name), reactions, updatedAt: d.updated_at };
}

async function circleMembers() {
  const members = [];
  for (let from = 0; ; from += 100) {
    const r = await fetch(RPC, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: CIRCLE, method_name: "list_members", args_base64: Buffer.from(JSON.stringify({ from_index: from, limit: 100 })).toString("base64") } }),
    });
    const j = await r.json();
    if (j.error || !j.result?.result) return { error: JSON.stringify(j.error ?? j.result).slice(0, 200) };
    const page = JSON.parse(Buffer.from(j.result.result).toString("utf8"));
    members.push(...page);
    if (page.length < 100) break;
  }
  const byStatus = {};
  for (const m of members) byStatus[m.status] = (byStatus[m.status] ?? 0) + 1;
  return { circle: CIRCLE, network: "testnet", members: members.length, byStatus };
}

const safe = async (f) => { try { return await f(); } catch (e) { return { error: errorText(e) }; } };
const result = { generatedAt: new Date().toISOString() };
if (offline) {
  Object.assign(result, { offline: true, github: null, npm: null, issue: null, circle: null });
} else {
  result.github = await safe(repositories);
  result.npm = await safe(npmDownloads);
  result.issue = await safe(issue);
  result.circle = await safe(circleMembers);
}
const json = JSON.stringify(result, null, 2);
console.log(json);
if (outPath) writeFileSync(outPath, json + "\n");

const lines = [];
if (result.github?.repositories) {
  const g = result.github.repositories;
  lines.push(`repositories: ${g.length}; stars ${g.reduce((n, r) => n + r.stars, 0)}, forks ${g.reduce((n, r) => n + r.forks, 0)}`);
  const v = g.filter((r) => r.views?.count !== undefined);
  lines.push(v.length ? `traffic (14 days): views ${v.reduce((n, r) => n + r.views.count, 0)}, clones ${v.reduce((n, r) => n + r.clones.count, 0)}` : "traffic: unavailable for this login");
}
if (result.npm) lines.push("npm last week: " + PACKAGES.map((p) => `${p} ${result.npm[p]?.downloadsLastWeek ?? `no data yet (latest ${result.npm[p]?.latest ?? "unknown"})`}`).join(", "));
if (result.issue?.state) lines.push(`issue ${ISSUE.repo}#${ISSUE.number}: ${result.issue.state}, ${result.issue.comments} comments, labels [${result.issue.labels.join(", ")}]`);
if (result.circle?.members !== undefined) lines.push(`circle ${CIRCLE}: ${result.circle.members} members ${JSON.stringify(result.circle.byStatus)}`);
if (lines.length) console.error("\n" + lines.join("\n"));
