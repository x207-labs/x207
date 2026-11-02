// SV-009 against a real node: the solver signs Transaction::V1 (NEP-611) with a gas key and near-sandbox (neard 2.13.4,
// protocol 86) accepts it. The gas key is added to the solver account and funded; the transaction goes through
// NearRpcChain.call on nonce lane 2, gas comes out of the key's balance, and lane 2 of the key advances.
// Run: X207_SANDBOX=1 npx vitest run tests/gaskey.sandbox.test.ts
import { afterAll, describe, expect, it } from "vitest";
import { KeyPair } from "../sdk/node_modules/near-api-js/lib/index.js";
import { NearRpcChain, parseSecretKey } from "../solver/src/submit/index.ts";
import { MOCK_FT_WASM, sandboxAvailable, startSandbox, type Sandbox } from "../sdk/test-support/sandbox.ts";

describe.skipIf(!sandboxAvailable)("SV-009 gas key (NEP-611) in near-sandbox", () => {
  let sandbox: Sandbox | undefined;
  afterAll(async () => {
    await sandbox?.stop();
  });

  it("a V1 transaction signed with a funded gas key is accepted and the lane nonce advances", async () => {
    sandbox = await startSandbox();
    const ft = await sandbox.createAccount("gk-ft", "20");
    await sandbox.deploy(ft, MOCK_FT_WASM);
    expect((await ft.call({ receiverId: ft.accountId, methodName: "new", args: {}, deposit: 0n })).failures).toEqual([]);
    const solver = await sandbox.createAccount("gk-solver", "20");

    const gasKey = KeyPair.fromRandom("ed25519");
    await solver.account.addFullAccessGasKey(gasKey.getPublicKey(), 4);
    await solver.account.transferToGasKey(solver.accountId, gasKey.getPublicKey(), 10n ** 24n);

    const nonces = async () =>
      (
        (await (
          await fetch(sandbox!.rpcUrl, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_gas_key_nonces", finality: "optimistic", account_id: solver.accountId, public_key: gasKey.getPublicKey().toString() } }),
          })
        ).json()) as { result: { nonces: (number | string)[] } }
      ).result.nonces.map(Number);
    const before = await nonces();
    expect(before).toHaveLength(4);

    const chain = new NearRpcChain({
      rpcUrl: sandbox.rpcUrl, contractId: ft.accountId, signerId: solver.accountId, key: parseSecretKey(gasKey.toString()), gasTgas: 30, gasKeyNonceIndex: 2,
    });
    const outcome = await chain.call("ft_total_supply", {});
    expect(outcome).toMatchObject({ ok: true });
    const after = await nonces();
    expect(after[2]).toBeGreaterThan(before[2]!);
    expect([after[0], after[1], after[3]]).toEqual([before[0], before[1], before[3]]);
  }, 300_000);
});
