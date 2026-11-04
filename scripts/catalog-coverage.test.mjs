// UM-085: scripts/catalog-coverage.mjs counts the catalog by state, class and pipeline; the table in docs/asset-catalog.md is the one it prints. Run: node --test scripts/catalog-coverage.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CATALOG } from "./lib/asset-catalog.mjs";
import { END, START, STATES, coverage, inject, markdown, pipelineOf, stateOf } from "./catalog-coverage.mjs";

const entry = (over) => ({ no: 1, assetType: "a:b", cls: "A", name: "n", delivery: ["escrow_nft"], proofs: [], status: "built", ...over });

test("TC-UM-085-01 a status is sorted by its first word; class X is refused whatever it says; an unknown start is an error", () => {
  assert.equal(stateOf(entry({ status: "built (CT-075)" })), "built");
  assert.equal(stateOf(entry({ status: "built, when the ticket is an NFT" })), "built");
  assert.equal(stateOf(entry({ status: "built with a mock issuer (UM-094)" })), "mock");
  assert.equal(stateOf(entry({ status: "item CT-090" })), "planned");
  assert.equal(stateOf(entry({ status: "items CT-090, CT-091" })), "planned");
  assert.equal(stateOf(entry({ status: "roadmap; condition: x" })), "roadmap");
  assert.equal(stateOf(entry({ cls: "X", status: "refused: illegal" })), "refused");
  assert.throws(() => stateOf(entry({ status: "maybe later" })), /starts with none of/);
});

test("TC-UM-085-02 every entry of the catalog is counted once, per class, per pipeline and in total", () => {
  const c = coverage();
  const sum = (r) => STATES.reduce((n, s) => n + r[s], 0);
  assert.equal(c.entries, CATALOG.length);
  assert.equal(sum(c.total), CATALOG.length);
  assert.equal(Object.values(c.byClass).reduce((n, r) => n + sum(r), 0), CATALOG.length);
  assert.equal(Object.values(c.byPipeline).reduce((n, r) => n + sum(r), 0), CATALOG.length);
  assert.equal(c.total.refused, CATALOG.filter((e) => e.cls === "X").length);
  assert.equal(c.byClass.X.refused, c.total.refused);
  for (const e of CATALOG) assert.ok(pipelineOf(e) !== "other", `entry ${e.no} (${e.assetType}) has a delivery method that no pipeline lists: ${e.delivery}`);
});

test("TC-UM-085-03 the pipeline comes from the delivery method", () => {
  assert.equal(pipelineOf(entry({ delivery: ["escrow_ft"] })), "P1");
  assert.equal(pipelineOf(entry({ cls: "B", delivery: ["near_access_key"] })), "P2");
  assert.equal(pipelineOf(entry({ cls: "C", delivery: ["secret_release"] })), "P3");
  assert.equal(pipelineOf(entry({ cls: "C", delivery: ["platform_transfer"] })), "P4");
  assert.equal(pipelineOf(entry({ cls: "D", delivery: ["x402_endpoint"] })), "P5");
  assert.equal(pipelineOf(entry({ cls: "D", delivery: ["licensed_download"] })), "P7");
  assert.equal(pipelineOf(entry({ delivery: ["something_new"] })), "other");
});

test("TC-UM-085-04 the sentence of the table states the counts it was made from, and a changed status changes the numbers", () => {
  const before = coverage();
  const text = markdown();
  assert.match(text, new RegExp(`\\*\\*${before.total.built} are built\\*\\*`));
  assert.match(text, new RegExp(`\\*\\*${before.total.mock} run end to end with a mock`));
  const changed = CATALOG.map((e) => (e.no === 13 ? { ...e, status: "built (test)" } : e));
  assert.equal(coverage(changed).total.built, before.total.built + 1);
  assert.equal(coverage(changed).total.roadmap, before.total.roadmap - 1);
});

test("TC-UM-085-05 docs/asset-catalog.md holds exactly the table that the script prints (run `node scripts/catalog-coverage.mjs --write` when this fails)", () => {
  const doc = readFileSync(new URL("../docs/asset-catalog.md", import.meta.url), "utf8");
  assert.equal(inject(doc, markdown()), doc);
});

test("TC-UM-085-06 inject needs both markers and replaces only what is between them", () => {
  assert.throws(() => inject("no markers", "x"), /markers/);
  const out = inject(`before\n${START}\nold\n${END}\nafter`, "new");
  assert.equal(out, `before\n${START}\nnew\n${END}\nafter`);
});
