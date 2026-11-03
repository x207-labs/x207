// Global setup of the integration tests (security review 3, F2): the packages are imported through `dist/` (`main` in their package.json), so a `dist/` older
// than the source gives `undefined` imports for new exports. `tsc -b` is incremental: it does nothing when the output is current. A failed build stops the run.
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

export default function buildSdk(): void {
  const sdk = resolve(import.meta.dirname, "../../sdk");
  try {
    execFileSync("npx", ["tsc", "-b"], { cwd: sdk, stdio: "pipe" });
  } catch (error) {
    const out = error as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`sdk build (tsc -b) failed, the tests would run against an old dist/:\n${out.stdout?.toString() ?? ""}${out.stderr?.toString() ?? ""}`);
  }
}
