<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/x207-logo-dark.svg">
    <img src="brand/x207-logo-light.svg" alt="x207" height="48">
  </picture>
</p>

# x207

x402 lets agents pay. x207 lets many agents settle at once.

x207 is a mutual credit settlement layer for x402 agent payments on NEAR. Agents in a credit circle pay each other with signed credit vouchers; at the end of each epoch an open solver removes the debt cycles across all of them in one on-chain clearing, and only the net positions are settled in USDT. It is built as a binding of the x402 `batch-settlement` scheme on the network `x207:<circleId>`, and a buyer outside the circle can still pay with the `exact` scheme on NEAR.

**Status.** Hackathon prototype for NEAR HACKATHON (1–14 Nov 2026). The contract (interface 0.0.13, release v0.0.13) runs as the circle `x207-v013.testnet` on NEAR testnet with a dashboard, a read API and an MCP server on top; the integration tests run in a local `near-sandbox`, and the end-to-end sandbox workflow of this repository passed on GitHub on 2026-11-04 for the commit `d3e5e6c` ([run 41796991326](https://github.com/x207-labs/x207/actions/runs/41796991326)). No mainnet transaction has been sent. For judges: [CLAIMS.md](CLAIMS.md) maps every claim to its test and testnet transaction (`npm run check:claims` checks that they exist), [docs/what-has-run.md](docs/what-has-run.md) lists what ran in the sandbox, on testnet and on mainnet, and [docs/appendices.md](docs/appendices.md) maps the judging criteria and tracks.

## The problem and the idea

Agents that pay per call settle every call on its own, so a thousand small payments cost a thousand transfers, and an agent without cash cannot buy at all. x207 keeps the x402 flow and adds credit and clearing: an agent stakes USDT to get a credit limit, pays each call with a signed voucher that is served at once, and at the end of the epoch debts that go around in a circle (A owes B, B owes C, C owes A) cancel each other in one transaction. Only what is left is paid. In the realistic testnet epoch below, 24 vouchers worth 41.35 credit became 14 settlement movements (the metric `residualTransfers`: one for each member whose net position is not zero, here six debtors paying in and eight creditors claiming out). Clearing cancelled 21.8 credit of the 41.35, 52.7% of the obligations; the 19.55 credit that was left net to 7.75 USDT due from six debtors, of whom five paid (7.2 USDT) and the sixth (0.55 USDT) defaulted and was covered from its stake. So 21.8 credit was cancelled and only 7.75 of the 41.35 credit moved as USDT (18.7%). The full story, the gap in what exists today and the FAQ are in [docs/problem-and-gap.md](docs/problem-and-gap.md); the eight steps from stake to claim are in [docs/overview.md](docs/overview.md).

## Try it in 2 minutes

Three read-only steps, with nothing to install, no account and no key.

1. **Dashboard:** <https://x207-dashboard.vercel.app> opens, as of 2026-11-04, on epoch 8, the newest finalized epoch that cleared something: members, obligation graph, clearing statistics, risk. The circle is shared testnet: epoch 8 was run by the team's demo script from a team machine, and anybody can add epochs, so the newest ones change.
2. **Read API** (the same data as JSON, circle `agents-main` on `x207-v013.testnet`):

   ```bash
   curl -s https://x207-backend-production.up.railway.app/x207/circles/agents-main/epochs
   curl -s https://x207-backend-production.up.railway.app/x207/circles/agents-main/epochs/8/metrics
   ```

   The first call lists the epochs and their phases. The second gives the clearing result of epoch 8, the realistic example: 24 asymmetric obligations of 41.35 credit among 15 participants, 21.8 credit cancelled by the clearing (ratio 0.527), 19.55 credit left as residual obligations that net to 7.75 USDT due from six debtors, of whom five paid and one (`m06`) did not and was cut from its stake. `residualTransfers` (14) counts the members with a net position, six paying in and eight claiming out. Epoch 2 is the load test of the same circle: a complete graph of 210 obligations among 15 participants, cleared in four transactions (`close_epoch`, `submit_clearing`, `commit_epoch`, `finalize_epoch`; the 210 `register_cumulative` calls that recorded the vouchers are not counted).
3. **Connect your AI agent** to the hosted MCP server, `https://x207-mcp-production.up.railway.app/mcp` (Streamable HTTP, read-only: the six read tools, no key, no signing). Ask it, for example, "Give me the report of epoch 8 of the x207 circle".

   ```bash
   claude mcp add --transport http x207 https://x207-mcp-production.up.railway.app/mcp          # Claude Code
   codex mcp add x207 --url https://x207-mcp-production.up.railway.app/mcp                       # Codex
   ```

   Claude Desktop: Settings, Connectors, Add custom connector, with the URL above; or in `claude_desktop_config.json`, through the `mcp-remote` bridge:

   ```json
   { "mcpServers": { "x207": { "command": "npx", "args": ["-y", "mcp-remote", "https://x207-mcp-production.up.railway.app/mcp"] } } }
   ```

   Tested with the MCP Inspector against this URL; the three commands above follow the documentation of Claude Code, Codex and Claude Desktop and were not run with those clients.

   The server answers from the testnet RPC and the hosted read API above, for the circle `agents-main` on `x207-v013.testnet`; like them, it is hosted for the judging period. The deploy folder is made by `scripts/railway-mcp-bundle.mjs`.

The API, the MCP server and the dashboard are hosted for the judging period. If one of them does not answer, nothing is lost: [Run it locally](#run-it-locally-5-minutes) below runs the same contract and the same tools on a circle of its own on your machine, with `npm run demo:quick` and `npm run demo:mcp`, and needs nothing hosted.

## On testnet, with your own accounts

1. **Join the circle yourself** on testnet with two fresh accounts: join and stake with the MCP tool `x207_join`, sell an x402 service with the x207 entry, pay it from a second agent, and see the position on the dashboard, in [docs/join-the-circle.md](docs/join-the-circle.md).
2. **The contract that runs it:** release [v0.0.13](https://github.com/x207-labs/contracts/releases/tag/v0.0.13), wasm sha256 `b9327f2b5d64b1180ba76dd619c6091ae57b48964f520a784e366c131e787054` (the code hash on chain is `DTw5rUUdJSbWjD361MmBxKW4nm4ETnNkex63mfUCjsjh`, the same bytes in base58), `abi-v0.0.13.json` sha256 `c94a2955deab7b082d2e9f1ab396dae14b0323a4c12266fa09f43f1ca0a3bb53`. "Try it on testnet" below shows how to read the contract on chain and lists the transactions of a full epoch.

## Run it locally (5 minutes)

On your machine, in a local `near-sandbox`, with no account and no Rust. Needs Node 22.22.2 or newer and `git`.

```bash
git clone --recurse-submodules https://github.com/x207-labs/x207.git && cd x207
npm ci && npm run build --workspaces --if-present
npm run demo:quick    # one epoch of six agents: joins, paid calls, clearing, residuals, claims; about 5 minutes, most of it the sandbox clock
npm run demo:mcp      # an AI agent through the MCP tools on a local circle; about 2 minutes, prints every tool call and what it answered
```

Each of `demo:quick` and `demo:mcp` fetches what it needs by itself, the first time, so you can run either one first: the wasm of the release v0.0.13 from GitHub (its sha256 is checked against the number written in this repository) and the near-sandbox 2.13.4 binary from build.nearprotocol.com, kept in `node_modules/.cache/x207-quick`. `node scripts/demo-quick.mjs --check-only` downloads and checks both and runs nothing. The other ways to run the demos are in [docs/sandbox-demo.md](docs/sandbox-demo.md).

`npm ci` on npm 11.20 or newer may print `install-scripts` warnings about dependencies that have install scripts. `package.json` answers them in `allowScripts`: only `better-sqlite3`, the native SQLite of the backend, may run its script, and the optional native speed-ups (`bufferutil`, `utf-8-validate`, `secp256k1`, `bigint-buffer`, `fsevents`) and two notices (`core-js-pure`, `protobufjs`) are denied, because each has a pure JavaScript fallback. If a warning still shows, it is harmless.

**Ask Claude about the testnet circle from your own build** with the read tools of the MCP server `@x207/mcp` (it signs nothing and holds no key). The package is not on npm yet, so build it from a recursive clone of this repository once (`git clone --recurse-submodules https://github.com/x207-labs/x207.git`, then `npm ci && npm run build --workspaces --if-present`), then add this to `claude_desktop_config.json` and restart Claude Desktop:

```json
{
  "mcpServers": {
    "x207": {
      "command": "node",
      "args": ["/path/to/this/checkout/sdk/packages/mcp/dist/cli.js"],
      "env": {
        "X207_CIRCLE_CONTRACT": "x207-v013.testnet",
        "X207_CIRCLE_ID": "agents-main",
        "X207_BACKEND_URL": "https://x207-backend-production.up.railway.app"
      }
    }
  }
}
```

Then ask, for example, "Give me the overview of the x207 circle and the report of epoch 8". It reads the testnet RPC and the hosted read API, so it needs them to be up; the demos above do not. The tools and the write tools that stay off are listed in [sdk/packages/mcp/README.md](https://github.com/x207-labs/sdk/blob/main/packages/mcp/README.md).

## What is proven

| What | Result | Where to check |
| --- | --- | --- |
| A realistic epoch on testnet (`x207-v013.testnet`, epoch 8) | 24 asymmetric obligations of 41.35 credit among 15 participants: 21.8 credit cancelled (ratio 0.527), the 19.55 left net to 7.75 USDT due from six debtors, five paid and one did not and was cut from its stake, three of the eight creditors claimed | [docs/testnet.md](docs/testnet.md), [docs/testnet-0.0.13-realistic.json](docs/testnet-0.0.13-realistic.json) |
| A load test on the same circle (epoch 2) | A complete graph of 210 obligations cleared in four transactions (`close_epoch`, `submit_clearing`, `commit_epoch`, `finalize_epoch`; the 210 register calls are not counted): `submit_clearing` 28.0 Tgas, `commit_epoch` 69.4 Tgas | [contracts/docs/gas-and-cost.md](https://github.com/x207-labs/contracts/blob/main/docs/gas-and-cost.md) |
| The released contract | v0.0.13, wasm sha256 `b9327f2b5d64b1180ba76dd619c6091ae57b48964f520a784e366c131e787054`, a reproducible build whose code hash is the one on chain | [release v0.0.13](https://github.com/x207-labs/contracts/releases/tag/v0.0.13) |
| NEAR Intents | The residual of three debtors paid in one `execute_intents` of the real Intents contract (the wasm of `intents.near`) in `near-sandbox`. Not run on testnet (`intents.testnet` has no code) or on mainnet | `tests/residual-batch.sandbox.test.ts` |
| The product around the contract | A dashboard, a read API, an MCP server, a facilitator and solver, an indexer with the 207 report, and demo agents; the pipelines of the marketplace (invoices, orders, licenses, one-time codes, platform transfers, rent) each have an end-to-end test in `near-sandbox` | [docs/demo-blocks.md](docs/demo-blocks.md) |
| The threats | 21 threats, each with the test that pins its defence | [Threat model](docs/security-and-limits.md#threat-model), [docs/security.md](docs/security.md) |

What has not run: mainnet, NEAR Intents on testnet, a real wallet through NEAR Connect on the dashboard, and the cases in the third column of [docs/what-has-run.md](docs/what-has-run.md).

## Where to read more

| Topic | File |
| --- | --- |
| What x207 is, step by step, and what it means for each audience | [docs/overview.md](docs/overview.md) |
| The problem, what exists and the gap, x402 evolution, FAQ | [docs/problem-and-gap.md](docs/problem-and-gap.md) |
| How it works, the features F1 to F9 | [docs/how-it-works.md](docs/how-it-works.md) |
| Join the circle on testnet, step by step | [docs/join-the-circle.md](docs/join-the-circle.md) |
| Run it: the quick path and the sandbox demo | [docs/sandbox-demo.md](docs/sandbox-demo.md) |
| The MCP server for AI agents | [docs/mcp.md](docs/mcp.md) |
| The testnet circle, read it and check an epoch | [docs/testnet.md](docs/testnet.md) |
| Every pipeline and feature as "do X, see Y" with the test that runs it | [docs/demo-blocks.md](docs/demo-blocks.md) |
| What has and has not run, sandbox, testnet, mainnet | [docs/what-has-run.md](docs/what-has-run.md) |
| Architecture, how x207 uses NEAR, the mechanism and its invariants | [docs/architecture.md](docs/architecture.md) |
| Security: risks and limits, the threat model, impact | [docs/security-and-limits.md](docs/security-and-limits.md), [docs/security.md](docs/security.md) |
| Metrics, the relief against graph density, the roadmap | [docs/metrics-and-roadmap.md](docs/metrics-and-roadmap.md) |
| Judging criteria and tracks, glossary, traceability | [docs/appendices.md](docs/appendices.md) |
| Claims and their proof | [CLAIMS.md](CLAIMS.md) |

## Repositories

| Repo | What it holds |
| --- | --- |
| [x207](https://github.com/x207-labs/x207) | This umbrella: README, docs, demos, the end-to-end tests, scripts |
| [contracts](https://github.com/x207-labs/contracts) | The `x207-circle` contract in Rust (interface 0.0.13), near-sandbox tests, Sputnik DAO proposal scripts |
| [sdk](https://github.com/x207-labs/sdk) | `@x207/core`, `@x207/scheme`, `@x207/mcp`, the binding spec, formats and test vectors, the reference facilitator |
| [backend](https://github.com/x207-labs/backend) | Indexer, read API, HTTP 207 report, settlement worker, marketplace book, access broker |
| [frontend](https://github.com/x207-labs/frontend) | The dashboard and the marketplace pages |
| [solver](https://github.com/x207-labs/solver) | The open clearing solver, barter matching and the seeker |
| [agents](https://github.com/x207-labs/agents) | The demo agents and their scenarios |

The six product repositories are git submodules of this one. `vault`, the design notes, is private.

## Hackathon disclosures

**Code written with AI help.** The code, tests and documents of this project were written with the help of AI coding assistants: Claude Code (Anthropic) in several parallel sessions, each working on one repository under a human owner who set the design, reviewed the results and decided what to publish. Many commits carry a `Co-Authored-By: Claude` trailer. The design notes in a private repository were also written with it. Every number in this README comes from a run or a file named next to it; where a run did not happen, the text says so.

**License.** Every repository of the project is licensed under Apache-2.0: [x207](LICENSE), [contracts](https://github.com/x207-labs/contracts/blob/main/LICENSE), [sdk](https://github.com/x207-labs/sdk/blob/main/LICENSE), [backend](https://github.com/x207-labs/backend/blob/main/LICENSE), [frontend](https://github.com/x207-labs/frontend/blob/main/LICENSE), [solver](https://github.com/x207-labs/solver/blob/main/LICENSE) and [agents](https://github.com/x207-labs/agents/blob/main/LICENSE).

**Third-party libraries and services.** All of them are open source and are used as libraries or as hosted endpoints; none of their code is copied into this repository.

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

## License

Apache-2.0. See [LICENSE](LICENSE).
