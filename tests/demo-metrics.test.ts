import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const demo = readFileSync(new URL("../demo/sandbox.demo.ts", import.meta.url), "utf8");

describe("UM-034 metrik demo dari data epoch", () => {
  it("TC-UM-034-03 skrip tidak memuat angka keluaran tetap", () => {
    // Kalimat ringkasan dan semua angka metrik berasal dari respons /metrics dan DB indexer.
    expect(demo).toMatch(/\$\{metrics\.voucherCount\} pembayaran jadi \$\{metrics\.residualTransfers\}/);
    expect(demo).not.toMatch(/pembayaran jadi \d/);
    expect(demo).not.toMatch(/out\(`[^`]*:\s*\d+\s*`\)/);
  });

  it("TC-UM-034-01 blok metrik memuat semua angka yang diminta", () => {
    for (const label of ["pembayaran berbayar (voucher)", "transaksi kliring", "pembayaran residual", "cleared ratio", "penghematan transfer"]) {
      expect(demo, label).toContain(label);
    }
  });
});
