// UM-047: docs/crud-matrix.md matches the implementation. Every C or U cell with a contract method must be written by that method (static analysis of the
// contract source, tests/support/contract-writes.ts), every method and event name in a cell must exist in the 0.0.4 ABI or the event schema, and every D9 cell must
// have an indexer handler. Decided differences are in DECIDED below, with their reasons.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyseContract } from "./support/contract-writes.ts";

const root = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const doc = readFileSync(root("docs/crud-matrix.md"), "utf8");
const events = readFileSync(root("sdk/packages/core/src/events.ts"), "utf8");
const contract = analyseContract();

// Rows of the "What each cell means" table: `| P1 / D1 | operation | method or event | status |`.
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

// Decided differences between the matrix and the contract source: cell -> reason.
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
    // names that are not contract methods or events: indexer handlers, status views, table terms
    const outside = unknown.filter((u) => !/ (epoch_cutoff|settle)$/.test(u)); // `settle` is a value of `action` in the `msg` of ft_on_transfer
    expect(outside, "names in the matrix that are not in the ABI or events").toEqual([]);
  });

  it("every C or U cell that names a contract method is written by that method or a function it calls", () => {
    const missing: string[] = [];
    for (const cell of cells) {
      for (const store of cell.stores) {
        const l = letters(cell.process, store);
        if (!l.some((x) => x === "C" || x === "U") || store === "D9") continue;
        const callMethods = cell.methods.filter(isCall);
        if (callMethods.length === 0) continue; // cell that only mentions a view or an event
        const key = `${cell.process}/${store}`;
        const wrote = callMethods.some((m) => {
          const stores = contract.writes.get(m)!;
          // `epochs` holds D4, D6 and D7: D7 only counts when that method is close_epoch or set_params
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
    // methods that manage the contract itself (upgrade, migration) or only close a callback have no cell of their own
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
    // P9 only reads D10 and D5; D2 and D3 are written through voucher registration, not by F8 methods
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
