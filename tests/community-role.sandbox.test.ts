// UM-099: a paid community role (#24) and an own paid group (#85), group D of P2 (ADR-47), in near-sandbox: real contract, indexer, read API, facilitator and access broker; the community is a
// Discord server in memory that the REAL Discord adapter of the broker talks to with the REST calls of Discord (a role of a member, given and taken back by the bot of the grantor):
//   - #24 paid role: paid for a day, the member holds the role; paid again before the day ends (the day is added to the paid end); a day with no payment ends, and the broker takes the role away;
//   - #85 own group: the owner of the community rents its member role by the day; the member stops paying because it is leaving the circle (`request_exit`), the agent of the member cannot sign a voucher for the next day
//     (no headroom for an exiting member), and at the end of the paid day the broker takes the role away.
// Run: X207_SANDBOX=1 npx vitest run tests/community-role.sandbox.test.ts
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { buildRequestExitCall, type AccessGrant, type ContractAbi } from "@x207/core";
import { Indexer, FailoverRpcClient, RpcBlockSource, createApiServer, openDatabase, rpcChainReader } from "../backend/src/index.ts";
import { viewClearedEdges } from "../backend/src/indexer/view-edges.ts";
import { DiscordAdapter, startBroker, type FetchLike, type RunningBroker } from "../backend/broker/src/index.ts";
import { createAgentBuyer } from "../agents/shared/x207.ts";
import { startStack, type Stack } from "../agents/test/stack.ts";
import { sandboxAvailable } from "../sdk/test-support/sandbox.ts";

const DAY_MS = 86_400_000;
const PRICE = "50000"; // 0.05 credit a day, under the spend policy of the agents (0.1 per call)

describe.skipIf(!sandboxAvailable)("UM-099 community roles in near-sandbox (#24 paid role, #85 own group): paid by the day, taken away when the day is not paid", () => {
  let stack: Stack | undefined;
  let api: Server | undefined;
  let broker: RunningBroker | undefined;
  afterAll(async () => {
    await broker?.stop();
    api?.closeAllConnections?.();
    api?.close();
    await stack?.stop();
  });

  it("TC-UM-099-01 a paid role is renewed day by day and taken away at the end of an unpaid day; a member that cannot pay any more loses the role of the group at the end of the paid day", async () => {
    const clock = { offsetMs: 0 };
    stack = await startStack({ now: () => Date.now() + clock.offsetMs });
    const { fx, identity: id } = stack;
    const { sandbox } = fx;
    const rpcUrl = sandbox.rpcUrl;
    const contract = fx.circle.accountId;
    const view = <T>(method: string, args: object = {}) => sandbox.view<T>(contract, method, args);

    // the owner registers the two asset types of the catalog that this rent serves
    const dao = await sandbox.createAccount("dao", "10");
    for (const [assetType, delivery] of [["community:paid-role", "community_role"], ["community:own-paid-group", "invite_or_role"]] as const) {
      const entry = { asset_type: assetType, class: "B", delivery_methods: [delivery], accepted_proofs: [], terms_hash: "ab".repeat(32) };
      expect((await dao.call({ receiverId: contract, methodName: "set_asset_class", args: { asset_type: assetType, entry }, deposit: 0n })).failures).toEqual([]);
    }

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

    // the provider: a Discord server in memory (the roles of its members), spoken to through the REAL adapter of the broker with the REST calls of Discord
    const now = () => Date.now() + clock.offsetMs;
    const GUILD = "123456789012345678";
    const ROLE_PAID = "223456789012345678";
    const ROLE_GROUP = "323456789012345678";
    const USER_A = "423456789012345678";
    const USER_B = "523456789012345678";
    const guild = new Map<string, Set<string>>([[USER_A, new Set()], [USER_B, new Set()]]);
    const calls: string[] = [];
    const discordFetch = (async (url: string, init?: RequestInit) => {
      const u = new URL(url);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${u.pathname}`);
      if ((init?.headers as Record<string, string> | undefined)?.authorization !== "Bot BOT_SECRET_TOKEN") return new Response("{}", { status: 401 });
      const member = /^\/api\/v10\/guilds\/(\d+)\/members\/(\d+)(?:\/roles\/(\d+))?$/.exec(u.pathname);
      if (!member || member[1] !== GUILD) return new Response("{}", { status: 404 });
      const roles = guild.get(member[2]!);
      if (!roles) return new Response("{}", { status: 404 });
      if (method === "GET" && member[3] === undefined) return new Response(JSON.stringify({ user: { id: member[2] }, roles: [...roles] }), { status: 200 });
      if (method === "PUT" && member[3] !== undefined) { roles.add(member[3]); return new Response(null, { status: 204 }); }
      if (method === "DELETE" && member[3] !== undefined) { roles.delete(member[3]); return new Response(null, { status: 204 }); }
      return new Response("{}", { status: 405 });
    }) as unknown as FetchLike;
    const discord = new DiscordAdapter({ botToken: "BOT_SECRET_TOKEN", guildId: GUILD, allowedRoleIds: [ROLE_PAID, ROLE_GROUP], fetch: discordFetch, baseUrl: "https://discord.test/api/v10" });
    const brokerAccount = await sandbox.createAccount("broker", "10");
    const lease = await sandbox.createAccount("lease", "10");
    broker = await startBroker({
      config: {
        readApiUrl: apiUrl, circleId: "agents-main", contractId: contract, facilitatorUrl: stack.facilitatorUrl, rpcUrl,
        brokerAccount: brokerAccount.accountId, brokerKey: brokerAccount.secretKey, leaseAccount: lease.accountId, leaseKey: lease.secretKey,
        port: 0, dbPath: ":memory:", pollSeconds: 15, providers: [],
      },
      providerAdapters: [discord],
      now, poll: false, extraCacheMs: 0,
    });
    const brokerUrl = broker.url;
    const advanceTo = async (ms: number) => {
      await sandbox.advanceTo(ms);
      clock.offsetMs = (await sandbox.blockTimestampMs()) - Date.now();
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


    const roleOf = (user: string): string[] => [...(guild.get(user) ?? [])];


    // every transaction of the chain goes first: after the clock of the sandbox has been moved by days, a transaction that the test signs is "expired"
    const roleGrant = await offer("scraper", "community:paid-role", "community_role", { provider: "discord", grantee_ref: USER_A, resource: ROLE_PAID });
    const groupGrant = await offer("gpu", "community:own-paid-group", "invite_or_role", { provider: "discord", grantee_ref: USER_B, resource: ROLE_GROUP });
    await accept("translator", roleGrant);
    await accept("image", groupGrant);
    expect([roleOf(USER_A), roleOf(USER_B)]).toEqual([[], []]);

    // ---------------- #24 paid community role: renewed before the first day ends ----------------
    const day1 = await payDay("translator", roleGrant, USER_A);
    expect(day1.response.status, JSON.stringify(day1.body)).toBe(200);
    expect(day1.body).toMatchObject({ grantId: roleGrant, provider: "discord", status: "active", delivery: { provider: "discord", guild: GUILD, role: ROLE_PAID } });
    expect(day1.body.warnings ?? []).toContain("grantee_unproven"); // no OAuth of Discord is set up on this broker: the id is only checked to be a member of the server
    expect(roleOf(USER_A)).toEqual([ROLE_PAID]);
    const paid1 = Date.parse(day1.body.paidUntil);
    await broker.tick();
    expect(roleOf(USER_A)).toEqual([ROLE_PAID]);
    const day2 = await payDay("translator", roleGrant, USER_A);
    expect(day2.response.status, JSON.stringify(day2.body)).toBe(200);
    const paid2 = Date.parse(day2.body.paidUntil);
    expect(paid2).toBe(paid1 + DAY_MS); // the day is added to the paid end

    // ---------------- #85 own paid group: the member pays a day, then cannot pay any more ----------------
    const first = await payDay("image", groupGrant, USER_B);
    expect(first.response.status, JSON.stringify(first.body)).toBe(200);
    expect(roleOf(USER_B)).toEqual([ROLE_GROUP]);
    const groupPaidUntil = Date.parse(first.body.paidUntil);
    // the member leaves the circle: the voucher of the next day is refused, so nothing is paid and nothing is added to the paid end
    const exit = await fx.members.get("image")!.call(buildRequestExitCall(contract));
    expect(exit.failures).toEqual([]);
    // the agent of the member finds no headroom to sign a voucher with, so no voucher is signed and nothing reaches the broker
    await expect(payDay("image", groupGrant, USER_B)).rejects.toThrow(/no entry can be paid/);
    expect(roleOf(USER_B)).toEqual([ROLE_GROUP]); // the paid day is still the member's

    // ---------------- the clock moves: the role of the day that nobody renewed goes first ----------------
    await advanceTo(groupPaidUntil + 60_000);
    await broker.tick();
    expect((await accessView(groupGrant)).status).not.toBe("active");
    expect(roleOf(USER_B)).toEqual([]); // the member that could not pay
    expect(roleOf(USER_A)).toEqual([ROLE_PAID]); // the member that paid a second day keeps it until the end of that day
    // no payment for the third day: at the paid end the broker takes the role away
    await advanceTo(paid2 + 60_000);
    await broker.tick();
    expect((await accessView(roleGrant)).status).not.toBe("active");
    expect(roleOf(USER_A)).toEqual([]);
    expect(calls.filter((c) => c.startsWith("DELETE")).length).toBe(2);
    expect(JSON.stringify(calls)).not.toContain("BOT_SECRET_TOKEN"); // the token is a header of the broker, never in a path
    console.log(["UM-099", `paid role grant ${roleGrant} until ${new Date(paid2).toISOString()} then removed`, `group grant ${groupGrant} removed at ${new Date(groupPaidUntil).toISOString()}`, `discord calls ${calls.length}`].join(" | "));
  }, 900_000);
});
