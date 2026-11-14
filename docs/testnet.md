# Try it on testnet

_Moved from the first, longer README (its section 4) and edited since. Paths are relative to this folder. Start at the [README](../README.md)._

### Try it on testnet (circle `x207-v013.testnet`, interface 0.0.13)

A circle with 15 members runs on NEAR testnet. Everything below needs no account and no key. Node 22.22.2 or newer and `curl` are enough.

Open the live dashboard: <https://x207.vercel.app/stats> (the root of the site is a landing page; the dashboard is at `/stats`). It opens the circle `x207-v018.testnet` by default; the circle of this page (`agents-main` on `x207-v013.testnet`) is under the circle picker (`?circle=v013`). For each circle it reads that circle's read API and shows its members, epochs, obligation graph and risk; signing in needs a testnet wallet. The read API is hosted for the judging period only.

Read the live contract:

```bash
curl -s https://rpc.testnet.fastnear.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"x207-v013.testnet","method_name":"get_params","args_base64":"e30="}}' | python3 -c 'import sys,json;print(bytes(json.load(sys.stdin)["result"]["result"]).decode())'
```

The answer holds `epoch_length` 600, `payment_window` 900, `proposal_window` 60, `bond_threshold` and `prune_delay_epochs`. Change `method_name` to `interface_version` to read `0.0.13`, or to `get_owner` to read the DAO that owns the circle (`x207v8.sputnikv2.testnet`).

The realistic epoch 8 (24 obligations among 15 members, partial clearing, five residuals, one default; every hash is in [docs/testnet-0.0.13-realistic.json](testnet-0.0.13-realistic.json)):

| Step | Transaction hash |
| --- | --- |
| `close_epoch` | `BuxEKN4CHXPY5KMKeCbyBRfLwrCzzuSF8oXm652Ae5KG` |
| `submit_clearing` | `7fuRk4xJCMGYmng1YTAvzRySiNVSeGrLvGQhanq3bW8P` |
| `commit_epoch` | `uuomfX8JzUiqpF9C6kodCmpndkYnyK8UH1f5caU14sp` |
| `finalize_epoch` (one default) | `BLsJyPoQykcQr2X5VaqxMH2dY2bon1B1U4d71FNc4bRi` |
| `claim` by `m10` | `7PRVh3mfGZoMc8eP3vhkbfNEfg5SvTQutzNX6Qqj1g3G` |

The load test, epoch 2, with the full 15 x 14 = 210 edge graph, on [nearblocks](https://testnet.nearblocks.io/address/x207-v013.testnet) (paste a hash into `https://testnet.nearblocks.io/txns/<hash>`):

| Step | Transaction hash |
| --- | --- |
| `close_epoch` | `329TWFnAzGwvKjR2fdRdqTKqVzLLRki7t5wWzR7KL4ox` |
| `submit_clearing` | `7jL5ZiJDxUGDS1btrhKoa9SoRZBpeadrv3jkbz3xM7J5` |
| `commit_epoch` | `8xcQqNZXhPNHgAukL4B42n8CMTXmEqx9BRmawH1XL1pb` |
| `finalize_epoch` | `DTXTVJaK55Pfubgh7215o3LtUAJPwb9TQu4NHSaJTtqi` |

The gas and the cost of every call, each with the transaction hash it was measured on, are in [contracts/docs/gas-and-cost.md](https://github.com/x207-labs/contracts/blob/main/docs/gas-and-cost.md). The deploy steps and the wasm hash are in [docs/testnet-0.0.13.json](testnet-0.0.13.json); the contract code hash on chain is `DTw5rUUdJSbWjD361MmBxKW4nm4ETnNkex63mfUCjsjh`.

Print the plan of the end-to-end demo against this circle (sends nothing):

```bash
npm ci
npm run build --workspaces --if-present
DEMO_NETWORK=testnet CIRCLE_CONTRACT=x207-v013.testnet npm run demo:testnet
```

The script sends transactions only with `X207_CONFIRM_REAL_TX=yes`, and it signs with keys that you provide in `KEYS_DIR` (for example accounts made by `scripts/create-faucet-accounts.mjs`). The keys of the project's own circle are not published, so to run the full cycle yourself, deploy your own circle (`scripts/deploy-testnet-rehearsal.mjs`) or use the sandbox demo above, which needs no key.
