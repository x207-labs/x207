// UM-025: e2e penuh di near-sandbox tanpa backend dan solver: join + stake, voucher F2, close/submit/commit,
// settle + claim, dan skenario default. Proposal kliring dihitung tangan dari graf cincin tiga simpul.
import { afterAll, describe, expect, it } from "vitest";
import {
  buildClaimCall, buildSettleTransferCall, createCircleViewFn, onboardMember, signVoucher,
  type ContractAbi, type ContractCall,
} from "@x207/core";
import { TERMS_HASH, deployCircle, type CircleFixture } from "../sdk/test-support/circle.ts";
import { sandboxAvailable, type SandboxAccount } from "../sdk/test-support/sandbox.ts";

const NAMES = ["translator", "summarizer", "scraper", "image", "cleaner", "gpu"] as const;
type Member = { account: SandboxAccount; secretKey: `ed25519:${string}` };
type Position = { account_id: string; role: string; status: string | null; amount: string };

async function setup(fx: CircleFixture) {
  const view = createCircleViewFn({ circleContract: fx.circle.accountId, rpcUrls: [fx.sandbox.rpcUrl] });
  const members = {} as Record<(typeof NAMES)[number], Member>;
  for (const name of NAMES) {
    const account = await fx.member(name);
    const joined = await onboardMember(
      {
        sendCall: async (c: ContractCall) => {
          const r = await account.call(c);
          if (r.failures.length > 0) throw new Error(r.failures.join("; "));
          return r.value;
        },
        view, pollIntervalMs: 200, timeoutMs: 30_000,
      },
      { circleContract: fx.circle.accountId, circleId: fx.circleId, accountId: account.accountId, termsHash: TERMS_HASH, stakeAmount: "50000000", usdtTokenId: fx.usdt.accountId },
    );
    members[name] = { account, secretKey: joined.secretKey };
  }
  return members;
}

const send = async (fx: CircleFixture, who: SandboxAccount, call: Pick<ContractCall, "receiverId" | "methodName" | "args" | "deposit" | "gas">) =>
  fx.sandbox.accountFrom(who.accountId, who.secretKey).call(call, "EXECUTED_OPTIMISTIC");

async function register(fx: CircleFixture, payer: Member, payee: Member, epoch: number, cumulative: string) {
  const { signature, ...voucher } = signVoucher(
    { circle: fx.circle.accountId, payer: payer.account.accountId, payee: payee.account.accountId, epoch, seq: 1, cumulativeAmount: cumulative, unit: "credit", resource: "https://seller.example/api" },
    payer.secretKey,
  );
  const r = await payer.account.call({ receiverId: fx.circle.accountId, methodName: "register_cumulative", args: { voucher, signature }, deposit: 0n, gas: 100_000_000_000_000n }, "EXECUTED_OPTIMISTIC");
  expect(r.failures).toEqual([]);
}

const at = async (fx: CircleFixture, ns: string | null | undefined) => {
  await fx.sandbox.advanceTo(Number(BigInt(ns!) / 1_000_000n) + 1_000);
  await new Promise((r) => setTimeout(r, 3_000));
};
const epochOf = (fx: CircleFixture, epoch: number) => fx.sandbox.view<ContractAbi.EpochView>(fx.circle.accountId, "get_epoch", { epoch });
const positions = (fx: CircleFixture, epoch: number) =>
  fx.sandbox.view<Position[]>(fx.circle.accountId, "list_positions", { epoch, from_index: 0, limit: 100 });

/** Cincin translator -> summarizer (10) -> scraper (8) -> translator (6); kliring 6 per sisi. */
async function ringThroughCommit(fx: CircleFixture, m: Awaited<ReturnType<typeof setup>>) {
  const first = await fx.sandbox.view<ContractAbi.EpochView>(fx.circle.accountId, "get_epoch", {});
  const epoch = first.epoch;
  await register(fx, m.translator, m.summarizer, epoch, "10000000");
  await register(fx, m.summarizer, m.scraper, epoch, "8000000");
  await register(fx, m.scraper, m.translator, epoch, "6000000");
  await at(fx, first.cutoff_at);
  expect((await send(fx, m.translator.account, { receiverId: fx.circle.accountId, methodName: "close_epoch", args: { epoch }, deposit: 0n })).failures).toEqual([]);
  const closing = await epochOf(fx, epoch);
  const edge = (a: Member, b: Member) => ({ debtor: a.account.accountId, creditor: b.account.accountId, cleared: "6000000" });
  const submitted = await send(fx, m.gpu.account, {
    receiverId: fx.circle.accountId, methodName: "submit_clearing",
    args: { epoch, edges: [edge(m.translator, m.summarizer), edge(m.summarizer, m.scraper), edge(m.scraper, m.translator)] },
    deposit: 0n, gas: 100_000_000_000_000n,
  });
  expect(submitted.failures).toEqual([]);
  await at(fx, closing.proposal_deadline);
  const committed = await send(fx, m.gpu.account, { receiverId: fx.circle.accountId, methodName: "commit_epoch", args: { epoch }, deposit: 0n, gas: 200_000_000_000_000n });
  expect(committed.failures).toEqual([]);
  return { epoch, paying: await epochOf(fx, epoch) };
}

describe.skipIf(!sandboxAvailable)("UM-025 e2e penuh di near-sandbox", () => {
  const fixtures: CircleFixture[] = [];
  afterAll(async () => {
    await Promise.all(fixtures.map((f) => f.stop()));
  });

  it("TC-UM-025-01..04 join, voucher, clearing, claim before finalize rejected, settle, finalize, claim", async () => {
    const fx = await deployCircle();
    fixtures.push(fx);
    const m = await setup(fx);
    for (const name of NAMES) {
      const member = await fx.sandbox.view<ContractAbi.MemberView>(fx.circle.accountId, "member", { account_id: m[name].account.accountId });
      expect(member.status).toBe("active");
      expect(BigInt(member.limit)).toBeGreaterThan(0n);
      expect(BigInt(member.limit)).toBeLessThanOrEqual(BigInt(member.stake));
    }

    const { epoch, paying } = await ringThroughCommit(fx, m);
    const after = await positions(fx, epoch);
    const sum = (role: string) => after.filter((p) => p.role === role).reduce((s, p) => s + BigInt(p.amount), 0n);
    expect(sum("debtor")).toBe(4_000_000n);
    expect(sum("debtor")).toBe(sum("creditor"));

    // 03: claim sebelum finalize_epoch ditolak, status tetap claimable
    const early = await send(fx, m.summarizer.account, buildClaimCall({ circleContract: fx.circle.accountId, epoch, destination: "near" }));
    expect(early.failures.join(" ")).toMatch(/ERR_NOT_FINALIZED/);
    expect((await positions(fx, epoch)).filter((p) => p.role === "creditor").every((p) => p.status === "claimable")).toBe(true);

    // 04: debtor membayar, finalize, kreditor klaim
    const pay = await send(fx, m.translator.account, buildSettleTransferCall({ circleContract: fx.circle.accountId, amount: "4000000", epoch, usdtTokenId: fx.usdt.accountId }));
    expect(pay.failures).toEqual([]);
    await at(fx, paying.payment_deadline);
    expect((await send(fx, m.gpu.account, { receiverId: fx.circle.accountId, methodName: "finalize_epoch", args: { epoch }, deposit: 0n, gas: 200_000_000_000_000n })).failures).toEqual([]);
    for (const creditor of [m.summarizer, m.scraper]) {
      const claimed = await send(fx, creditor.account, buildClaimCall({ circleContract: fx.circle.accountId, epoch, destination: "near" }));
      expect(claimed.failures).toEqual([]);
    }
    await new Promise((r) => setTimeout(r, 3_000));
    const final = await positions(fx, epoch);
    expect(final.find((p) => p.role === "debtor")?.status).toBe("paid");
    expect(final.filter((p) => p.role === "creditor").map((p) => p.status)).toEqual(["claimed", "claimed"]);
    expect(final.some((p) => p.status === "due" || p.status === "claimable")).toBe(false);
    const pool = await fx.sandbox.view<{ epoch_pools: string }>(fx.circle.accountId, "get_pool", {});
    expect(pool.epoch_pools).toBe("0");
  }, 900_000);

  it("TC-UM-025-05 debtor does not pay: defaulted, stake slashed by due, suspended, limit 0, creditor paid in full", async () => {
    const fx = await deployCircle();
    fixtures.push(fx);
    const m = await setup(fx);
    const { epoch, paying } = await ringThroughCommit(fx, m);
    await at(fx, paying.payment_deadline);
    expect((await send(fx, m.gpu.account, { receiverId: fx.circle.accountId, methodName: "finalize_epoch", args: { epoch }, deposit: 0n, gas: 200_000_000_000_000n })).failures).toEqual([]);
    await new Promise((r) => setTimeout(r, 3_000));

    const debtor = await fx.sandbox.view<ContractAbi.MemberView>(fx.circle.accountId, "member", { account_id: m.translator.account.accountId });
    expect(debtor).toMatchObject({ status: "suspended", limit: "0", stake: "46000000" });
    expect((await positions(fx, epoch)).find((p) => p.role === "debtor")?.status).toBe("defaulted");
    for (const creditor of [m.summarizer, m.scraper]) {
      const claimed = await send(fx, creditor.account, buildClaimCall({ circleContract: fx.circle.accountId, epoch, destination: "near" }));
      expect(claimed.failures).toEqual([]);
    }
    await new Promise((r) => setTimeout(r, 3_000));
    expect((await positions(fx, epoch)).filter((p) => p.role === "creditor").map((p) => p.status)).toEqual(["claimed", "claimed"]);
  }, 900_000);
});
