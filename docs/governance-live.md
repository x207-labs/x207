# A DAO proposal on the live circle (UM-127, KN-31)

One real `set_params` proposal went through the Sputnik DAO `x207v8.sputnikv2.testnet` for the circle `x207-v013.testnet` on 2026-11-04, was voted by two council members and took effect in the next epoch, and the production dashboard shows it. Hashes: [testnet-epochs/um127-set-params.json](testnet-epochs/um127-set-params.json).

| Step | Who | Hash |
| --- | --- | --- |
| `add_proposal` (id 4, `set_params`, the whole params from `get_params`, `prune_delay_epochs` 2 to 3; a change that does not disturb the demo) | `x207-dao-v8.testnet` | `3QvNvyymG6S8FUpVKQYPPHepfEqGek2hz3HAvYpSbexT` |
| `VoteApprove` | `x207-dao-v8.testnet` | `8nfaLNxwNcw7Mp34z1gKEE6oeFvVSVfLtMnQq5VeiF5x` |
| `VoteApprove` (the second vote: the proposal is `Approved` and the DAO calls `set_params`) | `b.x207-dao-v8.testnet` | `4ZKJGf3H73zHfkHi21wzac4cyqaFBQVVEr3s2WHTmsie` |
| `close_epoch` 19 (epoch 20 opens with the new params) | `x207-v013-aux.testnet` | `8AauxMtqryzECYJDpdxURWyuYLpDJAoPd1zD4NTN4PxA` |

## What was checked

- Contract: right after the second vote `get_pending_params` said `effective_epoch` 20 and `prune_delay_epochs` 3, while `get_params` still said 2; once epoch 20 was open `get_params` said 3.
- Read API (boxd): `GET /x207/circles/agents-main/proposals` lists proposal 4 as `Approved`, method `set_params`, council votes `[2,0,0]`; `GET .../params` first showed it as `nextEpoch` with `nextEpochEffective` 20.
- Dashboard: [x207.vercel.app/governance](https://x207.vercel.app/governance) shows, in the parameter table, "3 epochs, effective from epoch 20" for the prune delay, proposal 4 under "Closed proposals" (`Approved`, votes 2 / 0 / 0, proposer `x207-dao-v8.testnet`) and a line in "Change history" (`prune_delay_epochs`, 2 to 3, epoch 20).

## The same step in the demo script (UM-036)

The network demo has the step: with `DEMO_DAO_ACCOUNT=<Sputnik DAO> DEMO_DAO_COUNCIL=<a,b> DEMO_DAO_PARAMS_FILE=<whole params json>` set, `npm run demo:testnet` (with `X207_CONFIRM_REAL_TX=yes`) adds the proposal as the first council member, votes with the others until the proposal is `Approved`, and prints `get_params` before and after ([demo/network.demo.ts](../demo/network.demo.ts)). It runs only when `get_owner` of the circle is that DAO, and it skips with a message otherwise. It ran that way on 2026-11-03 on its own circle (DAO `x207b.sputnikv2.testnet`, steps `dao.add_proposal` and `dao.vote.*` in [testnet-demo.json](testnet-demo.json), `limit_decay` 0 to 100, effective from epoch 11). The run on this page is the same flow on the live circle, with the dashboard evidence above. The mainnet DAO step is separate and needs the owner ([mainnet-runbook.md](mainnet-runbook.md), step 9).

## Notes

- A proposal takes the whole `Params`: a file with only the changed field is refused by `contracts/dao/mainnet-set-params.mjs` (its dry run says which fields are missing). The council of this DAO has two members and both must approve.
- The new values wait for the next epoch to open; no keeper runs on this circle all the time, so somebody has to close the running epoch (`scripts/keeper.mjs --once`, see [join-the-circle.md](join-the-circle.md)).

## Clearing fee set to 0 (UM-153)

The clearing fee is 0 in the MVP: the drop in treasury cash seen in the audit came from netting, not from solver clearing, so a fee would only hide that. Proposal 5 on `x207v8.sputnikv2.testnet` set `clearing_fee_bps` and `solver_fee_bps` to 0 on `x207-v013.testnet` (2026-11-05, the other `Params` unchanged):

- add_proposal `4EtU84Dg4RA3HYayPeysJYYQMaa8EBCZpK1wP4wr3e4X`
- votes `21qRz2xVaxYmrtKePKdbAgxo2ec3nbn1qzi34FR7F9NU` (`x207-dao-v8.testnet`) and `BYDPGpkBX7es4G2WUtzub3bnZ3F3D4FuZkWVvrRbW7kn` (`b.x207-dao-v8.testnet`); the second vote ran it, status `Approved`
- effective from epoch 48; `get_params` then returns `fees: { clearing_fee_bps: 0, solver_fee_bps: 0 }`

