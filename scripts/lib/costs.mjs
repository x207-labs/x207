// CT-049: what each account of a mainnet deployment needs, from contracts/docs/gas-and-cost.md (testnet measurements, interface 0.0.13).
// All amounts are NEAR. `measured` figures come from the testnet epoch of CT-100 (210 edges, 15 members); the rest are `estimate`.
export const YOCTO = 10n ** 24n;
/** Storage price: 1e19 yoctoNEAR per byte (0.00001 NEAR per byte), the same on testnet and mainnet. */
export const STORAGE_NEAR_PER_BYTE = 0.00001;
/** A transaction reserves about 0.001 NEAR per Tgas of prepaid gas (burn price 1e8 yocto/gas, reserve 10x, plus ~0.9 Tgas of fixed fees). */
export const reserveNear = (tgas) => Math.round((tgas + 0.9) * 1e3) / 1e6;
export const GAS_TGAS = { close_epoch: 20, submit_clearing: 60, commit_epoch: 150, finalize_epoch: 100, prune_epoch: 200 };
/** Measured burn of one epoch of 210 edges: all four steps, and the whole epoch with vouchers and settlement (gas-and-cost.md). */
export const EPOCH_BURN = { fourSteps: 0.0109, wholeEpoch: 0.1075, edges: 210 };

/**
 * @param {{ wasmBytes: number, epochs?: number, edgesPerEpoch?: number, members?: number }} o
 * @returns {{ rows: { account: string, minimum: number, recommended: number, basis: string, note: string }[], total: number }}
 */
export function estimateCosts({ wasmBytes, epochs = 20, edgesPerEpoch = 210, members = 6 }) {
  if (!Number.isInteger(wasmBytes) || wasmBytes <= 0) throw new Error("wasmBytes must be a positive integer");
  const code = wasmBytes * STORAGE_NEAR_PER_BYTE;
  const stateAndRegistry = 0.1 + 90 * 0.003; // `new` state, and the 90 kinds of the asset catalog at ~300 bytes each
  const perEpoch = (EPOCH_BURN.fourSteps * edgesPerEpoch) / EPOCH_BURN.edges;
  const round = (x) => Math.ceil(x * 100) / 100;
  const rows = [
    {
      account: "circle", minimum: round(code + 0.1), recommended: round(code + stateAndRegistry + 1),
      basis: "measured size of the release wasm",
      note: `code ${code.toFixed(2)} NEAR locked as storage (${wasmBytes} bytes), state of \`new\` and of the asset catalog about ${stateAndRegistry.toFixed(2)}, 1 NEAR spare. The member storage is paid by the join deposit (0.35 NEAR each, not returned). deploy-mainnet.mjs refuses an account below 8 NEAR.`,
    },
    {
      account: "keeper", minimum: round(reserveNear(GAS_TGAS.commit_epoch) + 0.01), recommended: round(reserveNear(GAS_TGAS.commit_epoch) + epochs * perEpoch * 0.7 + 0.1),
      basis: "estimate (reserve rule, measured on testnet)",
      note: `the largest call is commit_epoch at 150 Tgas, which reserves ${reserveNear(150)} NEAR; close/finalize/prune reserve ${reserveNear(20)}/${reserveNear(100)}/${reserveNear(200)}. The keeper refuses to sign below the reserve. Recommended covers ${epochs} epochs.`,
    },
    {
      account: "solver", minimum: round(reserveNear(GAS_TGAS.submit_clearing) + 0.01), recommended: round(reserveNear(GAS_TGAS.submit_clearing) + epochs * 0.003 + 0.05),
      basis: "estimate (reserve rule, measured on testnet)",
      note: `submit_clearing at 60 Tgas reserves ${reserveNear(60)} NEAR and burns about 0.003 for 210 edges. The solver stops with a clear message below the reserve. Recommended covers ${epochs} epochs.`,
    },
    {
      account: "each agent", minimum: 0.4, recommended: 0.5, basis: "JOIN_STORAGE_DEPOSIT 0.35 NEAR + gas",
      note: `the join deposit is not returned (${members} agents: ${(members * 0.5).toFixed(1)} NEAR with the spare)`,
    },
  ];
  return { rows, total: round(rows.reduce((s, r) => s + r.recommended * (r.account === "each agent" ? members : 1), 0)), epochBurn: { edgesPerEpoch, wholeEpoch: Math.round((EPOCH_BURN.wholeEpoch * edgesPerEpoch) / EPOCH_BURN.edges * 1e4) / 1e4 } };
}
