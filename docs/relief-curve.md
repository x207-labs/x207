# Relief against graph density

`scripts/relief-curve.mjs` measures how much value cycle-only clearing removes as the debt graph gets denser. It uses the solver of this repo (min-cost flow, `solver/dist`), so build it first.

```bash
npm run build -w @x207/solver
node scripts/relief-curve.mjs --seed 207 --members 30
```

It writes `scripts/out/relief-curve.csv` and `scripts/out/relief-curve.svg`, and prints the CSV. The same `--seed` gives identical files.

## Graphs

- `random-<p>`: each ordered pair of members has a debt edge with probability `p`, with an amount from 1 to 100 units.
- `star`: every member except one owes the hub. No member owes anyone else, so the graph has no cycle and clearing removes nothing.

The graphs are synthetic. The numbers describe the mechanism on these graphs only. They are not the result of a demo epoch, and they are not a claim about real agent traffic.

## Columns

| Column | Meaning |
| --- | --- |
| `total_obligation` | Sum of all edge amounts |
| `nid` | Net internal debt: the sum of positive net positions, the minimum that must be paid in cash |
| `cleared_total` | Value removed by the clearing the solver proposes |
| `relief_pct` | `cleared_total / total_obligation`, in percent |
| `residual_payments` | Number of members with a negative net position, so the number of cash payments left |
| `payable_mass_omega` | `n/a`. The definition of payable mass is not fixed in the design notes. |
| `cost_per_payment` | `n/a`. It needs the measured gas of the residual payment (CT-003, CT-004). |

The chart marks the Sardex benchmark: 23% of value per monthly batch, from Fleischman, Dini and Littera (JRFM 2020).

## Open

- Payable mass Ω: needs a definition from the spec owner before the column can be filled.
- Cost per payment: needs measured gas and fee values.
