// UM-085: the twelve kinds of the pipeline P5 are the same in the registry D10 (scripts/lib/asset-catalog.mjs), the presets of the SDK (createMeteredEndpoint), the table of
// the backend (BE-050) and the listing form of the frontend (FE-024); the README and docs/asset-catalog.md name them. Unit test, no sandbox.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { METERED_KINDS, METERED_PRESETS, METERED_UNITS } from "@x207/core";
import { CATALOG } from "../scripts/lib/asset-catalog.mjs";
import { KIND_LABEL, UNIT_LABEL } from "../frontend/src/lib/resourceForm.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("UM-085 metered resources: registry, presets, backend and frontend agree", () => {
  it("TC-UM-085-01 each kind is a class D entry of the registry with the same number and asset type, delivered by an x402 endpoint", () => {
    expect(METERED_KINDS).toHaveLength(12);
    for (const kind of METERED_KINDS) {
      const preset = METERED_PRESETS[kind];
      const entry = CATALOG.find((e: { no: number }) => e.no === preset.catalogNo);
      expect(entry, kind).toBeDefined();
      expect(entry).toMatchObject({ assetType: preset.assetType, cls: "D" });
      expect(entry.delivery).toContain("x402_endpoint");
    }
    expect(new Set(METERED_KINDS.map((k) => METERED_PRESETS[k].assetType)).size).toBe(12);
  });

  it("TC-UM-085-02 the table of the backend lists the same twelve asset types with the same catalog numbers, and the same units", async () => {
    const backend = (await import("../backend/src/marketplace/resource-listing.ts")) as typeof import("../backend/src/marketplace/resource-listing.ts");
    const fromSdk = Object.fromEntries(METERED_KINDS.map((k) => [METERED_PRESETS[k].assetType, METERED_PRESETS[k].catalogNo]));
    expect(backend.RESOURCE_ASSET_TYPES).toEqual(fromSdk);
    expect([...backend.RESOURCE_UNITS].sort()).toEqual([...METERED_UNITS].sort());
  });

  it("TC-UM-085-03 the listing form has a label and a unit text for every kind and unit, and the number in the label is the catalog number", () => {
    for (const kind of METERED_KINDS) expect(KIND_LABEL[kind], kind).toMatch(new RegExp(`^${METERED_PRESETS[kind].catalogNo} · `));
    for (const unit of METERED_UNITS) expect(UNIT_LABEL[unit], unit).toBeTruthy();
    expect(Object.keys(KIND_LABEL).sort()).toEqual([...METERED_KINDS].sort());
  });

  it("TC-UM-085-04 the demo-blocks block (it left the README in UM-102) and docs/asset-catalog.md name every kind, asset type and its first unit", () => {
    const readme = read("docs/demo-blocks.md"); // the block moved out of the README with the README diet (UM-102)
    const docs = read("docs/asset-catalog.md");
    expect(readme).toContain("### Metered resource block (pipeline P5, class D)");
    for (const kind of METERED_KINDS) {
      const preset = METERED_PRESETS[kind];
      expect(readme, kind).toContain(`\`${kind}\` (#${preset.catalogNo}) | \`${preset.assetType}\` | ${preset.units.join(", ")} |`);
      expect(docs, kind).toContain(`#${preset.catalogNo} \`${preset.assetType}\``);
    }
  });
});
