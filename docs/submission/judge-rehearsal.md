# Judge rehearsal (UM-192)

_Back to the [README](../../README.md) and the [judge FAQ](judge-faq.md). Run on 2026-11-05._

A judge starts from nothing: a fresh `git clone --recurse-submodules https://github.com/x207-labs/x207.git`, no `.env`, no keys, no cache. This note records what happened when every command of the README and the judge FAQ was run exactly as written, in that state.

## Setup

| Run | Where | Payung commit | Notes |
|---|---|---|---|
| A | macOS, Apple silicon, Node 26.11.1, npm 11.20 | `1275ec7` | first clone; submodule pointers lagged origin `main` |
| B | same Mac, new clone | `3a3a23c` | pointers bumped to origin `main` (contracts `7fe769e` v0.0.16, sdk `da3727c`, backend `2513ea5`, agents `e3b5074`, frontend `e394cf6`, solver `087fd43`) |
| C | Linux, Docker image `node:22-trixie` (Node 22.23.4, npm 10.9.9, aarch64), clone made inside the container | `d0291b8` | nothing installed beyond the image |

No `.env` file and no key in any run. The default `node:22` image was not used: its glibc is older than 2.39 and the near-sandbox binary stops (the README already says so).

## Timings and results

Seconds, wall clock. Network speed changes the clone and `npm ci` figures.

| Command (as written in the README / FAQ) | A macOS | B macOS | C Linux | Result |
|---|---|---|---|---|
| `git clone --recurse-submodules ...` | 15 to 100 | n/a | 12 | OK |
| `npm ci` | 19 | OK | 62 | OK |
| `npm run build --workspaces --if-present` | 3 | OK | 2 | OK |
| `npm run check:numbers` | 2 | OK | 2 | OK |
| `npm run check:claims` | 7, **FAILED** | OK | 2 | A failed on a lagging pointer (see below); fixed by `3a3a23c` |
| `npm run check:links` | 73 | OK | 42 | OK |
| `npm run check:pins` | 0 | OK | 0 | OK |
| `npm run demo:quick` | 197 | not rerun | 192 | OK |
| `npm run demo:mcp` | 126 | **FAILED** in 1 s | **FAILED** in 1 s | **broken since sdk `9eecbcd` (UM-187)**, see below |
| `npm run demo:swarm` | 285 | not rerun | 285 | OK |
| `curl -s https://x207.boxd.sh/x207/circles/agents-main/epochs` | OK | 4 | 2 | OK (JSON) |
| `curl -s .../epochs/8/metrics` | OK | 1 | 1 | OK (JSON, epoch 8 finalized) |
| `claude mcp add --transport http x207 https://mcp.x207.boxd.sh/mcp` | OK | n/a | n/a | OK; the hosted server answered `initialize` and `tools/list` |
| `npx -y @x207/mcp` inside the clone | n/a | exit 127 | exit 127 | `x207-mcp: command not found` (see below) |
| `npx -y @x207/mcp` outside the clone, no env | OK | OK | n/a | exits with `X207_CIRCLE_CONTRACT must be the circle contract account, e.g. x207-v013.testnet` |
| same with `X207_CIRCLE_CONTRACT=x207-v013.testnet` | OK | OK | n/a | `x207-mcp: stdio, circle x207-v013.testnet, ... read tools only` |
| `node scripts/keeper.mjs` (no key) | n/a | 0 | 0 | exit 1, `--rpc-url is required` (clear, no crash) |
| `scripts/verify-release.sh ...` (path as in the old FAQ) | n/a | exit 127 | exit 127 | wrong path: the script is `contracts/scripts/verify-release.sh` |
| `bash contracts/scripts/verify-release.sh v0.0.15 x207-v015.testnet` | n/a | 4, `MATCH` | exit 127 | on Linux: `gh: command not found` (needs the GitHub CLI) |

Commands that need keys (`scripts/keeper.mjs`, the agents with a live model, the write tools of the MCP server) stop with a message that names the missing option or variable. None crashed with a stack trace.

## Problems found

1. **`npm run demo:mcp` fails on a clean clone (open, not fixed here).** Error: `Cannot find package '@x402/extensions/bazaar' imported from sdk/examples/seller/src/seller.ts`. sdk commit `9eecbcd` (UM-187) made the example seller import it, but `sdk/examples/seller` is not an npm workspace and the root `package-lock.json` has no entry for `@x402/extensions`, so `npm ci` never installs it. It passed in run A (before UM-187) and fails in B and C. Fix belongs to the sdk owner: put `@x402/extensions` `2.29.0` in a workspace package (or make `examples/seller` a workspace), regenerate the lock, bump the pointer. Reported to the coordinator.
2. **Lagging submodule pointer broke `check:claims` (fixed).** Run A: the payung pointed at older commits of the sub-repos than the files `CLAIMS.md` names, so `check:claims` failed on a clean clone while it passed on the working machine (whose sub-repos were newer). Fixed by `3a3a23c`.
3. **`npx -y @x207/mcp` inside the clone stops with `x207-mcp: command not found`.** npx resolves the name to the workspace copy, whose command is not linked. Outside the clone it works. Fixed in [docs/mcp.md](../mcp.md): run `npx` from any other folder, or use `node sdk/packages/mcp/dist/cli.js` in the clone; the variable `X207_CIRCLE_CONTRACT` is required.
4. **`verify-release.sh` path and a hidden prerequisite.** The FAQ named `scripts/verify-release.sh`; the file is `contracts/scripts/verify-release.sh`, and it needs `gh`. Fixed in [judge-faq.md](judge-faq.md). On a bare Debian image install it first (`apt-get install -y gh`).
5. **Clone time varies** between 12 and 100 seconds (submodules from GitHub). The README figure "clone, `npm ci` and build 45 seconds" holds on a fast link only.

## Submodule pointers must be bumped before submit

The umbrella repo stores a commit id for each of the six sub-repos. A judge's clone checks out exactly those commits. If a sub-repo moves on (a new file, a renamed path) and the payung still points at the older commit, then everything the README and `CLAIMS.md` say about the new state is false for the judge, even though it is true on the maintainers' machines. Run A is the proof.

**Before submit (2026-11-14T23:59Z):**

1. Push every sub-repo first, then bump the pointers in the payung (`git add contracts sdk backend frontend solver agents`) and push it.
2. Make a clean clone in a new folder and run `npm ci && npm run build --workspaces --if-present && npm run check:numbers && npm run check:claims && npm run check:links && npm run check:pins`, then `npm run demo:mcp` (the one that regressed).
3. Do not push to a sub-repo after step 2 without bumping the pointer and repeating it.

## Proposed automatic check (not built yet)

A script `scripts/check-pointers.mjs`, run in CI on every push to the payung and as a step of `npm run check:claims`:

1. For each submodule, read the commit the payung records (`git ls-tree HEAD <path>`) and the tip of its default branch (`git ls-remote <url> HEAD`). **Fail** when the recorded commit is not the tip, listing `path: recorded abc1234, origin main def5678, N commits behind`.
2. Because the sub-repos are public, the check can run without a token; in CI it needs no submodule checkout.
3. Allow a documented exception list for a deliberate pin (for example the contracts submodule held at a release tag).
4. A second job runs the clean-clone steps above (`git clone --recurse-submodules`, then the checks, no `.env`) on `ubuntu-24.04` once a day and on every pointer bump; `demo:mcp` runs in it too. A dependency that works only because of a stale `node_modules` (problem 1) then fails in CI, not in front of a judge.

The first item is a few lines; the second job takes about 10 minutes of runner time per run.
