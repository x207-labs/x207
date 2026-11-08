// Tests for scripts/check-links.mjs (UM-105). Run: node --test scripts/check-links.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { anchorsOf, BOT_BLOCKED_HOSTS, checkUrls, linksOf, relativeProblems, status, urlProblems } from "./check-links.mjs";

test("links come from the text, not from code", () => {
  const md = "See [a](docs/a.md#top) and [b](https://github.com/x207-labs/sdk/blob/main/x.md) and <https://example.com/x>.\n`[c](no.md)`\n```\n[d](nope.md)\n```\n";
  assert.deepEqual(linksOf(md).sort(), ["docs/a.md#top", "https://example.com/x", "https://github.com/x207-labs/sdk/blob/main/x.md"]);
});

test("a relative link into a submodule or to a missing file is a problem; a file of the tree is not", () => {
  const inTree = (p) => p === "docs/a.md";
  const problems = relativeProblems("README.md", ["docs/a.md", "docs/missing.md", "contracts/tests/ct029.rs", "https://x.example/"], inTree);
  assert.equal(problems.length, 2);
  assert.ok(problems[0].includes("not in the repository"));
  assert.ok(problems[1].includes("submodule"));
});

test("explorer hosts that block bots are not asked even with external, and the reason is written down (UM-197)", async () => {
  const asked = [];
  const fetchFn = async (url) => { asked.push(url); return { status: 403 }; };
  const links = ["https://testnet.nearblocks.io/txns/abc", "https://sepolia.basescan.org/tx/0x1", "https://example.org/x"];
  const problems = await urlProblems("README.md", links, { fetchFn, external: true, delays: [] });
  assert.ok(asked.length > 0 && asked.every((u) => u === "https://example.org/x"));
  assert.equal(problems.length, 1);
  for (const reason of Object.values(BOT_BLOCKED_HOSTS)) assert.match(reason, /403/);
});

test("a 404 on a x207-labs URL fails; other hosts are skipped unless external", async () => {
  const fetchFn = async (url) => ({ status: url.endsWith("/gone.md") ? 404 : 200 });
  const links = ["https://github.com/x207-labs/sdk/blob/main/gone.md", "https://github.com/x207-labs/sdk/blob/main/ok.md", "https://example.com/gone.md"];
  assert.deepEqual((await urlProblems("README.md", links, { fetchFn })).map((p) => p.split(" ").pop()), ["404"]);
  assert.equal((await urlProblems("README.md", links, { fetchFn, external: true })).length, 2);
});

test("an anchor must be a heading of the file it points to, in the same file or in another one", () => {
  assert.deepEqual([...anchorsOf("# One\n## Try it in 2 minutes\n### What has (and has not) run?\n```\n# not a heading\n```\n")].sort(), ["one", "try-it-in-2-minutes", "what-has-and-has-not-run"]);
  const anchors = (p) => (p === "docs/a.md" ? new Set(["top"]) : p === "README.md" ? new Set(["here"]) : null);
  const inTree = () => true;
  assert.deepEqual(relativeProblems("README.md", ["docs/a.md#top", "#here"], inTree, anchors), []);
  const bad = relativeProblems("README.md", ["docs/a.md#gone", "#nowhere"], inTree, anchors);
  assert.equal(bad.length, 2);
  assert.ok(bad[0].includes("no heading with that anchor"));
});

const noWait = () => Promise.resolve();

test("a 503, then a 504, then a 200 passes after retries with the delays 2, 4 s", async () => {
  const tries = [503, 504, 200]; // one answer per try; a failed HEAD is followed by a GET with the same answer
  const delays = [];
  let n = 0;
  const fetchFn = async (url, init) => ({ status: tries[init.method === "HEAD" ? n++ : n - 1] });
  assert.equal(await status("https://github.com/x207-labs/x", fetchFn, { sleep: async (ms) => void delays.push(ms) }), 200);
  assert.deepEqual(delays, [2000, 4000]);
});

test("a 429 is retried, and a 504 that never goes away fails after three retries (2, 4, 8 s)", async () => {
  const delays = [];
  const calls = [];
  const fetchFn = async () => (calls.push(1), { status: 504 });
  const out = await urlProblems("README.md", ["https://github.com/x207-labs/sdk"], { fetchFn, sleep: async (ms) => void delays.push(ms) });
  assert.deepEqual(out, ["README.md: https://github.com/x207-labs/sdk answers 504"]);
  assert.deepEqual(delays, [2000, 4000, 8000]);
  assert.equal(calls.length, 8); // HEAD, then GET, on each of the four tries
  let m = 0;
  const tries = [429, 200];
  assert.equal(await status("https://github.com/x207-labs/x", async (url, init) => ({ status: tries[init.method === "HEAD" ? m++ : m - 1] }), { sleep: noWait }), 200);
});

test("a 404 or another 4xx is not retried", async () => {
  const calls = [];
  const fetchFn = async () => (calls.push(1), { status: 404 });
  assert.equal(await status("https://github.com/x207-labs/gone", fetchFn, { sleep: noWait }), 404);
  assert.equal(calls.length, 1);
});

test("a HEAD that answers 504 is asked again as a GET in the same try", async () => {
  const methods = [];
  const fetchFn = async (url, init) => (methods.push(init.method), { status: init.method === "HEAD" ? 504 : 200 });
  assert.equal(await status("https://github.com/x207-labs/x", fetchFn, { sleep: noWait }), 200);
  assert.deepEqual(methods, ["HEAD", "GET"]);
});

test("no more than one request at a time goes to github.com, and a URL that appears twice is asked once", async () => {
  let active = 0;
  let peak = 0;
  const asked = [];
  const fetchFn = async (url) => {
    asked.push(url);
    active++;
    peak = Math.max(peak, active);
    await new Promise((done) => setTimeout(done, 5));
    active--;
    return { status: 200 };
  };
  const entries = [];
  for (let i = 0; i < 8; i++) entries.push({ file: "a.md", link: `https://github.com/x207-labs/r${i}` });
  entries.push({ file: "b.md", link: "https://github.com/x207-labs/r0#section" });
  assert.deepEqual(await checkUrls(entries, { fetchFn, sleep: noWait }), []);
  assert.equal(peak, 1);
  assert.equal(asked.filter((u) => u === "https://github.com/x207-labs/r0").length, 1);
});
