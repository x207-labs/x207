// UM-107: the guards of scripts/demo-quick.mjs, without a network. Run: node --test scripts/demo-quick.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { KNOWN_SHA256 } from "./deploy-mainnet.mjs";
import { DEFAULT_TAG, DemoStop, MOCK_FT_SHA256, parseArgs, releaseUrl, sandboxUrl, sha256, verifyRelease } from "./demo-quick.mjs";

test("TC-UM-107-01 a wasm with the pinned sha256 passes; any other bytes stop the demo and the message names both numbers", () => {
  const bytes = Buffer.from("not the wasm");
  const table = { "v9.9.9": sha256(bytes) };
  assert.equal(verifyRelease("v9.9.9", bytes, table), sha256(bytes));
  assert.throws(() => verifyRelease("v9.9.9", Buffer.from("tampered"), table), (e) => e instanceof DemoStop && /STOP/.test(e.message) && e.message.includes(sha256(Buffer.from("tampered"))) && e.message.includes(sha256(bytes)) && /did not run/.test(e.message));
});

test("TC-UM-107-02 a tag without a pinned hash stops the demo", () => {
  assert.throws(() => verifyRelease("v0.0.1", Buffer.from("x")), (e) => e instanceof DemoStop && /no pinned sha256/.test(e.message));
});

test("TC-UM-107-03 the default is v0.0.13 with the sha256 of the reproducible build, the same table as the deploy script", () => {
  assert.equal(DEFAULT_TAG, "v0.0.13");
  assert.equal(KNOWN_SHA256["v0.0.13"], "b9327f2b5d64b1180ba76dd619c6091ae57b48964f520a784e366c131e787054");
  assert.equal(releaseUrl("v0.0.13"), "https://github.com/x207-labs/contracts/releases/download/v0.0.13/x207-circle-v0.0.13.wasm");
});

test("TC-UM-107-04 the committed mock token is the file whose hash the script pins", () => {
  assert.equal(sha256(readFileSync(new URL("../contracts/prebuilt/mock_ft.wasm", import.meta.url))), MOCK_FT_SHA256);
});

test("TC-UM-107-05 the sandbox URL follows the platform, and an unsupported machine is a clear stop", () => {
  assert.equal(sandboxUrl("darwin", "arm64"), "https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/Darwin-arm64/2.13.4/near-sandbox.tar.gz");
  assert.match(sandboxUrl("linux", "x64"), /Linux-x86_64\/2\.13\.4/);
  assert.match(sandboxUrl("linux", "arm64"), /Linux-aarch64/);
  assert.throws(() => sandboxUrl("darwin", "x64"), (e) => e instanceof DemoStop && /X207_SANDBOX_BIN/.test(e.message));
  assert.throws(() => sandboxUrl("win32", "x64"), DemoStop);
});

test("TC-UM-107-06 the arguments are strict", () => {
  assert.equal(parseArgs([]).tag, "v0.0.13");
  assert.equal(parseArgs(["--release-wasm", "--check-only"]).checkOnly, true);
  assert.equal(parseArgs(["--tag", "v0.0.12"]).tag, "v0.0.12");
  assert.throws(() => parseArgs(["--tag"]), /needs a value/);
  assert.throws(() => parseArgs(["--bogus"]), /unknown argument/);
});
