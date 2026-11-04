// Tests for scripts/check-links.mjs (UM-105). Run: node --test scripts/check-links.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { anchorsOf, linksOf, relativeProblems, urlProblems } from "./check-links.mjs";

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
