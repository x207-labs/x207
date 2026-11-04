# Mainnet deploy of x207-circle v0.0.13: command reference (CT-049, preparation)

This is the command reference of the contract steps. The order of all steps, the money and the gas are in [mainnet-runbook.md](mainnet-runbook.md); the numbers are kept there only.

Status: **prepared, not run.** No mainnet transaction was sent from this repository and no mainnet key exists in it. Every command below reads only, except the two marked **SIGNS**, which the owner runs after reading them. The testnet keys are never used on mainnet.

The scripts never sign by default. `deploy-mainnet.mjs` sends only with `--execute`, and on mainnet only with `--execute --yes-owner-approved`. `print-class-proposals.mjs` and `contracts/dao/*.mjs` (including `mainnet-set-params.mjs`) only print commands. Stop at the first line that is not as written.

## The release
Tag `v0.0.13` of `x207-labs/contracts`; its sha256, `code_hash` and size are in section 0 of [mainnet-runbook.md](mainnet-runbook.md). The sha256 is pinned in `scripts/deploy-mainnet.mjs` (`KNOWN_SHA256`): the script stops before signing if the downloaded wasm differs from it, and also if it differs from `SHA256SUMS` of the release.

## Step 0: how much NEAR each account needs (reads nothing from the network)
```bash
node scripts/mainnet-costs.mjs --wasm x207-circle-v0.0.13.wasm
```
Prints the minimum and the recommended balance of the circle, the keeper, the solver and each agent; the whole table (with the DAO, the relayer, the council and the USDT) is in section 2 of the runbook. The keeper and the solver refuse to sign below the gas reserve of their call (SV-020).

## Step 1: the DAO (**SIGNS**, owner)
```bash
node contracts/dao/create-dao.mjs --name x207 --council a.near,b.near,c.near --signer owner.near --network mainnet
```
Prints one command. The owner reads it and runs it.

## Step 2: check the release and the chain (reads only)
```bash
node scripts/deploy-mainnet.mjs --network mainnet --circle <circle>.near --owner <dao>.sputnik-dao.near --release v0.0.13 --out docs/mainnet-dry-run.json
```
Downloads the wasm with `gh release download v0.0.13 -R x207-labs/contracts`, checks the sha256 against the pinned number and `SHA256SUMS`, and by views checks: the owner is a Sputnik DAO, `usdt.tether-token.near` has 6 decimals, `intents.near` has code, the circle account exists with at least 8 NEAR and holds no other code. Prints the arguments of `new` and the costs. Exit 1 with `STOP` if anything is wrong. This is the default; it signs nothing and reads no key.

## Step 3: deploy and `new` (**SIGNS**, owner)
```bash
node scripts/deploy-mainnet.mjs --network mainnet --circle <circle>.near --owner <dao>.sputnik-dao.near --release v0.0.13 \
     --keys-dir <owner keys folder with a mainnet/ subfolder> --out docs/mainnet-deploy.json --execute --yes-owner-approved
```
Reads `<keys-dir>/mainnet/<circle>.json`, deploys, calls `new` with the DAO as `owner_id`, then checks on chain that `code_hash` is `DTw5rUUdJSbWjD361MmBxKW4nm4ETnNkex63mfUCjsjh`, `interface_version` is `0.0.13` and `get_owner` is the DAO. Refuses a keys folder whose path says `testnet`. Exit 1 if one check differs: do not use that contract.

## Step 4: verify the deployed code against the release (reads only)
```bash
contracts/scripts/verify-release.sh v0.0.13 <circle>.near https://rpc.mainnet.fastnear.com
```

## Step 5: register the asset classes (DAO proposals, reads and prints only)
```bash
node scripts/print-class-proposals.mjs --network mainnet --dao <dao>.sputnik-dao.near --contract <circle>.near --signer <council member>.near \
     --rpc-url https://rpc.mainnet.fastnear.com > class-proposals.sh
```
Prints one `near contract call-function ... add_proposal` command for each class of the catalog that the circle does not yet hold with the same content (`--only <asset_type,...>` for a few, `--count` for the number). **SIGNS** only when the owner or a council member runs lines of `class-proposals.sh`; the council then votes (`contracts/dao/vote-proposal.mjs`). Check afterwards with `list_asset_classes`.

## Step 6: keeper and solver
Fund the two accounts as in the runbook. The keeper (`scripts/keeper.mjs`) and the solver (`SUBMIT_GAS_TGAS` default 60) check their balance against the gas reserve before they sign and print a clear message when it is short.

## Step 7: the `set_params` proposal (reads and prints only)
```bash
node contracts/dao/mainnet-set-params.mjs --dao <dao>.sputnik-dao.near --contract <circle>.near --signer <member>.near --params-file params.json
```
Reads the owner, the params and the DAO policy, shows what changes, and prints the `add_proposal`, the vote and the reads. It has no sending mode. The owner runs the printed `add_proposal` (**SIGNS**).

## Rehearsal done
See section 8 of [mainnet-runbook.md](mainnet-runbook.md).

Rollback and who-signs-what are in sections 5 and 6 of the runbook.
