// Tests for scripts/check-pins.mjs (UM-007). Run: node --test scripts/check-pins.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { checkPins } from "./check-pins.mjs";

const PKG = {
  name: "demo",
  private: true,
  dependencies: { "@x402/fetch": "2.29.0", hono: "4.13.16" },
  devDependencies: { vitest: "5.0.5" },
};
const CARGO = `[package]
name = "demo"
version = "0.0.1"

[dependencies]
near-sdk = "=5.30.1"

[dev-dependencies]
near-sdk = { version = "=5.30.1", features = ["unit-testing"] }
tokio = { version = "=1.54.1", features = ["full"] }
local = { path = "../local" }
`;

// A fixture repo with one package.json, one Cargo.toml, both lockfiles, all committed.
function fixture({ pkg = PKG, cargo = CARGO, commit = true, lockfiles = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "check-pins-"));
  const put = (name, text) => {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), text);
  };
  put("package.json", JSON.stringify(pkg, null, 2));
  put("contracts/Cargo.toml", cargo);
  execFileSync("git", ["init", "-q", root]);
  if (lockfiles) put("package-lock.json", "{}");
  // contracts has its own git history, like the product repos
  execFileSync("git", ["init", "-q", join(root, "contracts")]);
  if (lockfiles) put("contracts/Cargo.lock", "# lock\n");
  if (commit) {
    for (const [dir, files] of [[root, ["package.json", ...(lockfiles ? ["package-lock.json"] : [])]], [join(root, "contracts"), ["Cargo.toml", ...(lockfiles ? ["Cargo.lock"] : [])]]]) {
      execFileSync("git", ["-C", dir, "add", ...files]);
    }
  }
  return root;
}
const run = (root) => checkPins(root).errors;
const withFixture = (opts, fn) => {
  const root = fixture(opts);
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test("TC-UM-007-01 exact pins and committed lockfiles pass", () => {
  withFixture({}, (root) => assert.deepEqual(run(root), []));
});

test("TC-UM-007-02 caret on @x402/fetch fails and names package and file", () => {
  const pkg = { ...PKG, dependencies: { ...PKG.dependencies, "@x402/fetch": "^2.29.0" } };
  withFixture({ pkg }, (root) => {
    const errors = run(root);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /package\.json/);
    assert.match(errors[0], /@x402\/fetch@\^2\.29\.0/);
  });
});

test("TC-UM-007-03 tilde, range, and tag fail", () => {
  for (const spec of ["~4.13.16", ">=4.13.16", "4.x", "latest", "*"]) {
    const pkg = { ...PKG, dependencies: { ...PKG.dependencies, hono: spec } };
    withFixture({ pkg }, (root) => assert.equal(run(root).length, 1, spec));
  }
});

test("TC-UM-007-03b a Peta Modul package pinned to another exact version fails", () => {
  const pkg = { ...PKG, dependencies: { ...PKG.dependencies, "@x402/fetch": "2.27.0" } };
  withFixture({ pkg }, (root) => {
    const errors = run(root);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /differs from Peta Modul/);
  });
});

test("TC-UM-007-04 Cargo: bare version and caret fail, only =x.y.z passes", () => {
  for (const version of ["5.30.1", "^5.30.1", "~5.30.1", ">=5.30.1"]) {
    withFixture({ cargo: CARGO.replace('[dependencies]\nnear-sdk = "=5.30.1"', `[dependencies]\nnear-sdk = "${version}"`) }, (root) => {
      const errors = run(root);
      assert.equal(errors.length, 1, version);
      assert.match(errors[0], /Cargo\.toml/);
      assert.match(errors[0], /near-sdk/);
    });
  }
});

test("TC-UM-007-04b Cargo: table form and sub-table form are checked", () => {
  withFixture({ cargo: CARGO.replace('tokio = { version = "=1.54.1"', 'tokio = { version = "1.54.1"') }, (root) => assert.equal(run(root).length, 1));
  withFixture({ cargo: `${CARGO}\n[dependencies.serde]\nversion = "1.0.0"\n` }, (root) => assert.equal(run(root).length, 1));
  withFixture({ cargo: `${CARGO}\n[dependencies.serde]\nversion = "=1.0.0"\n` }, (root) => assert.deepEqual(run(root), []));
});

test("TC-UM-007-05 missing or uncommitted lockfile fails", () => {
  withFixture({ lockfiles: false }, (root) => {
    const errors = run(root);
    assert.equal(errors.length, 2);
    assert.ok(errors.some((e) => /package-lock\.json: lockfile is missing/.test(e)));
    assert.ok(errors.some((e) => /Cargo\.lock: lockfile is missing/.test(e)));
  });
  withFixture({ commit: false }, (root) => {
    const errors = run(root);
    assert.equal(errors.length, 2);
    assert.ok(errors.every((e) => /not committed/.test(e)));
  });
});
