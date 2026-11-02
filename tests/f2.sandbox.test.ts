// UM-023: F2 end-to-end di near-sandbox dengan kontrak, facilitator, dan enam agent nyata (kode agents/ dan sdk/).
// 402 -> PAYMENT-SIGNATURE voucher -> registrasi ambang -> PAYMENT-RESPONSE, ratusan panggilan, dan penolakan.
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

    // 01: tanpa header pembayaran -> 402 dengan entri batch-settlement dan extra.epoch berjalan
    const challenge = await fetch(`${urls.summarizer}/api/summarize?input=halo`);
    expect(challenge.status).toBe(402);
    const accepts = decode(challenge.headers.get("PAYMENT-REQUIRED")).accepts as Array<{ scheme: string; network: string; extra: { epoch: number } }>;
    expect(accepts[0]).toMatchObject({ scheme: "batch-settlement", network: "x207:agents-main", extra: { epoch: epoch.epoch } });

    // Penjadwal dengan ambang bawaan (1 credit) berjalan selama panggilan; event registrasi dihitung dari log transaksi.
    const registrations: string[][] = [];
    const schedulerLog: unknown[] = [];
    // Jam penjadwal bisa dimajukan (`skewMs`) untuk masuk ke jendela flush sebelum cutoff; dipakai sekali, setelah semua panggilan selesai.
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

    // 03: 300 panggilan berurutan, lalu flush
    for (let i = 2; i <= 300; i++) {
      const response = await paid(`${urls.summarizer}/api/summarize?input=halo`);
      expect(response.status, `panggilan ${i}`).toBe(200);
    }
    scheduler.stop();
    // Sisa di bawah ambang (1 credit) memang tidak didaftarkan oleh putaran biasa: ia menunggu jendela flush sebelum `cutoff_at`
    // (Spec Binding x402 6.3). Berapa banyak yang sudah terdaftar saat panggilan berakhir bergantung pada kecepatan RPC, jadi tanpa
    // langkah ini hasil akhir ikut tergantung pada waktu. Majukan jam penjadwal ke 60 detik sebelum cutoff, lalu tunggu semua baris lunas.
    const cutoffMs = Number(BigInt(epoch.cutoff_at) / 1_000_000n);
    skewMs = Math.max(0, cutoffMs - 60_000 - Date.now());
    // Putaran berkala yang masih berjalan membuat tick() berikutnya dilewati; ulangi sampai tidak ada baris terbuka.
    for (let i = 0; i < 60 && pending.listOpen(fx.circle.accountId).length > 0; i++) {
      await scheduler.tick();
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(pending.listOpen(fx.circle.accountId), "baris registrasi masih terbuka setelah 30 detik").toEqual([]);
    console.log("scheduler", JSON.stringify(schedulerLog.slice(0, 6)), "registrations", registrations.length);
    const pair = { epoch: epoch.epoch, debtor: translator.accountId, creditor: summarizer.accountId };
    const obligation = await fx.sandbox.view<ContractAbi.ObligationView>(fx.circle.accountId, "obligation", pair);
    expect(obligation).toMatchObject({ cumulative: "6000000", last_seq: 300 });

    // 04: jumlah registrasi untuk pasangan itu jauh di bawah jumlah panggilan
    const events = registrations.flatMap((logs) => logs.flatMap((l) => parseEventLog(l) ?? []));
    const forPair = events.filter(
      (e) => e.event === "voucher_registered" && (e as { payer: string; payee: string }).payer === translator.accountId && (e as { payee: string }).payee === summarizer.accountId,
    );
    expect(forPair.length).toBeLessThanOrEqual(7);
    expect(forPair.length).toBeLessThan(300 * 0.05);

    // 05: kenaikan melebihi headroom -> insufficient_credit; obligation on-chain tetap
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

    // 06: seq yang sudah dipakai -> seq_not_increasing
    expect(await verify(voucherBody(300, "6000000", "20000"))).toMatchObject({ isValid: false, invalidReason: "seq_not_increasing" });
    expect(await fx.sandbox.view<ContractAbi.ObligationView>(fx.circle.accountId, "obligation", pair)).toMatchObject({ cumulative: "6000000", last_seq: 300 });

    // 07: RPC registrasi mati dua kali -> retrying, voucher baru ditolak, lalu pulih
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
