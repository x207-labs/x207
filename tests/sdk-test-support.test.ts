// F1 of security review 3: a stale mock_intents wasm fails with a clear message before it is deployed.
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertMockIntentsWasm } from "../sdk/test-support/circle.ts";
import { MOCK_INTENTS_WASM } from "../sdk/test-support/sandbox.ts";

// a wasm module that exports one function, "balance_of", and nothing else: enough to look like an old build
const OLD_WASM = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 7, 14, 1, 10, 98, 97, 108, 97, 110, 99, 101, 95, 111, 102, 0, 0, 10, 4, 1, 2, 0, 11]);

describe("test-support: mock_intents wasm check", () => {
  it("TC-SR3-10 a wasm without the methods the tests call is refused, naming them and the build command", () => {
    const path = join(mkdtempSync(join(tmpdir(), "sr3-")), "old.wasm");
    writeFileSync(path, OLD_WASM);
    expect(() => assertMockIntentsWasm(path)).toThrow(/no export: .*mt_transfer_call.*ft_withdraw[\s\S]*cargo near build/);
  });

  it("TC-SR3-11 a missing file is reported with the build command", () => {
    expect(() => assertMockIntentsWasm("/nonexistent/mock_intents.wasm")).toThrow(/cannot be read[\s\S]*cargo near build/);
  });

  it("TC-SR3-12 the wasm in contracts/target, when it exists, has every method", () => {
    if (!existsSync(MOCK_INTENTS_WASM)) return;
    expect(() => assertMockIntentsWasm()).not.toThrow();
  });
});
