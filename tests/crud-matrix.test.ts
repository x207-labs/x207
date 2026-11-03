// UM-020 dan UM-065: docs/crud-matrix.md cocok dengan semua panah proses <-> store di DFD Level 1 (vault, 33 panah) dan DFD Level 2 F8 (proses P9, 8 panah)
// dan uses the ADR-26 status names.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Panah proses-store DFD Level 1: [dari, ke]. Salinan dari `07 DFD/x207 - DFD Level 1.md`; ubah bersama diagramnya.
const LEVEL1: Array<[string, string]> = [
  ["P1", "D1"], ["P1", "D6"], ["D1", "P2"], ["P2", "D2"], ["P2", "D3"], ["D2", "P3"], ["P3", "D2"], ["P3", "D4"], ["P3", "D5"],
  ["D5", "P4"], ["P4", "D5"], ["P4", "D6"], ["P4", "D1"], ["P5", "D8"], ["P5", "D1"], ["P5", "D2"], ["D5", "P6"], ["D6", "P6"],
  ["P6", "D6"], ["P6", "D1"], ["P6", "D5"], ["P7", "D7"], ["P7", "D1"], ["D7", "P1"], ["D7", "P2"], ["D7", "P3"], ["D7", "P6"],
  ["D1", "P8"], ["D2", "P8"], ["D4", "P8"], ["D5", "P8"], ["P8", "D9"], ["D9", "P3"],
];

// DFD Level 2 F8 (`07 DFD/x207 - DFD Level 2 F8 Adaptor Aset Akses.md`): P9 dengan D2, D3, D5, D10, D11, ditambah P7 -> D10 yang dinyatakan catatan itu
// dengan kata-kata ("D10 hanya ditulis P7"). Arus P9 -> D2 dan D3 adalah hasil registrasi voucher (P2), bukan tulisan broker.
const F8: Array<[string, string]> = [
  ["P9", "D11"], ["D11", "P9"], ["D10", "P9"], ["D3", "P9"], ["P9", "D3"], ["P9", "D2"], ["D5", "P9"], ["P7", "D10"],
];
const ARROWS: Array<[string, string]> = [...LEVEL1, ...F8];
const STORES = 11;


const text = readFileSync(fileURLToPath(new URL("../docs/crud-matrix.md", import.meta.url)), "utf8");
const rows = text.split("\n").filter((l) => /^\| \*\*P\d/.test(l));
const matrix = new Map<string, string[][]>(
  rows.map((line) => {
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    const process = /^\*\*(P\d)/.exec(cells[0]!)![1]!;
    return [process, cells.slice(1).map((c) => c.split(/\s+/).filter(Boolean))];
  }),
);
const letters = (process: string, store: string): string[] => matrix.get(process)![Number(store.slice(1)) - 1]!;

describe("UM-020 matriks CRUD proses x store", () => {
  it("nine processes and eleven stores, only the letters C, R, U", () => {
    expect([...matrix.keys()]).toEqual(["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9"]);
    for (const [process, cells] of matrix) {
      expect(cells, process).toHaveLength(STORES);
      for (const cell of cells) for (const letter of cell) expect(["C", "R", "U"]).toContain(letter);
    }
  });

  it("every DFD arrow has a letter that fits its direction: to a store C or U, from a store R", () => {
    expect(LEVEL1).toHaveLength(33);
    expect(F8).toHaveLength(8);
    expect(ARROWS).toHaveLength(41);
    for (const [from, to] of ARROWS) {
      const [process, store, reads] = from.startsWith("P") ? [from, to, false] : [to, from, true];
      const found = letters(process, store);
      if (reads) expect(found, `${store} -> ${process}`).toContain("R");
      else expect(found.some((l) => l === "C" || l === "U"), `${process} -> ${store}`).toBe(true);
    }
  });

  it("every letter comes from an arrow: no cell without a basis", () => {
    for (const [process, cells] of matrix) {
      cells.forEach((found, i) => {
        const store = `D${i + 1}`;
        const reads = ARROWS.some(([from, to]) => from === store && to === process);
        const writes = ARROWS.some(([from, to]) => from === process && to === store);
        for (const letter of found) {
          if (letter === "R") expect(reads, `${process}/${store} R`).toBe(true);
          else expect(writes, `${process}/${store} ${letter}`).toBe(true);
        }
        if (reads) expect(found).toContain("R");
      });
    }
  });

  it("uses the ADR-26 status names", () => {
    for (const name of ["`pending`", "`active`", "`suspended`", "`exited`", "`due`", "`paid`", "`defaulted`", "`claimable`", "`claimed`"]) {
      expect(text, name).toContain(name);
    }
  });

  it("the named methods are in ABI 0.0.4", () => {
    const abi = JSON.parse(readFileSync(fileURLToPath(new URL("../sdk/packages/core/abi/x207-circle.abi.json", import.meta.url)), "utf8")) as { body: { functions: Array<{ name: string }> } };
    const names = new Set(abi.body.functions.map((f) => f.name));
    const mentioned = new Set([...text.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]!));
    for (const method of ["join", "ft_on_transfer", "register_cumulative", "register_voucher", "close_epoch", "submit_clearing", "commit_epoch", "claim", "finalize_epoch", "withdraw_stake", "set_params", "admit_member", "commit_bundle", "register_in_bundle", "post_intent", "get_params", "get_epoch", "get_pending_params", "member", "headroom"]) {
      expect(mentioned.has(method), `${method} disebut`).toBe(true);
      expect(names.has(method), `${method} in the ABI`).toBe(true);
    }
  });
});
