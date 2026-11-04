# Mainnet deploy of x207-circle v0.0.13 (CT-049, preparation)

Status: **prepared, not run.** No mainnet transaction was sent from this repository and no mainnet key exists in it. Every command below reads only, except the two marked **SIGNS**, which the owner runs after reading them. The testnet keys are never used on mainnet.

The scripts never sign by default. `deploy-mainnet.mjs` sends only with `--execute`, and on mainnet only with `--execute --yes-owner-approved`. `print-class-proposals.mjs` and `contracts/dao/*.mjs` only print commands. Stop at the first line that is not as written.

## The release

| | |
| --- | --- |
| Tag | `v0.0.13` of `x207-labs/contracts` (interface 0.0.13) |
| sha256 | `b9327f2b5d64b1180ba76dd619c6091ae57b48964f520a784e366c131e787054` |
| `code_hash` (base58) | `DTw5rUUdJSbWjD361MmBxKW4nm4ETnNkex63mfUCjsjh` |
| Size | 682,707 bytes |

The sha256 is pinned in `scripts/deploy-mainnet.mjs` (`KNOWN_SHA256`). The script stops before signing if the downloaded wasm differs from it, and also if it differs from `SHA256SUMS` of the release.

## Step 0: how much NEAR each account needs (reads nothing from the network)
```bash
node scripts/mainnet-costs.mjs --wasm x207-circle-v0.0.13.wasm
```

| Account | Minimum | Recommended | Why |
| --- | --- | --- | --- |
| Circle contract | 6.93 | 8.2 | 6.83 NEAR of storage locked by the code, plus state; the deploy script refuses an account below 8 NEAR |
| Keeper | 0.17 | 0.41 | `commit_epoch` reserves 0.151 NEAR (150 Tgas); the keeper refuses to sign below the reserve |
| Solver | 0.08 | 0.18 | `submit_clearing` reserves 0.061 NEAR (60 Tgas) |
| Each agent | 0.4 | 0.5 | join deposit 0.35 NEAR, not returned |
| Owner, to create the DAO | 7.2 | 7.5 | factory deposit 7 NEAR |
| Council member, per proposal | 0.1 bond | 0.2 | Sputnik bond, returned when the proposal passes; the full catalog is 92 proposals, so 9.2 NEAR of bonds are out at once unless the council adds them in batches |

Why a reserve and not the burn: a transaction reserves about 0.001 NEAR per Tgas of prepaid gas and returns what it does not burn (`contracts/docs/gas-and-cost.md`, section 3). One epoch of 210 edges burns about 0.1075 NEAR in all. These figures were measured on testnet (gas price 1e8); mainnet gas price may differ, and the keeper and solver read it before they sign.

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
Fund the two accounts as in step 0. The keeper (`scripts/keeper.mjs`) and the solver (`SUBMIT_GAS_TGAS` default 60) check their balance against the gas reserve before they sign and print a clear message when it is short.

## Rehearsal done
Step 2 was run against testnet with the 0.0.13 wasm (`x207-v013.testnet`, owner DAO `x207v8.sputnikv2.testnet`): every check passed, `alreadyDeployed: true`, nothing signed. A wrong `--expect-sha256` stops with `refused: sha256 of the wasm is … but the pinned number is …`, and `--yes-owner-approved` without `--execute` is refused. The 92 class proposals were counted against that circle (`--count`: 92 to add, 2 already registered). Tests: `node --test scripts/deploy-mainnet.test.mjs` (9 pass).

Rollback and who-signs-what are in [mainnet-checklist.md](mainnet-checklist.md) sections 3 and 4 (written for 0.0.12; the rules there hold for 0.0.13).
