#!/usr/bin/env node
// CT-049: prints the NEAR each account of a deployment needs. Reads a wasm file for its size (or --wasm-bytes). No network, no key.
//   node scripts/mainnet-costs.mjs --wasm x207-circle-v0.0.13.wasm [--epochs 20] [--edges 210] [--members 6]
import { statSync } from "node:fs";
import { estimateCosts } from "./lib/costs.mjs";

const a = Object.fromEntries(process.argv.slice(2).reduce((acc, x, i, all) => (x.startsWith("--") ? [...acc, [x.slice(2), all[i + 1]]] : acc), []));
const wasmBytes = a["wasm-bytes"] ? Number(a["wasm-bytes"]) : a.wasm ? statSync(a.wasm).size : 682707; // 682707 = release v0.0.13
const r = estimateCosts({ wasmBytes, epochs: Number(a.epochs ?? 20), edgesPerEpoch: Number(a.edges ?? 210), members: Number(a.members ?? 6) });
console.log("account       minimum  recommended  basis");
for (const x of r.rows) console.log(`${x.account.padEnd(13)} ${String(x.minimum).padStart(7)} ${String(x.recommended).padStart(12)}  ${x.basis}\n              ${x.note}`);
console.log(`total recommended (NEAR): ${r.total}; one epoch of ${r.epochBurn.edgesPerEpoch} edges burns about ${r.epochBurn.wholeEpoch} NEAR in all (gas-and-cost.md)`);
