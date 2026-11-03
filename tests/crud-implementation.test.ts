// UM-047: docs/crud-matrix.md cocok dengan implementasi. Tiap sel C atau U dengan method kontrak harus ditulis oleh method itu (analisis statis
// sumber kontrak, tests/support/contract-writes.ts), tiap nama method dan event di sel harus ada di ABI 0.0.4 atau skema event, dan sel D9 harus
// punya handler indexer. Selisih yang diputuskan ada di DECIDED di bawah, dengan alasannya.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyseContract } from "./support/contract-writes.ts";

const root = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const doc = readFileSync(root("docs/crud-matrix.md"), "utf8");
const events = readFileSync(root("sdk/packages/core/src/events.ts"), "utf8");
const contract = analyseContract();

// Baris tabel "What each cell means": `| P1 / D1 | operasi | method atau event | status |`.
type Cell = { process: string; stores: string[]; methods: string[] };
const cells: Cell[] = doc
  .split("\n")
  .filter((l) => /^\| P\d \/ D\d/.test(l))
  .map((line) => {
    const cols = line.split("|").slice(1, -1).map((c) => c.trim());
    const [process, rest] = cols[0]!.split(" / ") as [string, string];
    return { process, stores: rest.split(",").map((s) => s.trim()), methods: [...cols[2]!.matchAll(/`([a-z_0-9]+)`/g)].map((m) => m[1]!) };
  });
const matrixRows = doc.split("\n").filter((l) => /^\| \*\*P\d/.test(l));
const letters = (process: string, store: string): string[] => {
  const row = matrixRows.find((l) => l.startsWith(`| **${process} `))!;
  return row.split("|").slice(2, -1)[Number(store.slice(1)) - 1]!.trim().split(/\s+/).filter(Boolean);
};

// Selisih antara matriks dan sumber kontrak yang sudah diputuskan: sel -> alasan.
const DECIDED: Record<string, string> = {
  "P5/D1": "The bundle headroom reservation is kept in a separate key-value store (`reserves()` in bundle.rs), not in the Member row; `headroom` subtracts it. The cell stays U because the limit the member reads changes, but the write is not to D1.",
  "P3/D9": "D9 is written by the indexer in the backend, not the contract; an R cell means the solver reads a snapshot from the read API.",
};

const isCall = (name: string) => contract.methods.includes(name);
const knownName = (name: string) => contract.abi.has(name) || new RegExp(`\\b${name}\\b`).test(events);

describe("UM-047 the CRUD matrix matches the implementation", () => {
  it("there is an explanation row for every C or U cell, and every name in it is known (ABI 0.0.4 or the event schema)", () => {
    expect(cells.length).toBeGreaterThanOrEqual(20);
    const unknown: string[] = [];
    for (const cell of cells) for (const name of cell.methods) if (!knownName(name) && !["near", "intents"].includes(name)) unknown.push(`${cell.process}/${cell.stores[0]}: ${name}`);
    // nama yang bukan method atau event kontrak: handler indexer, view status, istilah tabel
    const outside = unknown.filter((u) => !/ (epoch_cutoff|settle)$/.test(u)); // `settle` adalah nilai `action` di `msg` ft_on_transfer
    expect(outside, "names in the matrix that are not in the ABI or events").toEqual([]);
  });

  it("every C or U cell that names a contract method is written by that method or a function it calls", () => {
    const missing: string[] = [];
    for (const cell of cells) {
      for (const store of cell.stores) {
        const l = letters(cell.process, store);
        if (!l.some((x) => x === "C" || x === "U") || store === "D9") continue;
        const callMethods = cell.methods.filter(isCall);
        if (callMethods.length === 0) continue; // sel yang hanya menyebut view atau event
        const key = `${cell.process}/${store}`;
        const wrote = callMethods.some((m) => {
          const stores = contract.writes.get(m)!;
          // `epochs` memuat D4, D6 dan D7: D7 hanya dihitung bila method itu close_epoch atau set_params
          if (store === "D7") return m === "set_params" || m === "close_epoch";
          return stores.has(store);
        });
        if (!wrote && !(key in DECIDED)) missing.push(`${key}: ${callMethods.join(", ")}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("the D9 cell is written by the indexer: there is an events_raw table and a handler for contract events", () => {
    expect(existsSync(root("backend/src/indexer/handlers"))).toBe(true);
    expect(readdirSync(root("backend/src/indexer/handlers")).length).toBeGreaterThan(3);
    expect(readFileSync(root("backend/src/db/migrations.ts"), "utf8")).toContain("CREATE TABLE events_raw");
    expect(letters("P8", "D9")).toContain("C");
  });

  it("a contract method that writes a store without a cell in the matrix is recorded: every D1..D8 write has a cell that names that method", () => {
    const named = new Map<string, Set<string>>();
    for (const cell of cells) for (const m of cell.methods) for (const s of cell.stores) (named.get(m) ?? named.set(m, new Set()).get(m)!).add(s);
    const undocumented: string[] = [];
    // method yang mengelola kontrak sendiri (upgrade, migrasi) atau hanya menutup callback tidak punya sel sendiri
    const skip = new Set(["apply_upgrade", "propose_upgrade", "migrate", "new", "claim_solver_fee", "on_claim_resolved", "on_withdraw_resolved", "on_solver_fee_resolved", "admit_member"]);
    for (const [method, stores] of contract.writes) {
      if (skip.has(method)) continue;
      if (!named.has(method)) {
        if (stores.size > 0) undocumented.push(`${method} (writes ${[...stores].join(", ")}) is not named in any cell`);
      }
    }
    expect(undocumented).toEqual([]);
  });

  it("UM-065 row P9: cells D10 and D11 name the F8 method that writes them, and P7 writes D10", () => {
    const methodsOf = (process: string, store: string) => cells.find((c) => c.process === process && c.stores.includes(store))?.methods ?? [];
    expect(methodsOf("P9", "D11")).toEqual(expect.arrayContaining(["offer_grant", "accept_grant", "revoke_grant"]));
    for (const method of ["offer_grant", "accept_grant", "revoke_grant"]) expect([...contract.writes.get(method)!], method).toContain("D11");
    expect(methodsOf("P7", "D10")).toContain("set_asset_class");
    expect([...contract.writes.get("set_asset_class")!]).toEqual(["D10"]);
    // P9 hanya membaca D10 dan D5; D2 dan D3 ditulis lewat registrasi voucher, bukan oleh method F8
    expect(letters("P9", "D10")).toEqual(["R"]);
    expect(letters("P9", "D5")).toEqual(["R"]);
    expect(letters("P9", "D11")).toEqual(["C", "R", "U"]);
    for (const method of ["offer_grant", "accept_grant", "revoke_grant", "set_asset_class"]) {
      expect([...contract.writes.get(method)!].filter((st) => st === "D2" || st === "D3"), method).toEqual([]);
    }
  });

  it("DECIDED contains only cells that exist in the matrix", () => {
    for (const key of Object.keys(DECIDED)) {
      const [process, store] = key.split("/") as [string, string];
      expect(letters(process, store).length, key).toBeGreaterThan(0);
    }
  });
});
