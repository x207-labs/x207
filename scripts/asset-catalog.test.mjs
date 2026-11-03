// UM-075: the catalog as data. What the contract would refuse is caught here, without a node.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOG, registerCatalog, termsHashOf, toArgs, validAssetType } from "./lib/asset-catalog.mjs";

const KNOWN_PROOFS = ["rpc_access_key", "tee_attestation", "zktls"];

test("TC-UM-075-01 the catalog has rows 1 to 55 and 61 to 90 once each (class E, rows 56 to 60, is left out) and nine refused kinds", () => {
  const numbered = CATALOG.filter((e) => typeof e.no === "number").map((e) => e.no);
  assert.deepEqual(numbered, [...Array.from({ length: 55 }, (_, i) => i + 1), ...Array.from({ length: 30 }, (_, i) => i + 61)]);
  assert.equal(CATALOG.filter((e) => e.cls === "X").length, 9);
  assert.equal(CATALOG.length, 94);
});

// classes of rows 61 to 90 as the vault note writes them (column "Kelas")
const F_CLASSES = "CBBCBCCDDDDCCCCCCBBBBDDDBBCDDD";

test("TC-UM-075-02 classes follow the catalog sections: 1 to 14 A, 15 to 25 B, 26 to 30 C, 31 to 55 D, rows 61 to 90 as the note says, the refused ones X", () => {
  assert.equal(F_CLASSES.length, 30);
  for (const e of CATALOG) {
    const expected =
      typeof e.no !== "number" ? "X" : e.no <= 14 ? "A" : e.no <= 25 ? "B" : e.no <= 30 ? "C" : e.no <= 55 ? "D" : F_CLASSES[e.no - 61];
    assert.equal(e.cls, expected, `${e.no} ${e.assetType}`);
  }
  const count = (c) => CATALOG.filter((e) => e.cls === c).length;
  assert.deepEqual(["A", "B", "C", "D", "X"].map(count), [14, 20, 16, 35, 9]);
});

test("TC-UM-075-03 every asset_type has the form provider:kind that the contract accepts, and none repeats", () => {
  const seen = new Set();
  for (const e of CATALOG) {
    assert.ok(validAssetType(e.assetType), e.assetType);
    assert.ok(!seen.has(e.assetType), `repeated ${e.assetType}`);
    seen.add(e.assetType);
  }
  assert.equal(validAssetType("a:b:c"), false);
  assert.equal(validAssetType("Upper:case"), false);
  assert.equal(validAssetType("nocolon"), false);
});

test("TC-UM-075-04 delivery methods are non-empty, proofs are among the three kinds, terms_hash is 64 lowercase hex and differs per entry", () => {
  const hashes = new Set();
  for (const e of CATALOG) {
    const { entry } = toArgs(e);
    assert.ok(entry.delivery_methods.length > 0 && entry.delivery_methods.every((m) => m.length > 0), e.assetType);
    assert.ok(entry.accepted_proofs.every((p) => KNOWN_PROOFS.includes(p)), e.assetType);
    assert.match(entry.terms_hash, /^[0-9a-f]{64}$/);
    hashes.add(entry.terms_hash);
    assert.equal(entry.asset_type, e.assetType);
  }
  assert.equal(hashes.size, CATALOG.length);
  assert.equal(termsHashOf(CATALOG[0]), termsHashOf(CATALOG[0]));
});

test("TC-UM-075-05 the names already used in the repository stay: escrow_nft (A), near_access_key (B), proxy (C), and near-rpc:access is class B", () => {
  const by = Object.fromEntries(CATALOG.map((e) => [e.assetType, e]));
  assert.deepEqual(by["nft:nep171"].delivery, ["escrow_nft"]);
  assert.equal(by["near-rpc:access"].cls, "B");
  assert.deepEqual(by["near-rpc:access"].delivery, ["near_access_key"]);
  assert.deepEqual(by["near-rpc:access"].proofs, ["rpc_access_key"]);
  assert.deepEqual(by["api:delegated-key"].delivery, ["proxy"]);
  assert.deepEqual(CATALOG.filter((e) => e.cls === "X").map((e) => e.assetType).sort(), [
    "account:game-or-platform", "credential:stolen-access", "payment:digital-wallet-balance", "pii:third-party-data", "securities:equity", "social:account",
    "subscription:consumer-nonshareable", "token:soulbound", "voucher:identity-bound",
  ]);
  // rows of the note marked "condition" name the official channel of the provider as delivery method
  assert.deepEqual(by["ticket:digital-event"].delivery, ["platform_transfer"]);
  assert.deepEqual(by["game:tradable-item"].delivery, ["game_trade"]);
  assert.deepEqual(by["telco:airtime-data"].delivery, ["carrier_transfer"]);
});

test("TC-UM-075-06 registerCatalog writes every entry once, a second run writes nothing, a changed entry is written again, and it reports what is missing", async () => {
  const registry = new Map();
  const sent = [];
  const view = async (method, args) => (method === "list_asset_classes" ? [...registry.values()].slice(args.from_index, args.from_index + args.limit) : null);
  const send = async ({ methodName, args }) => {
    assert.equal(methodName, "set_asset_class");
    registry.set(args.asset_type, args.entry);
    sent.push(args.asset_type);
    return `hash${sent.length}`;
  };
  const first = await registerCatalog({ view, send });
  assert.equal(first.written.length, 94);
  assert.deepEqual([first.missing, first.wrong, first.total], [[], [], 94]);

  const again = await registerCatalog({ view, send });
  assert.equal(again.written.length, 0);
  assert.equal(again.skipped.length, 94);

  registry.set("nft:nep171", { ...registry.get("nft:nep171"), class: "D" });
  const fixed = await registerCatalog({ view, send });
  assert.deepEqual(fixed.written.map((w) => w.assetType), ["nft:nep171"]);

  const dry = await registerCatalog({ view: async () => [], send, dryRun: true });
  assert.equal(dry.written.length, 94);

  const lossy = await registerCatalog({ view: async (m, a) => (m === "list_asset_classes" ? [...registry.values()].slice(0, 30).slice(a.from_index, a.from_index + a.limit) : null), send: async () => "h" });
  assert.ok(lossy.missing.length > 0);
});

test("TC-UM-075-07 the script holds no key in its text and reads the owner key only from OWNER_SECRET_KEY", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./register-asset-classes.mjs", import.meta.url), "utf8");
  assert.ok(!/ed25519:[1-9A-HJ-NP-Za-km-z]{40,}/.test(source));
  assert.ok(source.includes("process.env.OWNER_SECRET_KEY"));
  assert.ok(!/console\.(log|error)\([^)]*secretKey/.test(source));
});
