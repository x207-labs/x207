// UM-047: static analysis of the `x207-circle` contract source (without the test module): which D1..D8 stores each ABI method writes, including through the
// helper functions it calls. This is an approximation (function names are not told apart per file), so the result is used to match the CRUD matrix,
// not as security evidence.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../../contracts/x207-circle/src/", import.meta.url));
const ABI = fileURLToPath(new URL("../../sdk/packages/core/abi/x207-circle.abi.json", import.meta.url));

/** Fields of `X207Circle` and the key-value storage in `bundle.rs` -> DFD store. `epochs` holds D4 (summary), D6 (epoch pool) and D7 (params snapshot). */
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
 * Key-value storage outside `X207Circle` (bundle.rs, grant.rs): opened through a function and written through a variable `let mut x = opener();` that
 * is then used with `.insert`. Reads only (`opener().get(..)`) do not count.
 */
const KEYED: Array<{ stores: string[]; opener: string }> = [
  { stores: ["D8"], opener: "(?:intents|bundles)" },
  { stores: ["D8-reserve"], opener: "reserves" },
  { stores: ["D10"], opener: "asset_classes" },
  { stores: ["D11"], opener: "(?:grants|grants_by|grant_counts)" },
];
const MUTATE = "(?:insert|remove|push|set|get_mut|swap_remove|replace)\\s*\\(";

/**
 * Removes the items that carry `#[cfg(test)]` (a `mod tests` block, a test-only function, a test-only `use`) and the line comments, and keeps all
 * the rest of the file. Cutting at the first `#[cfg(test)]` would silently drop every function that comes after a test-only item in the middle.
 */
export function stripTests(text: string): string {
  let out = "";
  let i = 0;
  const attribute = /#\[cfg\(test\)\]/g;
  for (;;) {
    attribute.lastIndex = i;
    const found = attribute.exec(text);
    if (!found) break;
    out += text.slice(i, found.index);
    // the item starts after the attribute (and any further attributes); it ends at the matching `}` of its first `{`, or at a `;` that comes first
    let j = found.index + found[0].length;
    for (;;) {
      const open = text.indexOf("{", j);
      const semi = text.indexOf(";", j);
      if (open < 0 && semi < 0) {
        j = text.length;
        break;
      }
      if (semi >= 0 && (open < 0 || semi < open)) {
        j = semi + 1;
        break;
      }
      let depth = 0;
      let k = open;
      for (; k < text.length; k += 1) {
        if (text[k] === "{") depth += 1;
        else if (text[k] === "}" && --depth === 0) break;
      }
      j = k + 1;
      break;
    }
    i = j;
  }
  out += text.slice(i);
  return out.replace(/\/\/.*$/gm, "");
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
  /** ABI methods of type `call`. */
  methods: string[];
  /** All ABI methods (call and view). */
  abi: Set<string>;
  /** Stores written by each `call` method, including through helper functions. */
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
      // `\s*` around the dots: rustfmt splits a long chain over lines (`self\n.members\n.get_mut(..)`), as in `admit_member`
      if (new RegExp(`\\bself\\s*\\.\\s*${field}\\s*\\.\\s*${MUTATE}|\\bself\\s*\\.\\s*${field}\\s*(?:\\+=|-=|=(?!=))`).test(body)) s.forEach((x) => stores.add(x));
    }
    for (const { stores: s, opener } of KEYED) {
      for (const m of body.matchAll(new RegExp(`let\\s+mut\\s+(\\w+)\\s*=\\s*${opener}\\(\\)`, "g"))) {
        if (new RegExp(`\\b${m[1]}\\s*\\.\\s*${MUTATE}`).test(body)) s.forEach((x) => stores.add(x));
      }
    }
    direct.set(name, stores);
    // only `name(` or `self.name(`; `x.name(` is a method of another type and is not followed
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
