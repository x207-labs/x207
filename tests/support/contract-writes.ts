// UM-047: analisis statis sumber kontrak `x207-circle` (tanpa modul test): store D1..D8 mana yang ditulis tiap method ABI, termasuk lewat fungsi
// bantu yang dipanggilnya. Ini aproksimasi atas (nama fungsi tidak dibedakan per file), jadi hasilnya dipakai untuk mencocokkan matriks CRUD,
// bukan sebagai bukti keamanan.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../../contracts/x207-circle/src/", import.meta.url));
const ABI = fileURLToPath(new URL("../../sdk/packages/core/abi/x207-circle.abi.json", import.meta.url));

/** Field `X207Circle` dan penyimpanan kunci-nilai di `bundle.rs` -> store DFD. `epochs` memuat D4 (ringkasan), D6 (pool epoch) dan D7 (snapshot params). */
const WRITES: Array<{ stores: string[]; field: string }> = [
  { stores: ["D1"], field: "(?:members|member_index|member_count)" },
  { stores: ["D2"], field: "(?:outstanding_debt|totals)" },
  { stores: ["D2", "D3"], field: "pairs" },
  { stores: ["D4", "D6", "D7"], field: "epochs" },
  { stores: ["D4"], field: "proposals" },
  { stores: ["D5"], field: "positions" },
  { stores: ["D6"], field: "(?:total_stake|reserve|in_flight|epoch_pools|solver_fees_total|solver_fees)" },
  { stores: ["D7"], field: "pending_params" },
];
/**
 * Penyimpanan kunci-nilai di luar `X207Circle` (bundle.rs, grant.rs): dibuka lewat fungsi dan ditulis lewat variabel `let mut x = opener();` yang
 * kemudian dipakai `.insert`. Membaca saja (`opener().get(..)`) tidak dihitung.
 */
const KEYED: Array<{ stores: string[]; opener: string }> = [
  { stores: ["D8"], opener: "(?:intents|bundles)" },
  { stores: ["D8-reserve"], opener: "reserves" },
  { stores: ["D10"], opener: "asset_classes" },
  { stores: ["D11"], opener: "(?:grants|grants_by|grant_counts)" },
];
const MUTATE = "(?:insert|remove|push|set|get_mut|swap_remove|replace)\\s*\\(";

function stripTests(text: string): string {
  const cut = text.indexOf("#[cfg(test)]");
  return (cut >= 0 ? text.slice(0, cut) : text).replace(/\/\/.*$/gm, "");
}

function functionBodies(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of text.matchAll(/\bfn\s+([a-z_0-9]+)\s*[<(]/g)) {
    const open = text.indexOf("{", match.index);
    const semi = text.indexOf(";", match.index);
    if (open < 0 || (semi >= 0 && semi < open)) continue;
    let depth = 0;
    let i = open;
    for (; i < text.length; i += 1) {
      if (text[i] === "{") depth += 1;
      else if (text[i] === "}" && --depth === 0) break;
    }
    out.set(match[1]!, `${out.get(match[1]!) ?? ""}\n${text.slice(open, i + 1)}`);
  }
  return out;
}

export type ContractWrites = {
  /** Method ABI bertipe `call`. */
  methods: string[];
  /** Semua method ABI (call dan view). */
  abi: Set<string>;
  /** Store yang ditulis tiap method `call`, termasuk lewat fungsi bantu. */
  writes: Map<string, Set<string>>;
};

export function analyseContract(): ContractWrites {
  const bodies = new Map<string, string>();
  for (const file of readdirSync(SRC).filter((f) => f.endsWith(".rs"))) {
    for (const [name, body] of functionBodies(stripTests(readFileSync(SRC + file, "utf8")))) bodies.set(name, `${bodies.get(name) ?? ""}\n${body}`);
  }
  const direct = new Map<string, Set<string>>();
  const calls = new Map<string, Set<string>>();
  for (const [name, body] of bodies) {
    const stores = new Set<string>();
    for (const { stores: s, field } of WRITES) {
      if (new RegExp(`\\bself\\.${field}\\s*\\.\\s*${MUTATE}|\\bself\\.${field}\\s*(?:\\+=|-=|=(?!=))`).test(body)) s.forEach((x) => stores.add(x));
    }
    for (const { stores: s, opener } of KEYED) {
      for (const m of body.matchAll(new RegExp(`let\\s+mut\\s+(\\w+)\\s*=\\s*${opener}\\(\\)`, "g"))) {
        if (new RegExp(`\\b${m[1]}\\s*\\.\\s*${MUTATE}`).test(body)) s.forEach((x) => stores.add(x));
      }
    }
    direct.set(name, stores);
    // hanya `nama(` atau `self.nama(`; `x.nama(` adalah method tipe lain dan tidak diikuti
    calls.set(name, new Set([...body.matchAll(/(?:^|[^.\w])(?:self\.)?([a-z_0-9]+)\s*\(/g)].map((m) => m[1]!).filter((n) => bodies.has(n) && n !== name)));
  }
  const closure = (root: string): Set<string> => {
    const seen = new Set<string>();
    const out = new Set<string>();
    const walk = (name: string) => {
      if (seen.has(name)) return;
      seen.add(name);
      direct.get(name)?.forEach((s) => out.add(s));
      calls.get(name)?.forEach(walk);
    };
    walk(root);
    return out;
  };
  const abi = JSON.parse(readFileSync(ABI, "utf8")).body.functions as Array<{ name: string; kind: string }>;
  const methods = abi.filter((f) => f.kind === "call").map((f) => f.name);
  return { methods, abi: new Set(abi.map((f) => f.name)), writes: new Map(methods.map((m) => [m, closure(m)])) };
}
