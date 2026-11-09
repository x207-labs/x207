# ERC-8004 read spike: what `join_evm` could read about a `0x` address (UM-156)

Status: a read-only spike, run on 2026-11-09 against the public Base Sepolia RPC `https://sepolia.base.org` (chain id 84532, block 56550418 at the last call). **No transaction was sent. Nothing was written to any chain. No part of the contract or the backend uses this yet**: `admit_member` and `join_evm` do not read ERC-8004. This page is the finding, not a feature.

Register on Base Sepolia, from the [official repository](https://github.com/erc-8004/erc-8004-contracts) README (read on 2026-11-09):

| Registry | Address |
| --- | --- |
| IdentityRegistry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

## What was read (calls made with `cast call`, read-only)

IdentityRegistry:

| Call | Result |
| --- | --- |
| `name()`, `symbol()` | `AgentIdentity`, `AGENT` |
| `getVersion()` | `2.0.0` |
| `supportsInterface(0x80ac58cd)` (ERC-721) | `true` |
| `ownerOf(10597)` | `0xDa0D668e69699A2F08076f8d2FC87331EBf26aDb` (the x207 registration of 2026-11-05, see [discovery.md](discovery.md)) |
| `tokenURI(10597)` | `https://raw.githubusercontent.com/x207-labs/x207/main/docs/erc8004/agent.json` |
| `getAgentWallet(10597)` | `0xDa0D668e69699A2F08076f8d2FC87331EBf26aDb` (the owner) |
| `balanceOf(0xDa0D…26aDb)` | `1` |
| `balanceOf(0x58cd3d4987ad29a7bafdb8cdb90bfbe995e680b7)` (the EVM agent of [evm-agents.md](evm-agents.md)) | `0` (not registered) |
| `ownerOf(1)`, `tokenURI(1)` | an account `0x21fd…e235` and an on-chain `data:` URI of a test registration ("Test Agent 004 (Image Test)") |
| `tokenOfOwnerByIndex(...)`, `totalSupply()` | revert: the registry is ERC-721 but **not enumerable** |

The `Registered(uint256 indexed agentId, string agentURI, address indexed owner)` log of block 54794990 (transaction `0x347fb05ab7325bb33c0e6144423ef46aa2fd42ff549b27aad0e545f19a72975d`) decodes to agent id `0x2965` = 10597 and the same owner and URI.

ReputationRegistry:

| Call | Result |
| --- | --- |
| `getVersion()` | `2.0.0` |
| `getIdentityRegistry()` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` (the registry above) |
| `getClients(10597)` | `[]` (no feedback given to the x207 agent) |
| `getSummary(10597, [], "", "")` | reverts with `clientAddresses required` |
| `getSummary(1, [0xDa0D…26aDb], "", "")` | count `0` |

The ABI names above were tried against the deployed contracts; they were not copied from a local ABI file, and a call that reverted is listed as reverted.

## What this means for `join_evm` / `admit_member`

- **Address to identity** works only one way cheaply: `balanceOf(address) > 0` says "this address owns at least one ERC-8004 identity token". Finding *which* agent id needs the `Registered` logs filtered by the `owner` topic (the registry is not enumerable), or a known `agentId` supplied by the joiner and checked with `ownerOf(agentId) == address`.
- **The owner is not necessarily the signing key.** `getAgentWallet(agentId)` is a separate field; for the x207 registration it equals the owner, which is why the check above is unambiguous. A `join_evm` caller would prove control of the `0x` key by its EIP-712 signature already; ERC-8004 would add only "this key registered an agent file".
- **Reputation is empty.** The x207 agent has no feedback clients, and `getSummary` needs the caller to name the clients it trusts. An admission rule cannot use "reputation above N" from this registry without choosing a client list first, and on testnet there is nobody to choose.
- **Cross-chain.** The contract is on NEAR; Base Sepolia cannot be read from a NEAR contract. Any use would be an off-chain read by the backend or the SDK, passed to the member's admission as data; it cannot be checked on chain without an oracle. That fits the UM-156 backlog row, which says off-chain only.

## What this does not show

- No registration of the `0x58cd…80b7` agent exists, so the "one registered `0x` address read and logged in an admission record" criterion of UM-156 is met only for the x207 registration key `0xDa0D…26aDb`, which is not a member of any circle. Nothing was written to an admission log.
- Nothing about mainnet was read (the mainnet registries are listed in the same README; not queried here).
- The public RPC and the registry may change; these values are from one session. Re-run the calls before quoting them.

## Reproduce

```bash
R=https://sepolia.base.org
ID=0x8004A818BFB912233c491871b3d84c89A494BD9e
REP=0x8004B663056A597Dffe9eCcC1965A193B7388713
cast call $ID "ownerOf(uint256)(address)" 10597 --rpc-url $R
cast call $ID "balanceOf(address)(uint256)" 0x58cd3d4987ad29a7bafdb8cdb90bfbe995e680b7 --rpc-url $R
cast call $REP "getClients(uint256)(address[])" 10597 --rpc-url $R
```
