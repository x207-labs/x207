// UM-115 (#62): cloud promotional credit, group C of P2 (ADR-47), in near-sandbox. A cloud project of the grantor has a pool of promotional credit; the grantor lets another person work in the project
// with a DAILY budget that the PROVIDER keeps, and is paid by the day. It is a project membership, not a transfer of the credit: promotional credit is usually not transferable, and the catalog entry
// says so. Real contract, indexer, read API, facilitator and access broker; the cloud project is a mock members API in memory that the REAL `org-member-budget` adapter of the broker talks to:
//   - the lessee pays one day with an ordinary voucher: the broker invites the e-mail of the scope with its role and its DAILY budget, which the PROVIDER keeps (a spend past it is refused there);
//   - the person accepts and spends; the read of the access shows the real spend of the day in credit units (the cost that x207 bills, BE-059);
//   - a second day paid before the first ends moves the paid end by one day and keeps the same member;
//   - a day that is not paid ends: at the paid end the broker removes the member and the next spend is refused by the organisation.
// Run: X207_SANDBOX=1 npx vitest run tests/cloud-credit.sandbox.test.ts
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { type ContractAbi } from "@x207/core";
import { Indexer, FailoverRpcClient, RpcBlockSource, createApiServer, openDatabase, rpcChainReader } from "../backend/src/index.ts";
import { viewClearedEdges } from "../backend/src/indexer/view-edges.ts";
import { OrgMemberBudgetAdapter, startBroker, type FetchLike, type RunningBroker } from "../backend/broker/src/index.ts";
import { createAgentBuyer } from "../agents/shared/x207.ts";
import { startStack, type Stack } from "../agents/test/stack.ts";
import { sandboxAvailable } from "../sdk/test-support/sandbox.ts";

const DAY_MS = 86_400_000;
const PRICE = "50000"; // 0.05 credit a day, under the spend policy of the agents (0.1 per call)

const trace = (m: string): void => void process.stderr.write(`[cloud-credit ${new Date().toISOString()}] ${m}\n`);

describe.skipIf(!sandboxAvailable)("UM-115 cloud credit as a project member with a daily budget in near-sandbox (#62): invited for a paid day, the provider keeps the daily budget, removed when the day is not paid", () => {
  let stack: Stack | undefined;
  let api: Server | undefined;
  let broker: RunningBroker | undefined;
  afterAll(async () => {
    await broker?.stop();
    api?.closeAllConnections?.();
    api?.close();
    await stack?.stop();
  });

  it("TC-UM-115-02 a paid day invites the project member with its daily budget, the provider refuses a spend past the budget, the real spend is shown and billed, a second day moves the end, and an unpaid day removes the member", async () => {
    const clock = { offsetMs: 0 };
    trace("start");
    stack = await startStack({ now: () => Date.now() + clock.offsetMs });
    const { fx, identity: id } = stack;
    const { sandbox } = fx;
    const rpcUrl = sandbox.rpcUrl;
    const contract = fx.circle.accountId;
    const view = <T>(method: string, args: object = {}) => sandbox.view<T>(contract, method, args);

    // the owner registers the asset type of the catalog that this rent serves (#62)
    const dao = await sandbox.createAccount("dao", "10");
    const entry = { asset_type: "cloud:credit", class: "B", delivery_methods: ["project_member"], accepted_proofs: [], terms_hash: "ab".repeat(32) };
    expect((await dao.call({ receiverId: contract, methodName: "set_asset_class", args: { asset_type: "cloud:credit", entry }, deposit: 0n })).failures).toEqual([]);

    const db = openDatabase(":memory:");
    const indexer = new Indexer({
      db, source: new RpcBlockSource(rpcChainReader(new FailoverRpcClient({ endpoints: [rpcUrl] })), contract, 1), circleId: "agents-main",
      contractId: contract, startBlock: 1, fetchParams: () => view<ContractAbi.Params>("get_params"),
      fetchClearedEdges: (epoch) => viewClearedEdges(rpcUrl, contract, epoch),
    });
    await indexer.bootstrap();
    api = createApiServer({ db });
    await new Promise<void>((resolve) => api!.listen(0, "127.0.0.1", resolve));
    const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    const drain = async (until: () => boolean) => {
      for (let i = 0; i < 60; i++) {
        await indexer.drain();
        if (until()) return;
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error("indexer did not reach the expected state");
    };
    const count = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);
    await drain(() => count("select count(*) as n from members where status = 'active'") >= 6);
    trace("indexer has the members");

    // ---- the cloud project: a members API in memory, spoken to through the REAL adapter of the broker (invite, set the budget, read the spend, remove)
    const now = () => Date.now() + clock.offsetMs;
    const ADMIN = "ORG_ADMIN_SECRET_TOKEN";
    const members = new Map<string, { email: string; role: string; status: string; budget: number; spent: number }>();
    const orgCalls: string[] = [];
    let seq = 0;
    const orgFetch = (async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      const method = init?.method ?? "GET";
      orgCalls.push(`${method} ${u.pathname}`);
      if ((init?.headers as Record<string, string> | undefined)?.authorization !== `Bearer ${ADMIN}`) return new Response("{}", { status: 401 });
      if (u.pathname === "/org/members" && method === "POST") {
        const b = JSON.parse(String(init!.body));
        const id = `member-${++seq}`;
        members.set(id, { email: b.email, role: b.role, status: "invited", budget: b.daily_budget, spent: 0 });
        return new Response(JSON.stringify({ id, status: "invited" }), { status: 201 });
      }
      const m = /^\/org\/members\/([\w-]+)$/.exec(u.pathname);
      const x = m ? members.get(m[1]!) : undefined;
      if (!m || !x || x.status === "removed") return new Response("{}", { status: 404 });
      if (method === "GET") return new Response(JSON.stringify({ id: m[1], email: x.email, role: x.role, status: x.status, daily_budget: x.budget, spent_today: x.spent }), { status: 200 });
      if (method === "PUT") { const b = JSON.parse(String(init!.body)); x.role = b.role; x.budget = b.daily_budget; return new Response("{}", { status: 200 }); }
      if (method === "DELETE") { x.status = "removed"; return new Response(null, { status: 204 }); }
      return new Response("{}", { status: 405 });
    }) as unknown as FetchLike;
    /** The person spends `usd` at the organisation: refused past the daily budget and when it is not an active member. */
    const spend = (id: string, usd: number): number => {
      const x = members.get(id)!;
      if (x.status !== "active") return 403;
      if (x.spent + usd > x.budget) return 402;
      x.spent += usd;
      return 200;
    };
    const org = new OrgMemberBudgetAdapter({ baseUrl: "https://org.test/org", token: ADMIN, allowedRoles: ["editor", "viewer"], fetch: orgFetch, now });
    const brokerAccount = await sandbox.createAccount("broker", "10");
    const lease = await sandbox.createAccount("lease", "10");
    broker = await startBroker({
      config: {
        readApiUrl: apiUrl, circleId: "agents-main", contractId: contract, facilitatorUrl: stack.facilitatorUrl, rpcUrl,
        brokerAccount: brokerAccount.accountId, brokerKey: brokerAccount.secretKey, leaseAccount: lease.accountId, leaseKey: lease.secretKey,
        port: 0, dbPath: ":memory:", pollSeconds: 15, providers: [],
      },
      providerAdapters: [org],
      now, poll: false, extraCacheMs: 0,
    });
    const brokerUrl = broker.url;
    const advanceTo = async (ms: number) => {
      // UM-182: only the clock of the broker and the facilitator moves, not the chain. Two days of block time are 172,800 blocks; on the CI runner the sandbox does 500 blocks in about 2.8 s
      // (CI run 42011918002: 121 s per 6 hours), so the advance alone needs about 16 minutes, more than the 900 s of this test, and the sandbox process died during it (ECONNREFUSED).
      // The end of the paid day is read from `now()` (the provider adapter and the lease), and `revoke_grant` by the operator does not look at block time, so the chain can stay where it is.
      clock.offsetMs = ms - Date.now();
      trace(`clock moved to ${new Date(ms).toISOString()} (chain block time stays ${new Date(await sandbox.blockTimestampMs()).toISOString()})`);
    };

    const offer = async (grantor: "scraper" | "gpu" | "cleaner", assetType: string, delivery: string, scope: object): Promise<number> => {
      const expires = (await sandbox.blockTimestampMs()) + 30 * DAY_MS;
      const r = await fx.members.get(grantor)!.call({
        receiverId: contract, methodName: "offer_grant", deposit: 0n,
        args: {
          input: {
            asset_type: assetType, delivery_method: delivery, limits: { scope: JSON.stringify(scope), quota: null, expires_at: (BigInt(expires) * 1_000_000n).toString() },
            unit: "day", unit_price: PRICE, operator: brokerAccount.accountId, proof_hash: null, proof_kind: null,
          },
        },
      });
      expect(r.failures).toEqual([]);
      return Number(r.value);
    };
    const accept = async (lessee: "translator" | "image" | "summarizer", grantId: number) => {
      const r = await fx.members.get(lessee)!.call({ receiverId: contract, methodName: "accept_grant", args: { grant_id: grantId, delivery_pubkey: "ed25519:7YkYUwHgD8gM4tUQbkcGzMfqMPXK9RSTkUmqm9Fa8qpT" }, deposit: 0n });
      expect(r.failures).toEqual([]);
    };
    /** One day of rent: the agent's x402 client answers the 402 of the broker with an ordinary voucher through the facilitator. */
    const payDay = async (lessee: "translator" | "image" | "summarizer", grantId: number, granteeRef: string, proof?: string) => {
      const buy = createAgentBuyer(id[lessee], { rpcUrls: [rpcUrl] });
      const response = await buy(`${brokerUrl}/grants/${grantId}/access`, { method: "POST", body: JSON.stringify({ grantee_ref: granteeRef, ...(proof ? { proof } : {}) }), headers: { "content-type": "application/json" } });
      return { response, body: (await response.json()) as Record<string, any> };
    };
    const accessView = async (grantId: number) => (await (await fetch(`${brokerUrl}/grants/${grantId}/access`)).json()) as Record<string, any>;


    // every transaction of the chain goes first: after the clock of the sandbox has been moved by days, a transaction that the test signs is "expired"
    const grant = await offer("scraper", "cloud:credit", "project_member", { provider: "org-member-budget", grantee_ref: "andi@example.org", resource: "20", permission: "editor" });
    await accept("translator", grant);
    trace("grant accepted");
    expect(members.size).toBe(0);
    trace("paying day 1");

    // ---------------- a paid day: the member is invited with its budget; the organisation keeps the budget ----------------
    const day1 = await payDay("translator", grant, "andi@example.org");
    expect(day1.response.status, JSON.stringify(day1.body)).toBe(200);
    expect(day1.body).toMatchObject({ grantId: grant, provider: "org-member-budget", status: "active", delivery: { provider: "org-member-budget", email: "andi@example.org", role: "editor", dailyBudgetUsd: 20 } });
    expect(members.get("member-1")).toMatchObject({ email: "andi@example.org", role: "editor", status: "invited", budget: 20 });
    trace("day 1 paid");
    members.get("member-1")!.status = "active"; // the person accepted the invitation of the project
    expect([spend("member-1", 12), spend("member-1", 10), spend("member-1", 8)]).toEqual([200, 402, 200]); // 12 + 10 would pass 20: refused by the PROVIDER; 12 + 8 = 20 is the whole budget
    const shown = await accessView(grant);
    expect(shown.today.cost).toBe("20000000"); // the real spend of the day in credit units (20 USD at 1 credit a USD)
    const paid1 = Date.parse(day1.body.paidUntil);

    // ---------------- a second day paid before the first ends: the same member, the end moves by a day ----------------
    trace("paying day 2");
    const day2 = await payDay("translator", grant, "andi@example.org");
    expect(day2.response.status, JSON.stringify(day2.body)).toBe(200);
    expect(Date.parse(day2.body.paidUntil)).toBe(paid1 + DAY_MS);
    expect(members.size).toBe(1); // no second invitation
    expect(orgCalls.filter((c) => c.startsWith("POST"))).toHaveLength(1);
    const paid2 = Date.parse(day2.body.paidUntil);

    // ---------------- the day that nobody pays: at the paid end the broker removes the member ----------------
    trace("day 2 paid, advancing");
    await advanceTo(paid2 + 60_000);
    await broker.tick();
    expect((await accessView(grant)).status).not.toBe("active");    trace("advanced, ticking");

    expect(members.get("member-1")!.status).toBe("removed");
    expect(spend("member-1", 1)).toBe(403); // the provider refuses a removed member
    expect(orgCalls.filter((c) => c.startsWith("DELETE"))).toHaveLength(1);
    expect(JSON.stringify(orgCalls)).not.toContain(ADMIN); // the token is a header of the broker, never in a path
    expect(JSON.stringify(day1.body) + JSON.stringify(day2.body) + JSON.stringify(shown)).not.toContain(ADMIN);
    console.log(["UM-115 #62", `grant ${grant} paid until ${new Date(paid2).toISOString()} then the member was removed`, `spend ${shown.today.cost} credit units`, `project calls ${orgCalls.length}`].join(" | "));
  }, 900_000);
});
