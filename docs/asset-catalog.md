# Barter catalog in the registry D10 (UM-075)

Status: built and run in `near-sandbox`. Not run on testnet or mainnet: the owner of a circle there is a Sputnik DAO, which has no key, so each entry needs a DAO proposal (see "Owner" below).

The barter catalog of the design notes (90 kinds) is data in [scripts/lib/asset-catalog.mjs](../scripts/lib/asset-catalog.mjs). `scripts/register-asset-classes.mjs` writes it into the registry D10 of the circle contract with `set_asset_class` and then reads the registry back.

## What is registered
| Part | Rows | Class | Entries |
| --- | --- | --- | --- |
| A. on-chain assets | 1 to 14 | A | 14 |
| B. limited access that can be revoked | 15 to 25 | B | 11 |
| C. a single secret through the broker | 26 to 30 | C | 5 |
| D. own resources and services | 31 to 55 | D | 25 |
| E. debts and invoices | 56 to 60 | not an asset of the registry | left out |
| F. off-chain digital assets of ordinary people | 61 to 90 | 9 B, 11 C, 10 D | 30 |
| Refused | nine kinds | X | 9 |

94 entries in all: A 14, B 20, C 16, D 35, X 9. Row 14 of the note is "A/E" and is registered as A. The refused kinds are class `X`: `offer_grant` for them fails with `ERR_ASSET_CLASS_FORBIDDEN` (tested).

Each `asset_type` is `<provider>:<kind>` (`[a-z0-9._-]`, at most 64 bytes a part), for example `compute:gpu-hours`, `near-rpc:access`, `ticket:digital-event`. `near-rpc:access`, `nft:ticket`-style class A, and `proxy` keep the delivery method names that the tests and the broker already use (`near_access_key`, `escrow_nft`, `proxy`).

## Delivery methods and proofs
- The contract checks only that a delivery method is not empty and that `offer_grant` repeats one of them (`ERR_DELIVERY_NOT_ALLOWED`). The names are therefore a convention: class A `escrow_nft` (built), `escrow_ft` and `escrow_mt` (CT-090 and CT-092, not built: the registry can hold the name before the contract can deliver), `escrow_locker`; class B `near_access_key` and one name per kind of access; class C `proxy` or `secret_release`; class D `x402_endpoint` or the way the file or slot is handed over.
- A row marked "condition" in the note (lawful only when the provider or the law allows it) names the official channel as its delivery method: `platform_transfer`, `game_trade`, `carrier_transfer`, `program_transfer`. The registry has no field for the condition itself; the status text of the row in the script carries it, and the provider's terms apply.
- Accepted proofs are among `rpc_access_key`, `tee_attestation`, `zktls`: `rpc_access_key` for the NEAR key (B), `tee_attestation` for secrets (C), `zktls` for access at a provider (B) and a few data kinds (D), none for plain endpoints and for class A.
- **`terms_hash` is the sha256 of the catalog line** (`x207 asset class v1`, the `asset_type`, the class, the name). It identifies the entry; it is not a legal terms document. A provider replaces it by the hash of its own terms with another `set_asset_class` (the owner may write a known `asset_type` again).

## Run
```bash
# what would be written (needs no key)
node scripts/register-asset-classes.mjs --rpc-url <url> --contract x207-circle.test.near --dry-run
# write it, as the owner of the contract
OWNER_SECRET_KEY=ed25519:... node scripts/register-asset-classes.mjs --rpc-url <url> --contract x207-circle.test.near --owner dao.test.near
# the test: script, list_asset_classes in pages, second run writes nothing, offers of X, unknown and wrong-method are refused
X207_SANDBOX=1 npx vitest run tests/asset-catalog.sandbox.test.ts
node --test scripts/asset-catalog.test.mjs
```
The script prints one JSON line per transaction and a summary line; the exit code is 1 when an entry is missing or differs after the run. It is idempotent: an entry that the registry already holds, equal to the catalog, is not written again. The key is read from `OWNER_SECRET_KEY` only and is never printed.

## Owner
On testnet and mainnet the contract is owned by a Sputnik DAO (ADR-13, ADR-20). `set_asset_class` is owner only, so there the 94 calls are DAO proposals, which `dao/` in `contracts` can build one by one; this script does not make them. A rehearsal circle whose owner holds a key (the sandbox) is the case it serves. Storage of 94 entries is paid by the balance of the circle account; the size was not measured.

## Limits
- The catalog is a list of examples. A third-party product named in a row was not checked one by one (the note says so too).
- Rows with status "roadmap" are registered so that a listing can name them; most of them have no adapter that delivers the asset yet. The built ones are class A with NFTs, class B with the NEAR key, class C with the mock provider and class D endpoints.
- Delivery of the F rows is off-chain and cannot be atomic like an escrow; the dispute window and confirmation of the receiver (BE-047, CT-093) are not built.

## Metered resources (P5, UM-085)
The twelve kinds of pipeline P5 are class D rows of the catalog, delivery `x402_endpoint`: #31 `compute:cpu-idle`, #32 `compute:gpu-hours`, #33 `storage:capacity`, #34 `cdn:static-cache`, #35 `model:inference`, #36 `model:fine-tuning`, #44 `oracle:data-feed`, #45 `iot:sensor-data`, #47 `gas:relayer`, #49 `queue:priority-slot`, #55 `network:proxy-bandwidth`, #90 `compute:home-device`. The presets of `createMeteredEndpoint` (`METERED_PRESETS` in `@x207/core`), the table of the backend (`RESOURCE_ASSET_TYPES`, BE-050) and the listing form of the frontend (FE-024) use these names and numbers; `tests/metered-catalog.test.ts` compares them. The units (`call`, `minute`, `day`, `GB`, `job`, `request`) are not the `UNITS` of the contract: class D does not go through a grant.
