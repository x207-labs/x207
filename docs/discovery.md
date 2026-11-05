# Discovery: x402 Bazaar and ERC-8004 (UM-187, testnet only)

Status on 2026-11-05: **one ERC-8004 identity is registered on Base Sepolia (agent id 10597); nothing is listed in the Bazaar.** This page says what was done, what was read, and what would have to be true before a Bazaar listing shows up. No mainnet transaction is planned.

## x402 Bazaar

What the Bazaar documents say ([docs.x402.org/extensions/bazaar](https://docs.x402.org/extensions/bazaar), [specs/extensions/bazaar.md](https://github.com/x402-foundation/x402/blob/main/specs/extensions/bazaar.md), read on 2026-11-05):

- Listing is not a separate registration. A seller declares the `bazaar` extension in its `402` answer; a facilitator that processes a payment whose payload echoes the extension may catalog the resource. Whether it does, and how it stores it, is up to the facilitator. Listing is free.
- The documents do not name which facilitators index, and do not require a Coinbase CDP account. The listed networks are Base, Base Sepolia, Solana and Solana devnet with USDC.
- Nothing in the documents says that a facilitator indexes a custom scheme such as `batch-settlement` on `x207:agents-main`: it would have to verify and settle that scheme first. The x207 reference facilitator does not index anything.

What is built (sdk, `examples/seller`, test `TC-UM-187-01`): the seller example puts `extensions.bazaar` in the `402` (header and JSON body), made by `declareDiscoveryExtension` of `@x402/extensions` with `method: "GET"` and an example output. The option is `extensions` on a route of `x207Middleware`. The example seller can also add an `exact` entry on Base Sepolia that the public testnet facilitator settles (`baseSepolia` option, SD-093); that entry is the only one a Bazaar index could plausibly pick up. We have not tested whether the public testnet facilitator indexes it, and nobody has paid the example seller.

So: **the Bazaar listing needs a facilitator that indexes it, and it will not appear in the public Bazaar by itself.**

## ERC-8004 on Base Sepolia

ERC-8004 (Trustless Agents, [eips.ethereum.org/EIPS/eip-8004](https://eips.ethereum.org/EIPS/eip-8004)) gives an agent an ERC-721 identity whose token URI points at a registration file.

- Chain: Base Sepolia, chain id 84532. Identity Registry `0x8004A818BFB912233c491871b3d84c89A494BD9e` (from [erc-8004/erc-8004-contracts](https://github.com/erc-8004/erc-8004-contracts); on 2026-11-05 the address has contract code on `sepolia.base.org` and `name()` returns `AgentIdentity`). Not checked on an explorer (it refused the request).
- Call: `register(string agentURI) returns (uint256 agentId)`; the event is `Registered(uint256 indexed agentId, string agentURI, address indexed owner)`.
- Registration file: [`docs/erc8004/agent.json`](erc8004/agent.json), to be served from `https://raw.githubusercontent.com/x207-labs/x207/main/docs/erc8004/agent.json` once pushed. It names the MCP server and the read API, sets `x402Support` to `false` (none of the listed endpoints returns a `402`), says testnet and mock USDT, and has `registrations: []` until an `agentId` exists.
- Cost, from `eth_estimateGas` on 2026-11-05 (read-only, nothing sent): 203,545 gas; at the gas price of that day (about 0.009 gwei) that is about 0.0000019 ETH of Base Sepolia, and about 0.00002 ETH if the price were ten times higher. The registering key is a new key that holds no other asset; it is kept in `.secrets/` and is not part of any repository.
- Done on 2026-11-05: `register(agentURI)` with that URL, transaction [`0x347fb05ab7325bb33c0e6144423ef46aa2fd42ff549b27aad0e545f19a72975d`](https://sepolia.basescan.org/tx/0x347fb05ab7325bb33c0e6144423ef46aa2fd42ff549b27aad0e545f19a72975d) in block 54794990, status success, 200,784 gas used (the estimate was 203,545). The event `Registered` gives `agentId` 10597 and owner `0xDa0D668e69699A2F08076f8d2FC87331EBf26aDb`, the new key that holds no other asset. The `registrations` entry of the file names that id and registry; it is in the repository but the raw GitHub copy has it only after the next push.

## What is not claimed

No user, no third-party seller, no listing, no reputation. An ERC-8004 identity says that an address registered a file; it does not say that the agent is good or that the endpoints in the file work for anybody else.
