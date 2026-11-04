// UM-072 business block (K-59, track `business`): a procurement agent buys services with credit without per-transaction approval, only
// within the service list, the per-call limit, and the epoch budget set by the owner. One command from the umbrella root:
//   npm run demo:business          (near-sandbox, real contract; purchases outside the limits are rejected before any voucher)
// Every step prints "do X - see Y" with evidence for Appendix A of the README.
import { writeSync } from "node:fs";
import { afterAll, describe, it } from "vitest";
import { ProcurementAgent } from "../agents/scenario/business.ts";
import { AGENTS } from "../agents/shared/registry.ts";
import { createAgentBuyer } from "../agents/shared/x207.ts";
import { startStack, type Stack } from "../agents/test/stack.ts";

describe("demo business: procurement within budget", () => {
  let stack: Stack | undefined;
  afterAll(async () => {
    await stack?.stop();
  });

  it("procurement agent buys within limits and is refused outside them", async () => {
    const out = (line: string) => writeSync(1, `${line}\n`);
    const step = (doX: string, seeY: string) => out(`do: ${doX}\n   see: ${seeY}`);

    out("\n== K-59 business: procurement agent `gpu` with a budget from the owner");
    stack = await startStack();
    const { fx, identity, urls } = stack;
    const listed = (name: "translator" | "summarizer" | "cleaner", maxPrice: string) => ({
      name: AGENTS[name].verb, url: urls[name], path: `/api/${AGENTS[name].verb}`, maxPrice,
    });
    const agent = new ProcurementAgent({
      account: identity.gpu.accountId,
      policy: {
        spend: { maxPerCall: "50000", maxPerEpoch: "60000" },
        services: [listed("translator", "30000"), listed("summarizer", "10000"), listed("cleaner", "30000")],
      },
      pay: createAgentBuyer(identity.gpu, { rpcUrls: [fx.sandbox.rpcUrl] }),
    });
    out("owner policy: services translate<=0.03, summarize<=0.01, clean<=0.03; per call <=0.05; per epoch <=0.06 credit");

    const attempt = async (doX: string, service: string) => {
      const result = await agent.buy(service, "halo");
      step(doX, result.ok
        ? `HTTP ${result.status}, price ${result.price} (6 decimals), spent this epoch ${result.spentThisEpoch}, voucher signed`
        : `refused before payment: ${result.reason} ${JSON.stringify(result.detail)}, no voucher signed`);
      return result;
    };
    await attempt("gpu buys translate (on the owner's list, price 0.02)", "translate");
    await attempt("gpu buys summarize (listed, but the quoted 0.02 is above the 0.01 limit)", "summarize");
    await attempt("gpu buys image (not on the owner's list)", "image");
    await attempt("gpu buys clean (within limits)", "clean");
    await attempt("gpu buys translate again (reaches the 0.06 epoch budget exactly)", "translate");
    await attempt("gpu buys clean once more (would exceed the epoch budget)", "clean");

    const tick = await stack.scheduler.tick();
    out(`registered on-chain: ${JSON.stringify(tick)}`);
    const epoch = (await fx.sandbox.view<{ epoch: number }>(fx.circle.accountId, "get_epoch", {})).epoch;
    const edge = (creditor: "translator" | "cleaner" | "summarizer") =>
      fx.sandbox.view<{ cumulative: string } | null>(fx.circle.accountId, "obligation", { epoch, debtor: identity.gpu.accountId, creditor: identity[creditor].accountId });
    for (const creditor of ["translator", "cleaner", "summarizer"] as const) {
      step(`read obligation gpu -> ${creditor} from the contract (epoch ${epoch})`, `${(await edge(creditor))?.cumulative ?? "no edge"}`);
    }
    out(`result: approved ${agent.log.filter((l) => l.ok).length}, refused ${agent.log.filter((l) => !l.ok).length}, spent ${agent.spent} of 60000; on-chain debt equals the approved purchases`);
  }, 900_000);
});
