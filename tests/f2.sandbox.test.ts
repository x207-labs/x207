// UM-023: F2 end-to-end on near-sandbox with the contract, facilitator and six real agents (code from agents/ and sdk/).
// 402 -> PAYMENT-SIGNATURE voucher -> threshold registration -> PAYMENT-RESPONSE, hundreds of calls, and rejections.
import { afterAll, describe, expect, it } from "vitest";
import { parseEventLog, signVoucher, type ContractAbi } from "@x207/core";
import { NearRegistrationChain, RegistrationScheduler, type RegistrationChain } from "@x207/facilitator";
import { createAgentBuyer } from "../agents/shared/x207.ts";
import { startStack, type Stack } from "../agents/test/stack.ts";
import { sandboxAvailable } from "../sdk/test-support/sandbox.ts";

const decode = (header: string | null) => JSON.parse(Buffer.from(header!, "base64").toString("utf8"));

describe.skipIf(!sandboxAvailable)("UM-023 F2 di near-sandbox", () => {
  let stack: Stack;
  afterAll(async () => {
    await stack?.stop();
  });

  it("TC-UM-023-01..07", async () => {
    stack = await startStack();
    const { fx, identity, urls, pending, rpc, relayer, facilitatorUrl } = stack;
    const translator = identity.translator;
    const summarizer = identity.summarizer;
    const epoch = await fx.sandbox.view<ContractAbi.EpochView>(fx.circle.accountId, "get_epoch", {});

    // 01: no payment header -> 402 with a batch-settlement entry and the running extra.epoch
    const challenge = await fetch(`${urls.summarizer}/api/summarize?input=halo`);
    expect(challenge.status).toBe(402);
    const accepts = decode(challenge.headers.get("PAYMENT-REQUIRED")).accepts as Array<{ scheme: string; network: string; extra: { epoch: number } }>;
    expect(accepts[0]).toMatchObject({ scheme: "batch-settlement", network: "x207:agents-main", extra: { epoch: epoch.epoch } });

    // Scheduler with the default threshold (1 credit) runs during the calls; registration events are counted from the transaction log.
    const registrations: string[][] = [];
    const schedulerLog: unknown[] = [];
    // The scheduler clock can be advanced (`skewMs`) to enter the flush window before the cutoff; used once, after all calls have finished.
    let skewMs = 0;
    const scheduler = new RegistrationScheduler({
      circleContract: fx.circle.accountId, store: pending, log: (entry) => schedulerLog.push(entry), now: () => Date.now() + skewMs,
      chain: new NearRegistrationChain({
        rpc, circleContract: fx.circle.accountId, relayer: { accountId: relayer.accountId, privateKey: relayer.secretKey },
        onLogs: (logs) => registrations.push(logs),
      }),
    });
    scheduler.start(200);

    // 02: voucher seq 1
    const paid = createAgentBuyer(translator, { rpcUrls: [fx.sandbox.rpcUrl] });
    const first = await paid(`${urls.summarizer}/api/summarize?input=halo`);
    expect(first.status).toBe(200);
    expect(decode(first.headers.get("PAYMENT-RESPONSE"))).toMatchObject({
      success: true, transaction: `${translator.accountId}:${summarizer.accountId}:${epoch.epoch}:1`,
      extensions: { x207: { registration: expect.stringMatching(/^(pending|registered)$/) } },
    });

    // 03: 300 sequential calls, then flush
    for (let i = 2; i <= 300; i++) {
      const response = await paid(`${urls.summarizer}/api/summarize?input=halo`);
      expect(response.status, `call ${i}`).toBe(200);
    }
    scheduler.stop();
    // A remainder below the threshold (1 credit) is deliberately not registered by the regular round: it waits for the flush window before `cutoff_at`
    // (Binding x402 spec 6.3). How much is already registered when the calls end depends on RPC speed, so without
    // this step the final result would depend on timing. Advance the scheduler clock to 60 seconds before the cutoff, then wait until all rows are settled.
    const cutoffMs = Number(BigInt(epoch.cutoff_at) / 1_000_000n);
    skewMs = Math.max(0, cutoffMs - 60_000 - Date.now());
    // A periodic round that is still running makes the next tick() skip; repeat until no open rows remain.
    for (let i = 0; i < 60 && pending.listOpen(fx.circle.accountId).length > 0; i++) {
      await scheduler.tick();
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(pending.listOpen(fx.circle.accountId), "registration row still open after 30 seconds").toEqual([]);
    console.log("scheduler", JSON.stringify(schedulerLog.slice(0, 6)), "registrations", registrations.length);
    const pair = { epoch: epoch.epoch, debtor: translator.accountId, creditor: summarizer.accountId };
    const obligation = await fx.sandbox.view<ContractAbi.ObligationView>(fx.circle.accountId, "obligation", pair);
    expect(obligation).toMatchObject({ cumulative: "6000000", last_seq: 300 });

    // 04: the number of registrations for that pair is far below the number of calls
    const events = registrations.flatMap((logs) => logs.flatMap((l) => parseEventLog(l) ?? []));
    const forPair = events.filter(
      (e) => e.event === "voucher_registered" && (e as { payer: string; payee: string }).payer === translator.accountId && (e as { payee: string }).payee === summarizer.accountId,
    );
    expect(forPair.length).toBeLessThanOrEqual(7);
    expect(forPair.length).toBeLessThan(300 * 0.05);

    // 05: an increase beyond the headroom -> insufficient_credit; the on-chain obligation stays
    const voucherBody = (seq: number, cumulative: string, amount: string) => {
      const { signature, ...voucher } = signVoucher(
        { circle: fx.circle.accountId, payer: translator.accountId, payee: summarizer.accountId, epoch: epoch.epoch, seq, cumulativeAmount: cumulative, unit: "credit", resource: `${urls.summarizer}/api/summarize` },
        translator.voucherSecretKey,
      );
      const requirements = { ...accepts[0], amount, asset: "USD", payTo: summarizer.accountId, maxTimeoutSeconds: 60 };
      return { x402Version: 2, paymentPayload: { x402Version: 2, resource: { url: `${urls.summarizer}/api/summarize` }, accepted: requirements, payload: { voucher, signature } }, paymentRequirements: requirements };
    };
    const verify = async (body: unknown) =>
      (await (await fetch(`${facilitatorUrl}/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json()) as { isValid: boolean; invalidReason?: string };
    expect(await verify(voucherBody(301, "56000000", "50000000"))).toMatchObject({ isValid: false, invalidReason: "insufficient_credit" });
    expect(await fx.sandbox.view<ContractAbi.ObligationView>(fx.circle.accountId, "obligation", pair)).toMatchObject({ cumulative: "6000000" });

    // 06: a seq that was already used -> seq_not_increasing
    expect(await verify(voucherBody(300, "6000000", "20000"))).toMatchObject({ isValid: false, invalidReason: "seq_not_increasing" });
    expect(await fx.sandbox.view<ContractAbi.ObligationView>(fx.circle.accountId, "obligation", pair)).toMatchObject({ cumulative: "6000000", last_seq: 300 });

    // 07: registration RPC down twice -> retrying, a new voucher is rejected, then recovery
    let down = 2;
    const flaky: RegistrationChain = {
      register: async (voucher, signature, mode) => {
        if (down > 0) {
          down -= 1;
          throw new Error("RPC mati");
        }
        return real.register(voucher, signature, mode);
      },
      lastSeq: (...args) => real.lastSeq(...args),
      getEpoch: (e) => real.getEpoch(e),
    };
    const real = new NearRegistrationChain({ rpc, circleContract: fx.circle.accountId, relayer: { accountId: relayer.accountId, privateKey: relayer.secretKey } });
    let clock = Date.now();
    const retry = new RegistrationScheduler({ circleContract: fx.circle.accountId, store: pending, chain: flaky, log: () => {}, registerThreshold: 1n, now: () => clock });
    const scraperPaid = createAgentBuyer(identity.scraper, { rpcUrls: [fx.sandbox.rpcUrl] });
    expect((await scraperPaid(`${urls.image}/api/image?input=halo`)).status).toBe(200);
    await retry.tick();
    clock += 5_000;
    await retry.tick();
    expect(pending.get({ circleContract: fx.circle.accountId, payer: identity.scraper.accountId, payee: identity.image.accountId, epoch: epoch.epoch })).toMatchObject({ attempts: 2, state: "retrying" });
    const blocked = await scraperPaid(`${urls.image}/api/image?input=halo`);
    expect(blocked.status).toBe(402);
    expect(decode(blocked.headers.get("PAYMENT-REQUIRED")).error).toBe("registration_retry_pending");
    clock += 10_000;
    await retry.tick();
    expect(pending.get({ circleContract: fx.circle.accountId, payer: identity.scraper.accountId, payee: identity.image.accountId, epoch: epoch.epoch })).toMatchObject({ attempts: 0, state: "registered" });
    expect((await scraperPaid(`${urls.image}/api/image?input=halo`)).status).toBe(200);
  }, 900_000);
});
