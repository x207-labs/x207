# Realistic epochs on testnet

`npm run testnet:epoch` plays one realistic epoch on the circle `x207-v013.testnet` from a local machine and writes the hash of every step to `docs/testnet-epochs/<epoch>.json` (hashes and account names only, no key).

```bash
npm run testnet:epoch                 # the plan only (default): the graph, the residuals, who defaults, the transactions, the time; reads the chain, sends nothing
npm run testnet:epoch -- --offline    # the same without any network call
npm run testnet:epoch -- --execute    # sends the transactions, about 35 minutes of real time (testnet only)
```

What a run does: an asymmetric graph of 24 edges among 15 members (41.35 credit); every debtor registers its voucher; `close_epoch`; the solver of this repository submits a partial clearing (21.8 credit cancelled, 19.55 left); `commit_epoch`; the payment window, in which five of the six debtors pay their residual and the smallest one defaults; `finalize_epoch` books the default from its stake; the three largest creditors claim. The numbers are those of epoch 8 (`docs/testnet-0.0.13-realistic.json`); the plan is computed from the same graph and a test (`node --test scripts/testnet-epoch.test.mjs`) compares it with that record.

Keys are read by the run from the folder in `X207_SECRETS_DIR` (default `.secrets/testnet-deployer` at the root of the project); the script only checks that the files exist and never prints one. Run `npm ci && npm run build --workspaces --if-present` once first. The result file is named after the epoch; a run that stops leaves `failed-<time>.json` with the steps that did happen.
