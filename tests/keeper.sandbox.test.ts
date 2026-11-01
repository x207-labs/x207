// UM-022: keeper epoch di near-sandbox. Waktu blok dimajukan dengan sandbox_fast_forward.
import { afterAll, describe, expect, it } from "vitest";
import { parseEventLog, type ContractAbi } from "@x207/core";
import { deployCircle, type CircleFixture } from "../sdk/test-support/circle.ts";
import { sandboxAvailable } from "../sdk/test-support/sandbox.ts";
import { keeperPass } from "../scripts/lib/keeper.mjs";

describe.skipIf(!sandboxAvailable)("UM-022 keeper", () => {
  let fx: CircleFixture;
  afterAll(async () => {
    await fx?.stop();
  });

  it("TC-UM-022-01..06 close_epoch, commit_epoch, finalize_epoch tepat sekali pada waktunya", async () => {
    fx = await deployCircle();
    const keeper = await fx.sandbox.createAccount("keeper", "20");
    const events: Array<{ event: string }> = [];
    const log: object[] = [];
    const pass = () =>
      keeperPass({
        log: (entry: object) => log.push(entry),
        view: (method: string, args: object) => fx.sandbox.view(fx.circle.accountId, method, args),
        chainNowMs: () => fx.sandbox.blockTimestampMs(),
        send: async ({ methodName, args }: { methodName: string; args: object }) => {
          const result = await fx.sandbox.accountFrom(keeper.accountId, keeper.secretKey).call(
            { receiverId: fx.circle.accountId, methodName, args, deposit: 0n }, "EXECUTED_OPTIMISTIC",
          );
          if (result.failures.length > 0) throw new Error(result.failures.join("; "));
          for (const line of result.logs) events.push(...((parseEventLog(line) ?? []) as Array<{ event: string }>));
          return result.hash;
        },
      }) as Promise<Array<{ method: string; epoch: number; hash: string }>>;
    const settle = () => new Promise((r) => setTimeout(r, 3_000));
    const epochView = (epoch?: number) => fx.sandbox.view<ContractAbi.EpochView>(fx.circle.accountId, "get_epoch", epoch ? { epoch } : {});

    // 01: sebelum cutoff_at tidak ada transaksi
    expect(await pass()).toEqual([]);

    // 02: lewat cutoff_at -> tepat satu close_epoch(1), epoch 2 open
    const first = await epochView();
    await fx.sandbox.advanceTo(Number(BigInt(first.cutoff_at) / 1_000_000n) + 1_000);
    await settle();
    const closed = await pass();
    expect(closed.map((a) => [a.method, a.epoch])).toEqual([["close_epoch", 1]]);
    expect(events.filter((e) => e.event === "epoch_cutoff")).toHaveLength(1);
    expect((await epochView()).epoch).toBe(2);
    // 05: keeper dinyalakan ulang membaca fase dari get_epoch dan tidak mengulang close_epoch
    expect(await pass()).toEqual([]);

    // 03: lewat proposal_deadline -> tepat satu commit_epoch(1)
    const clearing = await epochView(1);
    await fx.sandbox.advanceTo(Number(BigInt(clearing.proposal_deadline!) / 1_000_000n) + 1_000);
    await settle();
    const committed = await pass();
    expect(committed.map((a) => [a.method, a.epoch])).toEqual([["commit_epoch", 1]]);
    expect(events.map((e) => e.event)).toContain("epoch_committed");
    expect(await pass()).toEqual([]);

    // 04: lewat payment_deadline -> tepat satu finalize_epoch(1)
    const paying = await epochView(1);
    await fx.sandbox.advanceTo(Number(BigInt(paying.payment_deadline!) / 1_000_000n) + 1_000);
    await settle();
    const everything = await pass();
    // Waktu sudah melewati cutoff_at epoch 2, jadi keeper juga menutup epoch 2; langkah epoch 1 tetap tepat satu.
    expect(everything.filter((a) => a.epoch === 1).map((a) => a.method)).toEqual(["finalize_epoch"]);
    expect(everything.filter((a) => a.epoch === 2).map((a) => a.method)).toEqual(["close_epoch"]);
    const finalized = everything.filter((a) => a.epoch === 1);
    expect(events.map((e) => e.event)).toContain("epoch_finalized");

    // 06: log memuat tiga hash dengan waktu kirim, tanpa input operator
    const hashes = [...closed, ...committed, ...finalized].map((a) => a.hash);
    expect(hashes).toHaveLength(3);
    expect(new Set(hashes).size).toBe(3);
    expect(log).toHaveLength(4);
    expect(log.every((l) => typeof (l as { at: string }).at === "string")).toBe(true);
  }, 600_000);
});
