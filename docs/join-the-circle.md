# Join the circle

For the owner of an agent. About 20 minutes of work plus about 30 minutes of waiting for the epoch clock (step 6), on NEAR testnet, with a test token that has no value. You make two agent accounts, join the circle `x207-v013.testnet`, sell one x402 service that has an x207 entry, pay it from the second agent, see the position on the dashboard, and pay the residual of the buyer when the epoch is cleared, so that the buyer stays `active`. Every step is "do X, see Y", and every command below was run against the circle on 2026-11-04 with accounts made for this guide; the times are the ones measured.

> **A keeper moves the epochs until 2026-11-18.** A keeper service of the team (a boxd machine, [keeper-operations.md](keeper-operations.md)) closes, commits and finalizes the epochs of `x207-v013.testnet` by itself during the judging period, so an epoch ends on its clock: **pay your residual inside the payment window (step 6) or you are suspended.** If the keeper is stopped, any account can move the epoch by hand; the command is under [Move the epoch yourself](#move-the-epoch-yourself) at the end of this guide.

> **Do not stop before step 6.** A buyer that owes a residual and does not pay it inside the payment window **defaults**: at `finalize_epoch` its stake is cut by the amount due and the member is `suspended` (limit 0, new vouchers refused). That is what happened to the readers of an earlier version of this guide, which ended at the dashboard.

> **The circle is shared testnet.** Other people's accounts, the team's own demo runs and every reader of this guide use the same circle and the same epochs. Your accounts and your obligation appear next to theirs on the dashboard and stay there; nobody cleans them up. Any member may close an epoch that has passed its cutoff (step 3), which changes the epoch for everybody, so do it only when the epoch is stalled. The stake is a test token with no value.

You need Node 22.22.2 or newer and a recursive clone of this repository, built once:

```bash
git clone --recurse-submodules https://github.com/x207-labs/x207.git && cd x207
npm ci && npm run build --workspaces --if-present
```

`near` (near-cli-rs) must be on your `PATH` for step 1. Keep every key in a folder that is not in git (`.keys/` is ignored by this repository). The circle terms hash of `x207-v013.testnet` is `aaaa…a` (64 times `a`), the stake token is the mock USDT `usdt.x207-deployer.testnet`, and the read API is `https://x207.boxd.sh`.

> **Use a throwaway agent account.** The tools that join, settle and claim attach a NEAR deposit, which a function-call key cannot do, so they need a full-access key of the agent account. A full-access key can do anything the account can. Use an account made for the agent with a small balance, as here, never your main account (the security limit of [`@x207/mcp`](https://github.com/x207-labs/sdk/blob/main/packages/mcp/README.md)).

## 1. Two NEAR testnet accounts

| Do | See |
| --- | --- |
| `node scripts/create-faucet-accounts.mjs --keys-dir .keys my-seller.testnet my-buyer.testnet` (use your own names; the faucet makes the accounts) | `created my-seller.testnet balance 10 NEAR`, the same for the buyer; the keys are in `.keys/testnet/<account>.json` (mode 0600) |

The faucet has a per-client limit. If it answers `Rate limit exceeded, retry in 8 hours`, make the accounts as sub-accounts of an account you own that has a few NEAR and whose key is in `.keys/testnet/` (for example `my-seller.my-parent.testnet`): the same script creates them from the parent with 2 NEAR each. The run of 2026-11-04 behind this guide did that ([um130-guide-run.json](testnet-epochs/um130-guide-run.json)).
| `node scripts/guide-testnet.mjs mint my-seller.testnet --keys-dir .keys` and the same for `my-buyer.testnet` | `minted 200 mock USDT to my-seller.testnet in 2359 ms` (about 2 seconds) (the stake is paid in this mock token; anybody can mint it on testnet) |
| `node scripts/guide-testnet.mjs voucher-key`, once for each agent | A `secret ed25519:…` and a `public ed25519:…` line. The secret is the voucher key of the agent: it signs the payments and listings, and it is not a NEAR key. Keep it out of git |

## 2. Join and stake with the MCP tool `x207_join`

The tool runs over stdio, only with `X207_MCP_WRITE=1`, and only with the two switches that say you accept the risk. Put this in `claude_desktop_config.json` for the seller (a second entry with the buyer's account and keys does the same for the buyer; the NEAR key is the `secret_key` in `.keys/testnet/<account>.json`):

```json
{
  "mcpServers": {
    "x207-seller": {
      "command": "node",
      "args": ["/path/to/x207/sdk/packages/mcp/dist/cli.js"],
      "env": {
        "X207_CIRCLE_CONTRACT": "x207-v013.testnet",
        "X207_CIRCLE_ID": "agents-main",
        "X207_BACKEND_URL": "https://x207.boxd.sh",
        "X207_MCP_WRITE": "1",
        "X207_AGENT_ACCOUNT": "my-seller.testnet",
        "X207_AGENT_VOUCHER_KEY": "ed25519:<the voucher secret of step 1>",
        "X207_AGENT_NEAR_KEY": "ed25519:<secret_key of the account>",
        "X207_ALLOW_OUTFLOWS": "1",
        "X207_ALLOW_FULL_ACCESS_KEY": "1",
        "X207_MAX_SPEND_SESSION": "60000000",
        "X207_MAX_PRICE_PER_CALL": "100000"
      }
    }
  }
}
```

The two spending guards of the server: `X207_MAX_SPEND_SESSION` is the most the agent may commit in one run of the server, in credit units of 6 decimals, and it counts the stake too, so it must be at least the stake (here 50 USDT = `50000000`); `X207_MAX_PRICE_PER_CALL` is the most one payment, offer or milestone may be (here `100000` = 0.1 credit, which covers the 0.02 credit of the service in step 3; the default is also `100000`). **Tested with the MCP Inspector.** The calls in this guide were run with the MCP Inspector CLI (below) against the real testnet circle; the block above enters the same server and the same environment in Claude Desktop, and it was not run in Claude Desktop itself. Restart Claude Desktop and ask: "Join the x207 circle with terms hash `aaaa…a` (64 times `a`) and a stake of 50000000." The same call from a script, with the MCP Inspector, is:

```bash
npx @modelcontextprotocol/inspector --cli \
  -e X207_CIRCLE_CONTRACT=x207-v013.testnet -e X207_CIRCLE_ID=agents-main -e X207_BACKEND_URL=https://x207.boxd.sh \
  -e X207_MCP_WRITE=1 -e X207_AGENT_ACCOUNT=my-seller.testnet -e X207_AGENT_VOUCHER_KEY=ed25519:… -e X207_AGENT_NEAR_KEY=ed25519:… \
  -e X207_ALLOW_OUTFLOWS=1 -e X207_ALLOW_FULL_ACCESS_KEY=1 -e X207_MAX_SPEND_SESSION=60000000 \
  node sdk/packages/mcp/dist/cli.js --method tools/call --tool-name x207_join \
  --tool-arg "terms_hash=\"$(printf 'a%.0s' $(seq 64))\"" --tool-arg 'stake_amount="50000000"'
```

(The Inspector turns `50000000` into a number, so the amount is quoted to stay a string; an agent sends a string by itself.) The Inspector prints the MCP result as `{"content":[{"type":"text","text":"{…}"}]}`: the fields named in the "See" column of this guide are inside the JSON string `content[0].text`, not at the top level.

| Do | See |
| --- | --- |
| Call `x207_join` for the seller, then for the buyer | In about 11 seconds each: `"status": "active"`, `"stake": "50000000"`, `"limit": "40000000"` (80% of the stake for a new member, and never above the stake; it grows with settlement history), and the voucher public key. The tool sent `join` with the 0.35 NEAR storage deposit and then the stake transfer |
| `curl -s https://x207.boxd.sh/x207/circles/agents-main/members/my-seller.testnet` | The member, after the read API has caught up (within a few minutes): `status` `active`, `limit` `40000000`. Before that it answers `member_not_found`; the contract already has the member |

To join from code instead of a tool, use `onboardMember` of `@x207/core` as in [docs/quickstart.md](quickstart.md); it does the same two transactions.

## 3. Sell one x402 service with the x207 entry

The seller is an ordinary x402 endpoint whose 402 answer carries one more entry, `batch-settlement` on the network `x207:agents-main`, next to any `exact` entry. It needs a facilitator that verifies the vouchers and registers them in the contract. Here the seller account is also the relayer of its own facilitator, and pays the gas of the registrations (a few cents of testnet NEAR).

```bash
# a terminal for the facilitator (the NEAR key of the seller account is the relayer key)
cd sdk/apps/facilitator
NEAR_RPC_URLS=https://rpc.testnet.fastnear.com X207_CIRCLES=agents-main=x207-v013.testnet \
X207_RELAYER_ACCOUNT_ID=my-seller.testnet X207_RELAYER_PRIVATE_KEY=ed25519:… X207_REGISTER_MODE=per_request \
X207_PENDING_DB=/tmp/guide-pending.sqlite PORT=4021 node dist/main.js

# a second terminal for the seller
cd sdk/examples/seller
FACILITATOR_URL=http://localhost:4021 CIRCLE_ID=agents-main PAY_TO=my-seller.testnet PORT=3000 node dist/main.js
```

| Do | See |
| --- | --- |
| `curl -s localhost:4021/supported` | `batch-settlement` on `x207:agents-main`, `circleContract` `x207-v013.testnet`, the current `epoch`, and your relayer in `signers` |
| `curl -si localhost:3000/api/summarize` | `HTTP/1.1 402 Payment Required`; the body `accepts` has `scheme` `batch-settlement`, `network` `x207:agents-main`, `amount` `20000` (0.02 credit) and `payTo` your seller account. This is the x207 entry |

**If the answer later says `epoch_closing`:** the keeper of the team normally closes an epoch within seconds of its cutoff, but when it is stopped an epoch that has passed its cutoff stays open until somebody closes it, and no voucher is accepted for it. Any member may close it: `node scripts/guide-testnet.mjs close-epoch my-buyer.testnet --keys-dir .keys` prints, for example, `closed epoch 9; epoch 10 is open (4348 ms)` and, on the next lines, `transaction <hash>` and its `https://testnet.nearblocks.io/txns/<hash>` link (example output: your epoch numbers and times will differ). The seller advertises the new epoch after about 45 seconds: retry `curl -s localhost:4021/supported` until it shows the new epoch, because before that a payment is refused with `epoch_mismatch`. When the epoch is still open the command says `nothing to close`. To move the circle further (commit and finalize what is due) see step 6; the hashes of the catch-up of 2026-11-04 are in [testnet-epochs/um118-catch-up.json](testnet-epochs/um118-catch-up.json).

## 4. Pay the service from the second agent

**First check the epoch.** The keeper of the team closes epochs on time, but if it is stopped the open epoch may be past its cutoff, and then the first payment fails with `epoch_closing`. Run the command of step 3 now (`node scripts/guide-testnet.mjs close-epoch my-buyer.testnet --keys-dir .keys`): it prints `nothing to close` when the epoch is open, and closes it otherwise. After a close, wait about 45 seconds and retry `curl -s localhost:4021/supported` until it shows the new epoch; until then a payment is refused with `epoch_mismatch`.

Add the buyer to the MCP config, without the NEAR key (paying only signs vouchers), and with `X207_ALLOW_PRIVATE_URLS=1` because the seller is on `localhost`. Ask: "Pay http://localhost:3000/api/summarize." Scripted:

```bash
npx @modelcontextprotocol/inspector --cli \
  -e X207_CIRCLE_CONTRACT=x207-v013.testnet -e X207_CIRCLE_ID=agents-main -e X207_BACKEND_URL=https://x207.boxd.sh \
  -e X207_MCP_WRITE=1 -e X207_AGENT_ACCOUNT=my-buyer.testnet -e X207_AGENT_VOUCHER_KEY=ed25519:… -e X207_ALLOW_PRIVATE_URLS=1 \
  node sdk/packages/mcp/dist/cli.js --method tools/call --tool-name x207_pay_request --tool-arg 'url="http://localhost:3000/api/summarize"'
```

| Do | See |
| --- | --- |
| Call `x207_pay_request` for the buyer | In about 8 seconds: `"status": 200`, `"paid": true`, the body `{"summary":"summary text"}`, and a `paymentResponse` whose decoded `extensions.x207` says, for example, `"epoch": 10, "seq": 1, "cumulativeAmount": "20000", "registration": "registered"` (example output: your epoch number will differ) |
| Look at the log of the facilitator | `{"event":"registered","payer":"my-buyer.testnet","payee":"my-seller.testnet","epoch":10,"seq":1}` (example output: your epoch number will differ) |
| Ask the contract (command below the table) | `{"debtor":"my-buyer…","creditor":"my-seller…","cumulative":"20000","last_seq":1,…}`: the debt is in the contract. No USDT moved; it moves only as a residual after the clearing of the epoch |

To ask the contract, replace `10` with your epoch, run this and decode `result.result` (an array of bytes holding JSON):

```bash
ARGS=$(printf '{"epoch":10,"from_index":0,"limit":5}' | base64)
curl -s https://rpc.testnet.fastnear.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"x207-v013.testnet","method_name":"list_obligations","args_base64":"'"$ARGS"'"}}' \
  | python3 -c 'import sys,json;print(bytes(json.load(sys.stdin)["result"]["result"]).decode())'
```

## 5. See the position on the dashboard

| Do | See |
| --- | --- |
| Open <https://x207.vercel.app/charts?epoch=10> (use your epoch) | After the read API has caught up (within a few minutes of the payment): `1 obligations worth 0.02 credit`, with your buyer as debtor and your seller as creditor. Before that the page says that the epoch is not in the read model yet |
| Open [Risk](https://x207.vercel.app/risk?epoch=10) | Your two accounts as members with stake 50 and limit 40 credit |

The position you see here is still an obligation of an open epoch; nothing has moved. Step 6 takes it through clearing and the payment of the residual. The [sandbox demo](sandbox-demo.md) and the [testnet page](testnet.md) show bigger epochs with several parties, a solver and claims. The hosted read API and the dashboard are there for the judging period; if the read API is down, the contract steps still work (`curl` the RPC as in step 4) and only the dashboard and the `/members` check wait for it, and for a circle of your own on your machine use `npm run demo:quick` and `npm run demo:mcp` ([README](../README.md#run-it-locally-5-minutes)).

## 6. Pay the residual before the payment window ends

When the epoch ends, the circle clears it (here a single obligation, so nothing cancels) and every net debtor owes its **residual** in USDT. The buyer owes the 0.02 credit of step 4. The epoch goes through four phases, and the keeper of the team runs them for you while it is up. If it is stopped, you move them with the keeper script, one pass at a time (each pass does what is due and exits). Any account with about 0.5 NEAR can run it; the buyer account is fine:

```bash
KEEPER_SECRET_KEY=<secret_key of my-buyer.testnet> node scripts/keeper.mjs --rpc-url https://rpc.testnet.fastnear.com --contract x207-v013.testnet --account my-buyer.testnet --once --lookback 2
```

| Phase of your epoch (`get_epoch`) | What moves it | Wait |
| --- | --- | --- |
| `open` | nothing; vouchers are accepted until the cutoff | `epoch_length`, 600 s after the epoch opened (`cutoff_at`) |
| `cutoff` | keeper pass: `close_epoch` | then the `proposal_window`, 60 s, for a solver |
| `clearing` | keeper pass: `commit_epoch` | none |
| `payment_window` | **you pay the residual** (below) | at most `payment_window`, 900 s (`payment_deadline`) |
| after `payment_deadline` | keeper pass: `finalize_epoch` | |

Look at the epoch and its deadlines (replace `21` by your epoch; times are nanoseconds since 1970):

```bash
ARGS=$(printf '{"epoch":21}' | base64)
curl -s https://rpc.testnet.fastnear.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"x207-v013.testnet","method_name":"get_epoch","args_base64":"'"$ARGS"'"}}' \
  | python3 -c 'import sys,json;d=json.loads(bytes(json.load(sys.stdin)["result"]["result"]).decode());print(d["epoch"],d["phase"],d["cutoff_at"],d["payment_deadline"])'
```

Run the keeper pass after the `cutoff_at` (it prints `close_epoch`), again after about 60 seconds (it prints `commit_epoch`; the phase is now `payment_window`), and pay as soon as it is. Pay with the buyer's `x207_settle`, which needs the NEAR key, `X207_ALLOW_OUTFLOWS` and `X207_ALLOW_FULL_ACCESS_KEY` like step 2 (the tool pays at most what is due, and refuses with "the agent owes nothing" while the phase is not `payment_window`):

```bash
npx @modelcontextprotocol/inspector --cli \
  -e X207_CIRCLE_CONTRACT=x207-v013.testnet -e X207_CIRCLE_ID=agents-main -e X207_BACKEND_URL=https://x207.boxd.sh \
  -e X207_MCP_WRITE=1 -e X207_AGENT_ACCOUNT=my-buyer.testnet -e X207_AGENT_VOUCHER_KEY=ed25519:… -e X207_AGENT_NEAR_KEY=ed25519:… \
  -e X207_ALLOW_OUTFLOWS=1 -e X207_ALLOW_FULL_ACCESS_KEY=1 -e X207_MAX_SPEND_SESSION=60000000 \
  node sdk/packages/mcp/dist/cli.js --method tools/call --tool-name x207_settle --tool-arg epoch=21
```

| Do | See |
| --- | --- |
| Keeper pass after the cutoff, then after 60 more seconds | `{"method":"close_epoch","epoch":21,…}` and later `{"method":"commit_epoch","epoch":21,…}` with a transaction hash each |
| Call `x207_settle` for the buyer with your epoch | In about 3 seconds: `"paid": "20000"`, `"due": "20000"` |
| `net_position` of the buyer (same `curl` as above with `"method_name":"net_position"` and `{"epoch":21,"account_id":"my-buyer.testnet"}`) | `"role":"debtor"`, `"status":"paid"`; the seller shows `"role":"creditor"`, `"status":"claimable"` |
| Keeper pass after the `payment_deadline` | `{"method":"finalize_epoch","epoch":21,…}`; `get_epoch` says `finalized` |
| `member` of the buyer (`"method_name":"member"`, `{"account_id":"my-buyer.testnet"}`) | `"status":"active"`, not `suspended`; `settled_history` is now `20000` and `limit` a little above the 40 credit of the join (`40002000` in the run of 2026-11-04) |

If you skip the payment the last row reads `"status":"suspended"` and the stake is smaller by the amount due. The seller can take its credit with `x207_claim` once the epoch is committed.

## Stop

Stop the facilitator and the seller (`Ctrl-C` in their terminals). The stake stays in the circle; leaving it is the exit flow of the Onboarding page of the dashboard or the contract calls `request_exit` and `withdraw_stake` after the epoch is finalized.

## Move the epoch yourself

The three keeper steps are open to any account; there is no permission to ask for. One pass of the keeper script does whatever is due:

```bash
KEEPER_SECRET_KEY=<secret_key of one of your testnet accounts> node scripts/keeper.mjs --rpc-url https://rpc.testnet.fastnear.com --contract x207-v013.testnet --account <that account> --once --lookback 2
```

| The epoch is in | What is due | What the pass sends |
| --- | --- | --- |
| open, past its `cutoff_at` | close it | `close_epoch` |
| `cutoff`, after the 60 s `proposal_window` | commit the clearing | `commit_epoch` |
| `payment_window`, after `payment_deadline` | finalize | `finalize_epoch` |

Run it again after each wait. If nothing is due it prints nothing and sends nothing. The account pays the gas of the call, a few thousandths of a NEAR, and no reward exists for it ([security-and-limits.md](security-and-limits.md)). The pass moves the epoch for everybody, so do it only when the epoch is really past its time.
