// UM-048: the key spike evidence repeated with product code, not spike code (`spikes/run_spikes.py`). Read only, no keys, no transactions,
// no funds: views on the public mainnet RPC and a 1Click dry quote. Opt-in because it uses the real network:
//   X207_LIVE_PROBES=1 npx vitest run tests/spike-probes.live.test.ts
// The last result seen (2026-11-02) is in docs/traceability.md: S2.7 and S11.5 pass, S4.3 fails because 1Click answers "Quoting for this pair is not available". Other spike probes that need a transaction or mainnet funds are not included (UM-027).
import { describe, expect, it } from "vitest";
import { INTENTS_CONTRACT, OneClickClient, parseAppFees, rpcViewFunction, simulateIntents } from "../backend/src/settlement/index.ts";
// @ts-expect-error untyped .mjs script: the Sputnik DAO factory constant used by the product's proposal script
import { DEFAULT_FACTORY } from "../contracts/dao/lib.mjs";

const live = process.env.X207_LIVE_PROBES === "1";
const MAINNET_RPC = "https://rpc.mainnet.fastnear.com";

describe.skipIf(!live)("UM-048 probe spike terhadap kode produk", () => {
  it("S2.7 simulate_intents with the product simulateIntents(): empty intents execute zero, no transaction", async () => {
    const outcome = await simulateIntents(rpcViewFunction(MAINNET_RPC), []);
    expect(INTENTS_CONTRACT).toBe("intents.near");
    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) throw new Error(outcome.message);
    const result = outcome.result as { intents_executed: unknown[]; logs: string[] };
    expect(result.intents_executed).toEqual([]);
    expect(result.logs.join(" ")).toContain("intents_executed");
  }, 60_000);

  it("S4.3 dry 1Click quote with the product OneClickClient and appFees from the product config", async () => {
    const appFees = parseAppFees('[{"recipient":"x207-probe.near","fee":10}]');
    const client = new OneClickClient({ config: { mode: "dry", baseUrl: "https://1click.chaindefuser.com", jwt: undefined, appFees } });
    const q = await client.quote({
      swapType: "EXACT_INPUT", originAsset: "nep141:usdt.tether-token.near", destinationAsset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
      amount: "5000000", depositType: "INTENTS", recipientType: "INTENTS", refundType: "INTENTS", refundTo: "x207-probe.near", recipient: "x207-probe.near", dry: true,
    }).catch((error: unknown) => ({ failure: error instanceof Error ? error.message : String(error) }));
    if ("failure" in q) throw new Error(`dry quote rejected: ${q.failure}`);
    expect(q.quote.amountIn).toBe("5000000");
    expect(q.quote.depositAddress).toBeUndefined();
    expect(q.quoteRequest?.appFees).toEqual(appFees);
  }, 60_000);

  it("S11.5 factory Sputnik DAO product (DEFAULT_FACTORY) is readable on mainnet through the product rpcViewFunction", async () => {
    expect(DEFAULT_FACTORY).toBe("sputnik-dao.near");
    const count = await rpcViewFunction(MAINNET_RPC)(DEFAULT_FACTORY, "get_number_daos", {});
    expect(Number(count)).toBeGreaterThan(0);
    process.stderr.write(`S11.5 get_number_daos ${String(count)}\n`);
  }, 60_000);
});
