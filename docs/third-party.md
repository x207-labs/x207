# Third-party libraries and services

All of them are open source and are used as libraries or as hosted endpoints; none of their code is copied into this repository. Moved from the README.

| Area | What is used |
| --- | --- |
| Contract | `near-sdk` 5.29.1, `near-workspaces` 0.23.0 (tests), `cargo-near` 0.22.0 (build) |
| x402 | `@x402/core`, `@x402/fetch`, `@x402/near` (2.29.0) |
| NEAR | `near-api-js`, `@near-js/crypto`, `@near-js/signers`, `@near-js/transactions`, `@hot-labs/near-connect` (wallet), the Sputnik DAO contract, NEAR Intents (`@defuse-protocol/intents-sdk`, `@defuse-protocol/one-click-sdk-typescript`) |
| Cryptography | `@noble/curves`, `@noble/hashes`, `@noble/ciphers` |
| Agents and tools | `@modelcontextprotocol/sdk` (MCP server), `zod`, `ajv` |
| Backend | `hono`, `@hono/node-server`, `better-sqlite3` |
| Frontend | `react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`, `vite` |
| Test and build | `vitest`, `typescript`, `@playwright/test`, `@testing-library/*`, `jsdom`, `axe-core`, `oxlint` |
| Hosted services | the public NEAR testnet RPC (fastnear), GitHub, Vercel (dashboard), Railway (read API) |
