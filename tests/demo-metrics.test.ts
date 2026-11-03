import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const demo = readFileSync(new URL("../demo/sandbox.demo.ts", import.meta.url), "utf8");

describe("UM-034 demo metrics from epoch data", () => {
  it("TC-UM-034-03 script contains no fixed output numbers", () => {
    // Kalimat ringkasan dan semua angka metrik berasal dari respons /metrics dan DB indexer.
    expect(demo).toMatch(/\$\{metrics\.voucherCount\} payments became \$\{metrics\.residualTransfers\}/);
    expect(demo).not.toMatch(/payments became \d/);
    expect(demo).not.toMatch(/out\(`[^`]*:\s*\d+\s*`\)/);
  });

  it("TC-UM-034-01 metrics block contains all requested numbers", () => {
    for (const label of ["paid payments (vouchers)", "clearing transactions", "residual payments", "cleared ratio", "transfer savings"]) {
      expect(demo, label).toContain(label);
    }
  });
});

describe("UM-033 402 response in the demo", () => {
  it("demo prints both accepts entries from the real 402 response", () => {
    expect(demo).toMatch(/402 accepts: \$\{required\.accepts\.map/);
    expect(demo).toContain("PAYMENT-REQUIRED");
  });
});
