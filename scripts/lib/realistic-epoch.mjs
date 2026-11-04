// The plan of one realistic epoch on the circle x207-v013.testnet (UM-104, from the run of UM-106): the graph, who owes a residual, who defaults, how many transactions and how long.
// Pure functions and data, no network and no key: `scripts/testnet-epoch.mjs` prints the plan with it, and `tests/testnet-realistic-epoch.live.test.ts` runs the same graph.

export const CIRCLE = "x207-v013.testnet";
export const AUX = "x207-v013-aux.testnet";
export const USDT = "usdt.x207-deployer.testnet";
export const MEMBER_COUNT = 15;
export const CREDIT = 1_000_000n;

/** Who owes whom, in credit: `[debtor, creditor, amount]` by member number. Cycles: 0-1-2, 3-4, 5-6-7-8; the rest are chains that end at a member who owes nothing to the chain. */
export const GRAPH = [
  [0, 1, 4.0], [1, 2, 2.5], [2, 0, 3.0], // a triangle: 2.5 can be cancelled
  [3, 4, 1.2], [4, 3, 0.75], // two members who owe each other: 0.75 can be cancelled
  [5, 6, 5.0], [6, 7, 3.5], [7, 8, 4.25], [8, 5, 1.8], // a ring of four: 1.8 can be cancelled
  [9, 10, 2.4], [10, 11, 1.1], [9, 11, 0.6], [12, 9, 0.9], [13, 12, 1.7], [14, 13, 0.45], // a chain 14 -> 13 -> 12 -> 9 -> 10 -> 11: nothing to cancel
  [14, 0, 0.35], [2, 10, 1.3], [7, 14, 0.8], [11, 3, 0.55], [4, 12, 0.65], [6, 13, 2.05], // links between the groups
  [8, 9, 1.15], [1, 5, 0.95], [10, 4, 0.4],
];

/** The circle's windows in seconds (`short_params` of the circle x207-v013): a wait of this size is real time on testnet. */
export const WINDOWS = { epochLeftMinSeconds: 7 * 60, proposalSeconds: 60, paymentSeconds: 900, cutoffSeconds: 600 };

export const credits = (x) => BigInt(Math.round(x * 1_000_000));
export const memberId = (i) => `m${String(i).padStart(2, "0")}.${AUX}`;

/** Base units (6 decimals) as a decimal string of credit: 41350000n -> "41.35". */
export const formatCredit = (units) => {
  const v = BigInt(units);
  const whole = v / CREDIT;
  const frac = (v % CREDIT).toString().padStart(6, "0").replace(/0+$/, "");
  return frac === "" ? String(whole) : `${whole}.${frac}`;
};

/**
 * The net position of every member: what it is owed minus what it owes. A clearing keeps these numbers (it only cancels cycles), so the residual of a debtor
 * is `-net` and the claim of a creditor is `net`, whatever the solver proposes. Sorted like the run: debtors by due ascending, creditors by claim descending.
 */
export function netPositions(graph = GRAPH) {
  const net = new Map();
  for (const [d, c, amount] of graph) {
    net.set(d, (net.get(d) ?? 0n) - credits(amount));
    net.set(c, (net.get(c) ?? 0n) + credits(amount));
  }
  const debtors = [...net].filter(([, n]) => n < 0n).map(([i, n]) => ({ member: memberId(i), due: -n })).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.member < b.member ? -1 : 1));
  const creditors = [...net].filter(([, n]) => n > 0n).map(([i, n]) => ({ member: memberId(i), claimable: n })).sort((a, b) => (a.claimable < b.claimable ? 1 : a.claimable > b.claimable ? -1 : a.member < b.member ? -1 : 1));
  return { debtors, creditors };
}

export const totalObligation = (graph = GRAPH) => graph.reduce((n, [, , amount]) => n + credits(amount), 0n);

/** The transactions the run sends, by step, and the real time it needs. */
export function transactionPlan(graph = GRAPH) {
  const { debtors, creditors } = netPositions(graph);
  const payers = debtors.length - 1; // the smallest residual defaults
  const claims = Math.min(3, creditors.length);
  const steps = [
    { step: "top up members with less than 0.25 NEAR", transactions: "0 to 15", by: CIRCLE },
    { step: "keeper pass over epochs left open (close, submit, commit, finalize as needed)", transactions: "0 to 4", by: AUX },
    { step: "register_cumulative, one voucher per edge, debtors in parallel", transactions: graph.length, by: "the debtors" },
    { step: "close_epoch after the cutoff", transactions: 1, by: AUX },
    { step: "submit_clearing from the solver of this repository", transactions: 1, by: AUX },
    { step: "commit_epoch after the proposal window", transactions: 1, by: AUX },
    { step: "mint mock USDT and settle (ft_transfer_call) for every debtor except the one that defaults", transactions: payers * 2, by: "the paying debtors" },
    { step: "finalize_epoch after the payment window (books the default)", transactions: 1, by: AUX },
    { step: "claim by the three largest creditors", transactions: claims, by: "the creditors" },
  ];
  return { steps, minutes: Math.round((WINDOWS.epochLeftMinSeconds + WINDOWS.proposalSeconds + WINDOWS.paymentSeconds) / 60) + 10 };
}
