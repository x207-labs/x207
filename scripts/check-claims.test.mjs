// Tests for scripts/check-claims.mjs (UM-103). Run: node --test scripts/check-claims.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkClaims, referencesOf } from "./check-claims.mjs";

const HASH = "329TWFnAzGwvKjR2fdRdqTKqVzLLRki7t5wWzR7KL4ox";
const doc = `| Claim | Proof |
| --- | --- |
| a | \`tests/a.test.ts\` TC-UM-001-01; fn \`a_function_name_here\`; \`${HASH}\` |
`;
const all = { exists: () => true, grep: () => true, records: () => true };

test("paths, test ids, function names and hashes are read from the table rows only", () => {
  const refs = referencesOf(doc + "\nText with \`tests/ignored.ts\` and TC-IGNORED-01 outside a table.\n");
  assert.deepEqual([...refs.paths], ["tests/a.test.ts"]);
  assert.deepEqual([...refs.ids], ["TC-UM-001-01"]);
  assert.deepEqual([...refs.fns], ["a_function_name_here"]);
  assert.deepEqual([...refs.hashes], [HASH]);
});

test("a claim whose references all resolve passes", () => {
  assert.deepEqual(checkClaims(doc, all).missing, []);
});

test("a missing path, test id, function or transaction record is reported by name", () => {
  const none = { exists: () => false, grep: () => false, records: () => false };
  const { missing } = checkClaims(doc, none);
  assert.equal(missing.length, 4);
  assert.ok(missing.some((m) => m.startsWith("path tests/a.test.ts")));
  assert.ok(missing.some((m) => m.includes("TC-UM-001-01")));
  assert.ok(missing.some((m) => m.includes("a_function_name_here")));
  assert.ok(missing.some((m) => m.includes(HASH)));
});
