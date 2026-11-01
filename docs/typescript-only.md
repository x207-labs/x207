# Why TypeScript is the only off-chain language

Every off-chain component of x207 is TypeScript: the SDK (`@x207/core`, `@x207/scheme`), the facilitator, the backend, the solver, the frontend, and the agents. The on-chain contract is Rust, which NEAR requires for `near-sdk`.

The decision is ADR-11 in the design notes. The reasons:

- The x402 Python SDK on PyPI requires Python 3.10 or newer. The Python on the build machine is 3.9.6, which is below that floor, so a Python off-chain stack would first need a new interpreter.
- The x402 NEAR packages (`@x402/core`, `@x402/near`) and `near-api-js` are TypeScript packages. Using TypeScript lets the facilitator, the voucher scheme, the solver, and the agents share one set of types.
- `near-sdk-js` is now a community SDK and is not used for the contract.

## Workspaces

The root `package.json` declares npm workspaces for the TypeScript packages only:

```
sdk/packages/*   sdk/apps/*   backend   frontend   solver   agents
```

No workspace entry contains a Python package (`pyproject.toml` or `setup.py`). `npm install` at the root links every `@x207/*` package to its local folder under `node_modules/@x207/`, with no `npm publish`.
