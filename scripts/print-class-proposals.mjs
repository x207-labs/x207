#!/usr/bin/env node
// CT-049: prints one `near-cli-rs` command per asset class of the catalog, each adding a Sputnik DAO proposal that calls `set_asset_class` on the circle
// (the owner of the circle is the DAO, so there is no other way). It NEVER signs or sends: the owner reads the commands and runs them, and the council votes.
// With --rpc-url and --contract it reads `list_asset_classes` first and leaves out the classes that are already registered with the same content.
//
//   node scripts/print-class-proposals.mjs --network mainnet --dao <dao>.sputnik-dao.near --contract <circle>.near --signer <council member>.near \
//        [--rpc-url <url>] [--only near-rpc:access,nft:nep171] [--count]
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG, toArgs } from "./lib/asset-catalog.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dao = await import(resolve(here, "../contracts/dao/lib.mjs"));

export function sameEntry(a, b) {
  return a && b && a.asset_type === b.asset_type && a.class === b.class && a.terms_hash === b.terms_hash &&
    JSON.stringify(a.delivery_methods) === JSON.stringify(b.delivery_methods) && JSON.stringify(a.accepted_proofs) === JSON.stringify(b.accepted_proofs);
}

/** The commands for `entries` (default: the whole catalog), skipping those in `existing` (a Map asset_type -> entry). */
export function commandsFor({ network, dao: daoId, contract, signer, existing = new Map(), only = null, catalog = CATALOG }) {
  const out = [];
  for (const entry of catalog) {
    if (only && !only.includes(entry.assetType)) continue;
    const { entry: body } = toArgs(entry);
    if (sameEntry(existing.get(entry.assetType), body)) continue;
    const addProposalArgs = dao.buildAssetClassProposalArgs({
      contract, assetType: body.asset_type, assetClass: body.class, deliveryMethods: body.delivery_methods, acceptedProofs: body.accepted_proofs, termsHash: body.terms_hash,
    });
    out.push({ assetType: entry.assetType, class: body.class, command: dao.addProposalCommand({ dao: daoId, signer, network, addProposalArgs }) });
  }
  return out;
}

async function main() {
  const a = Object.fromEntries(process.argv.slice(2).reduce((acc, x, i, all) => (x.startsWith("--") ? [...acc, [x.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? true : all[i + 1]]] : acc), []));
  for (const k of ["network", "dao", "contract", "signer"]) if (typeof a[k] !== "string") throw new Error(`missing --${k}`);
  if (!["testnet", "mainnet"].includes(a.network)) throw new Error("--network must be testnet or mainnet");
  const existing = new Map();
  if (typeof a["rpc-url"] === "string") {
    const { JsonRpcProvider } = createRequire(resolve(here, "../sdk/package.json"))("near-api-js");
    const provider = new JsonRpcProvider({ url: a["rpc-url"] });
    for (let from = 0; ; from += 50) {
      const page = (await provider.callFunction({ contractId: a.contract, method: "list_asset_classes", args: { from_index: from, limit: 50 } })) ?? [];
      for (const e of page) existing.set(e.asset_type, e);
      if (page.length < 50) break;
    }
  }
  const only = typeof a.only === "string" ? a.only.split(",") : null;
  const list = commandsFor({ network: a.network, dao: a.dao, contract: a.contract, signer: a.signer, existing, only });
  if (a.network === "mainnet") console.error("MAINNET: this script never sends anything. Read each command and run it yourself.");
  console.error(`${list.length} proposal(s) to add, ${existing.size} class(es) already registered`);
  if (a.count) return;
  for (const c of list) console.log(`# ${c.assetType} (class ${c.class})\n${c.command}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(`error: ${e.message}`);
    process.exit(1);
  });
}
