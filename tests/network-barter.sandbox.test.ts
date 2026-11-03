// UM-032: langkah F5 dari demo/network.demo.ts (demo/barter-step.ts) dijalankan terhadap near-sandbox dengan kontrak, facilitator dan penjadwal registrasi
// nyata. Membuktikan urutan yang dipakai demo jaringan: cincin dibayar lebih dulu, lalu pembayaran F2 biasa pada pasangan yang sama tetap diterima.
import { afterAll, describe, expect, it } from "vitest";
import type { ContractAbi, ContractCall } from "@x207/core";
import { createAgentBuyer } from "../agents/shared/x207.ts";
import { AGENTS } from "../agents/shared/registry.ts";
import { CALL_PRICE, LEG_AMOUNT } from "../agents/scenario/ring.ts";
import { startStack, type Stack } from "../agents/test/stack.ts";
import { runBarterRing } from "../demo/barter-step.ts";
import { sandboxAvailable } from "../sdk/test-support/sandbox.ts";

describe("UM-032 network demo step F5: an old contract is skipped", () => {
  it("a rejected get_bundle view: the step is skipped with a message and no transaction", async () => {
    const lines: string[] = [];
    let sent = 0;
    const result = await runBarterRing({
      view: async () => {
        throw new Error("MethodNotFound");
      },
      send: async () => {
        sent += 1;
      },
      rpcUrl: "http://127.0.0.1:1", contract: "old.testnet", epoch: 1, accounts: {} as never, identity: {} as never, urls: {} as never, log: (l) => lines.push(l),
    });
    expect(result).toEqual({ status: "skipped" });
    expect(sent).toBe(0);
    expect(lines.join("\n")).toMatch(/get_bundle/);
  });
});

describe.skipIf(!sandboxAvailable)("UM-032 network demo step F5 on near-sandbox", () => {
  let stack: Stack;
  afterAll(async () => {
    await stack?.stop();
  });

  it("commit_bundle by the solver, legs with a bundleId are fully registered, then an F2 payment on the same pair is accepted", async () => {
    stack = await startStack();
    const { fx, identity, urls } = stack;
    const contract = fx.circle.accountId;
    const rpcUrl = fx.sandbox.rpcUrl;
    const solver = await fx.sandbox.createAccount("solver", "20");
    const solverAccount = fx.sandbox.accountFrom(solver.accountId, solver.secretKey);
    const accounts = Object.fromEntries(Object.entries(identity).map(([n, i]) => [n, i.accountId])) as Record<keyof typeof identity, string>;
    const epoch = (await fx.sandbox.view<ContractAbi.EpochView>(contract, "get_epoch", {})).epoch;
    const lines: string[] = [];
    const result = await runBarterRing({
      // final like createNearView in the network demo; the facilitator also reads the final block
      view: (m, a) => stack.rpc.view(contract, m, a), rpcUrl, contract, epoch, accounts, identity, urls, log: (l) => lines.push(l),
      send: async (call: ContractCall) => {
        const r = await solverAccount.call(call, "EXECUTED_OPTIMISTIC");
        if (r.failures.length > 0) throw new Error(r.failures.join("; "));
        return r.value;
      },
    });
    if (result.status !== "done") throw new Error(`step skipped: ${lines.join(" | ")}`);
    expect(result.terms.legs).toHaveLength(3);
    expect(Object.values(result.paid).every((v) => v === BigInt(LEG_AMOUNT))).toBe(true);
    expect(await stack.scheduler.tick()).toMatchObject({ registered: 3, dropped: 0, retrying: 0 });
    const stored = await fx.sandbox.view<ContractAbi.BundleView>(contract, "get_bundle", { bundle_id: result.bundleId });
    expect(stored.legs.map((l) => l.registered)).toEqual(result.terms.legs.map(() => String(LEG_AMOUNT)));

    // urutan demo jaringan: F2 biasa sesudah cincin, pada pasangan yang sama dan tanpa bundleId
    const [leg] = result.terms.legs;
    const buyer = (Object.keys(accounts) as Array<keyof typeof accounts>).find((n) => accounts[n] === leg!.payer)!;
    const seller = (Object.keys(accounts) as Array<keyof typeof accounts>).find((n) => accounts[n] === leg!.payee)!;
    for (let i = 0; i < 2; i += 1) {
      const response = await createAgentBuyer(identity[buyer], { rpcUrls: [rpcUrl] })(`${urls[seller]}/api/${AGENTS[seller].verb}?input=halo`);
      expect(response.status).toBe(200);
    }
    expect(await stack.scheduler.tick()).toMatchObject({ dropped: 0, retrying: 0 });
    const edge = await fx.sandbox.view<{ cumulative: string }>(contract, "obligation", { epoch, debtor: leg!.payer, creditor: leg!.payee });
    expect(edge.cumulative).toBe(String(LEG_AMOUNT + 2 * CALL_PRICE));
    console.log(`NETWORK-BARTER bundle ${result.bundleId}: legs ${LEG_AMOUNT} registered, then 2 plain calls, edge ${edge.cumulative}`);
  }, 600_000);
});
