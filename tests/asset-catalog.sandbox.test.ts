// UM-075 in near-sandbox: the whole barter catalog goes into the registry D10 through the script, `list_asset_classes` returns all of it, the script is idempotent, and an
// offer of a refused kind (class X) is refused by the contract. Run: X207_SANDBOX=1 npx vitest run tests/asset-catalog.sandbox.test.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { createCircleViewFn, onboardMember, type ContractCall } from "@x207/core";
import { CATALOG, registerCatalog, toArgs } from "../scripts/lib/asset-catalog.mjs";
import { TERMS_HASH, deployCircle, type CircleFixture } from "../sdk/test-support/circle.ts";
import { sandboxAvailable } from "../sdk/test-support/sandbox.ts";

const run = promisify(execFile);

describe.skipIf(!sandboxAvailable)("UM-075 barter catalog in the registry D10", () => {
  let fx: CircleFixture;
  afterAll(async () => {
    await fx?.stop();
  });

  it("TC-UM-075-10 the script registers 94 entries, list_asset_classes returns all with their class, and a second run writes nothing", async () => {
    fx = await deployCircle();
    const dao = await fx.sandbox.createAccount("dao", "10"); // the owner of the fixture
    const base = ["scripts/register-asset-classes.mjs", "--rpc-url", fx.sandbox.rpcUrl, "--contract", fx.circle.accountId];

    // a dry run needs no key and writes nothing
    const dry = await run("node", [...base, "--dry-run"]);
    expect(JSON.parse(dry.stdout.trim().split("\n").pop()!).summary).toMatchObject({ catalog: 94, written: 94, skipped: 0, dryRun: true });
    expect(await fx.sandbox.view<unknown[]>(fx.circle.accountId, "list_asset_classes", { from_index: 0, limit: 100 })).toEqual([]);

    const real = await run("node", [...base, "--owner", dao.accountId], { env: { ...process.env, OWNER_SECRET_KEY: dao.secretKey }, maxBuffer: 10 * 1024 * 1024 });
    const lines = real.stdout.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.at(-1).summary).toMatchObject({ catalog: 94, written: 94, skipped: 0, missing: [], wrong: [], registry: 94, dryRun: false });
    expect(real.stdout).not.toContain(dao.secretKey);

    // the registry, read back page by page, holds every entry of the catalog with its class
    const listed: Array<{ asset_type: string; class: string; delivery_methods: string[]; accepted_proofs: string[]; terms_hash: string }> = [];
    for (let from = 0; ; from += 25) {
      const page = await fx.sandbox.view<typeof listed>(fx.circle.accountId, "list_asset_classes", { from_index: from, limit: 25 });
      listed.push(...page);
      if (page.length < 25) break;
    }
    expect(listed).toHaveLength(94);
    expect(listed.map((e) => e.asset_type)).toEqual(CATALOG.map((e) => e.assetType)); // in registration order = catalog order
    const count = (cls: string) => listed.filter((e) => e.class === cls).length;
    expect([count("A"), count("B"), count("C"), count("D"), count("X")]).toEqual([14, 20, 16, 35, 9]);
    for (const e of CATALOG) expect(listed.find((l) => l.asset_type === e.assetType)).toEqual(toArgs(e).entry);
    expect(await fx.sandbox.view(fx.circle.accountId, "get_asset_class", { asset_type: "securities:equity" })).toMatchObject({ class: "X" });

    // idempotent: the same catalog again writes nothing
    const view = (method: string, args: object) => fx.sandbox.view(fx.circle.accountId, method, args);
    const second = await registerCatalog({ view, send: async () => { throw new Error("nothing should be written"); } });
    expect(second).toMatchObject({ written: [], missing: [], wrong: [], total: 94 });
  }, 900_000);

  it("TC-UM-075-11 an offer of a refused kind (class X) is refused by the contract, and an offer of a registered one passes the registry checks", async () => {
    const account = await fx.member("seller");
    const view = createCircleViewFn({ circleContract: fx.circle.accountId, rpcUrls: [fx.sandbox.rpcUrl] });
    await onboardMember(
      { sendCall: async (c: ContractCall) => { const r = await account.call(c); if (r.failures.length > 0) throw new Error(r.failures.join("; ")); return r.value; }, view, pollIntervalMs: 200, timeoutMs: 60_000 },
      { circleContract: fx.circle.accountId, circleId: fx.circleId, accountId: account.accountId, termsHash: TERMS_HASH, stakeAmount: "50000000", usdtTokenId: fx.usdt.accountId },
    );
    const offer = (asset_type: string, delivery_method: string) =>
      account.call({
        receiverId: fx.circle.accountId, methodName: "offer_grant", deposit: 0n,
        args: { input: { asset_type, delivery_method, limits: { scope: "{}", quota: null, expires_at: ((BigInt(Date.now()) + 86_400_000n) * 1_000_000n).toString() }, unit: "call", unit_price: "1000", operator: null, proof_hash: null, proof_kind: null } },
      });
    const refused = await offer("securities:equity", "none");
    expect(refused.failures.join(" ")).toContain("ERR_ASSET_CLASS_FORBIDDEN");
    const unknown = await offer("not:registered", "x402_endpoint");
    expect(unknown.failures.join(" ")).toContain("ERR_ASSET_TYPE_UNKNOWN");
    const wrongMethod = await offer("compute:gpu-hours", "escrow_nft");
    expect(wrongMethod.failures.join(" ")).toContain("ERR_DELIVERY_NOT_ALLOWED");
    const ok = await offer("compute:gpu-hours", "x402_endpoint");
    expect(ok.failures).toEqual([]);
    expect(await fx.sandbox.view(fx.circle.accountId, "get_grant", { grant_id: Number(ok.value) })).toMatchObject({ asset_type: "compute:gpu-hours", class: "D", status: "offered" });
  }, 600_000);
});
