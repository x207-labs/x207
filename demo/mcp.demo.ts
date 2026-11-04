// SD-082 / UM-115: the MCP demo on near-sandbox. One command from the umbrella root:   npm run demo:mcp
// A model (here a script that is an MCP client over stdio) uses ONLY the tools of `@x207/mcp` to: join the circle, buy three summaries with `x207_pay_request`, sell through `x207_list_offer`, and,
// after the epoch is closed, read the clearing with `x207_epoch_report`. The other agents of the circle close the ring around it with ordinary x207 vouchers, so that the epoch has a cycle to clear.
//   M (the agent of the MCP client) pays the summarizer, the summarizer pays the scraper, the scraper pays M: 3 calls of 0.02 credit on each of the three pairs.
// Nothing here needs the Rust toolchain or a key: the accounts and keys are made in the sandbox for this run only. Needs the packages built (`npm run build --workspaces --if-present`).
import { execFile } from "node:child_process";
import { existsSync, writeSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { promisify } from "node:util";
import { afterAll, describe, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { generateVoucherKeypair, type ContractAbi } from "@x207/core";
import { FailoverRpcClient, Indexer, RpcBlockSource, createApiServer, openDatabase, rpcChainReader } from "../backend/src/index.ts";
import { marketplaceRoutes } from "../backend/src/marketplace/index.ts";
import { viewClearedEdges } from "../backend/src/indexer/view-edges.ts";
import { AGENTS } from "../agents/shared/registry.ts";
import { createAgentBuyer } from "../agents/shared/x207.ts";
import { serveWeb } from "../agents/test/helpers.ts";
import { startStack, type Stack } from "../agents/test/stack.ts";
import { keeperPass } from "../scripts/lib/keeper.mjs";
import { createSeller } from "../sdk/examples/seller/src/seller.ts";
import { TERMS_HASH } from "../sdk/test-support/circle.ts";

const run = promisify(execFile);
const CLI = "sdk/packages/mcp/dist/cli.js";
const CALLS = 3;
const STAKE = "50000000"; // 50 credit

describe("demo MCP near-sandbox", () => {
  let stack: Stack | undefined;
  let api: Server | undefined;
  let client: Client | undefined;
  let seller: { server: Server } | undefined;
  afterAll(async () => {
    await client?.close().catch(() => undefined);
    seller?.server.close();
    api?.close();
    await stack?.stop();
  });

  it("an AI agent joins, buys, sells and reads the clearing through MCP", async () => {
    if (!existsSync(CLI)) throw new Error(`${CLI} is missing: run \`npm ci\` and \`npm run build --workspaces --if-present\` first`);
    const out = (line = "") => writeSync(1, `${line}\n`);
    const short = (value: unknown, max = 300): string => {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      return text.length > max ? `${text.slice(0, max)} ...` : text;
    };
    const t0 = Date.now();
    out("x207 over MCP on near-sandbox: the model uses only the tools of @x207/mcp.\n");
    out("setting up: a circle with six agents (contract, mock USDT, facilitator) ...");
    const clock = { offset: 0 };
    stack = await startStack({ now: () => Date.now() + clock.offset });
    const { fx, identity, urls } = stack;
    const rpcUrl = fx.sandbox.rpcUrl;
    const keeper = await fx.sandbox.createAccount("keeper", "20");
    const solver = await fx.sandbox.createAccount("solver", "20");
    const agent = await fx.member("mcpagent"); // an account with 1,000 mock USDT that has not joined
    const voucher = generateVoucherKeypair();

    const db = openDatabase(":memory:");
    const indexer = new Indexer({
      db, source: new RpcBlockSource(rpcChainReader(new FailoverRpcClient({ endpoints: [rpcUrl] })), fx.circle.accountId, 1),
      circleId: "agents-main", contractId: fx.circle.accountId, startBlock: 1,
      fetchParams: () => fx.sandbox.view(fx.circle.accountId, "get_params", {}) as Promise<ContractAbi.Params>,
      fetchClearedEdges: (epoch) => viewClearedEdges(rpcUrl, fx.circle.accountId, epoch),
    });
    await indexer.bootstrap();
    api = createApiServer({ db, extraRoutes: marketplaceRoutes(db, { chainView: (m: string, a: object) => fx.sandbox.view(fx.circle.accountId, m, a) }) });
    await new Promise<void>((resolve) => api!.listen(0, "127.0.0.1", resolve));
    const readApi = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    const phaseOf = (epoch: number) => (db.prepare("select phase from epochs where epoch = ?").get(epoch) as { phase: string } | undefined)?.phase;
    const catchUp = async (done: () => boolean) => {
      for (let i = 0; i < 90; i++) {
        await indexer.drain();
        if (done()) return;
        await new Promise((r) => setTimeout(r, 1_000));
      }
      throw new Error("indexer did not catch up within 90 seconds");
    };
    const isMember = () => (db.prepare("select 1 as x from members where account_id = ?").get(agent.accountId) as { x: number } | undefined) !== undefined;

    // a seller endpoint for M, so that the ring can pay it
    seller = await serveWeb(createSeller({ facilitatorUrl: stack.facilitatorUrl, circleId: fx.circleId, payTo: agent.accountId }).fetch);
    const sellerUrl = (seller as unknown as { url: string }).url;

    // ---- the MCP client: this is the "model" ---------------------------------------------------------------------------------------------------------------------------------
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [CLI],
      env: {
        PATH: process.env.PATH ?? "",
        X207_CIRCLE_CONTRACT: fx.circle.accountId, X207_CIRCLE_ID: fx.circleId, X207_RPC_URL: rpcUrl, X207_BACKEND_URL: readApi,
        X207_MCP_WRITE: "1", X207_ALLOW_OUTFLOWS: "1", X207_ALLOW_FULL_ACCESS_KEY: "1", X207_ALLOW_PRIVATE_URLS: "1", // the sellers of this demo are on 127.0.0.1
        X207_AGENT_ACCOUNT: agent.accountId, X207_AGENT_VOUCHER_KEY: voucher.secretKey, X207_AGENT_NEAR_KEY: agent.secretKey,
        X207_MAX_SPEND_SESSION: "100000000", X207_MAX_PRICE_PER_CALL: "100000",
      },
    });
    client = new Client({ name: "demo-mcp-agent", version: "0" });
    await client.connect(transport);
    let step = 0;
    const tool = async (name: string, args: Record<string, unknown> = {}): Promise<{ json: any; isError: boolean }> => {
      step += 1;
      out(`\n[${step}] model calls  ${name}(${short(args, 160)})`);
      const started = Date.now();
      const result = await client!.callTool({ name, arguments: args });
      const text = (result.content as Array<{ text: string }>)[0]!.text;
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* an error text */
      }
      out(`    ${result.isError ? "ERROR" : "ok"} in ${Date.now() - started} ms`);
      if (result.isError) throw new Error(`${name}: ${text}`);
      return { json, isError: false };
    };

    out(`MCP server started over stdio; agent account ${agent.accountId}`);
    const listed = await client.listTools();
    out(`tools offered: ${listed.tools.map((t) => t.name).join(", ")}`);

    // 1. join and stake
    const joined = await tool("x207_join", { terms_hash: TERMS_HASH, stake_amount: STAKE });
    out(`    member: status=${joined.json.member?.status} stake=${joined.json.member?.stake} limit=${joined.json.member?.limit}; session spent ${joined.json.session.spent}`);
    await catchUp(isMember);
    const inspected = await tool("x207_member_inspect", { account: agent.accountId });
    out(`    read API: ${short(inspected.json, 260)}`);

    // 2. buy three summaries
    for (let i = 1; i <= CALLS; i++) {
      const paid = await tool("x207_pay_request", { url: `${urls.summarizer}/api/summarize?input=report-${i}` });
      out(`    HTTP ${paid.json.status}, paid=${paid.json.paid}; answer: ${short(paid.json.body, 110)}; session ${short(paid.json.session, 120)}`);
    }

    // 3. sell: a listing in the marketplace book
    const offer = await tool("x207_list_offer", {
      offer_asset_type: "service:summary", offer_class: "B", offer_quantity: 1, offer_value: "20000",
      want_asset_type: "usdc", want_class: "A", want_quantity: 1, want_value: "20000", terms: "demo: one summary of a text", detail: "summary of a text", expires_in_hours: 48,
    });
    out(`    listed: ${short({ listingHash: offer.json.listingHash, status: offer.json.listing?.status }, 200)}`);
    const found = await tool("x207_search_listings", { account: agent.accountId, offerType: "service:summary", limit: 5 });
    out(`    the book shows ${found.json.items.length} listing(s) of this agent`);

    // 4. the rest of the circle closes the ring around M: summarizer pays scraper, scraper pays M (ordinary x207 vouchers, no MCP)
    out(`\n[ring] the summarizer buys ${CALLS} calls from the scraper, the scraper buys ${CALLS} calls from the agent (its listing above)`);
    const toScraper = createAgentBuyer(identity.summarizer, { rpcUrls: [rpcUrl] });
    const toAgent = createAgentBuyer(identity.scraper, { rpcUrls: [rpcUrl] });
    for (let i = 0; i < CALLS; i++) {
      const a = await toScraper(`${urls.scraper}/api/${AGENTS.scraper.verb}?input=halo`);
      const b = await toAgent(`${sellerUrl}/api/summarize?input=halo`);
      if (a.status !== 200 || b.status !== 200) throw new Error(`the ring payment failed: ${a.status} ${b.status}`);
    }
    const registered = await stack.scheduler.tick();
    out(`    on-chain registration of the vouchers: ${registered.registered} pairs`);

    // 5. close the epoch: keeper, solver, commit
    const send = async (label: string, who: { accountId: string; secretKey: string }, call: Parameters<typeof fx.circle.call>[0]) => {
      const r = await fx.sandbox.accountFrom(who.accountId, who.secretKey).call(call, "EXECUTED_OPTIMISTIC");
      if (r.failures.length > 0) throw new Error(`${label}: ${r.failures.join("; ")}`);
      return r;
    };
    const pass = () =>
      keeperPass({
        view: (m: string, a: object) => fx.sandbox.view(fx.circle.accountId, m, a),
        chainNowMs: () => fx.sandbox.blockTimestampMs(),
        send: async ({ methodName, args }: { methodName: string; args: object }) => (await send(`keeper.${methodName}`, keeper, { receiverId: fx.circle.accountId, methodName, args, deposit: 0n, gas: 200_000_000_000_000n })).hash,
      }) as Promise<Array<{ method: string; epoch: number }>>;
    const advance = async (ns: string | null | undefined) => {
      await fx.sandbox.advanceTo(Number(BigInt(ns!) / 1_000_000n) + 1_000);
      clock.offset += 61_000;
      await new Promise((r) => setTimeout(r, 3_000));
    };
    const current = await fx.sandbox.view<ContractAbi.EpochView>(fx.circle.accountId, "get_epoch", {});
    const epoch = current.epoch;
    out(`\n[clearing] epoch ${epoch}: the cutoff passes, the keeper closes it, the solver submits the clearing, the contract commits it`);
    await advance(current.cutoff_at);
    await pass();
    await catchUp(() => phaseOf(epoch) !== "open");
    const solved = await run("node", ["solver/dist/cli.js", "--epoch", String(epoch)], {
      env: { PATH: process.env.PATH, X207_READ_API_URL: readApi, X207_CIRCLE_ID: fx.circleId, NEAR_RPC_URL: rpcUrl, X207_CONTRACT_ID: fx.circle.accountId, SOLVER_ACCOUNT_ID: solver.accountId, SOLVER_PRIVATE_KEY: solver.secretKey },
    });
    out(`    solver: ${solved.stdout.trim() ? "proposal submitted" : "nothing to clear"}`);
    const closing = await fx.sandbox.view<ContractAbi.EpochView>(fx.circle.accountId, "get_epoch", { epoch });
    await advance(closing.proposal_deadline);
    await pass();
    await catchUp(() => ["payment_window", "finalized"].includes(phaseOf(epoch) ?? ""));

    // 6. the model reads the result
    const report = await tool("x207_epoch_report", { epoch, settlements_limit: 10 });
    const m = report.json.metrics ?? {};
    out(`    phase ${report.json.contract?.phase}; cleared ratio: ${short(m.clearedRatio ?? m.cleared_ratio ?? m, 200)}`);
    out(`    metrics: ${short(m, 400)}`);
    out(`    report 207: ${short(report.json.summary, 500)}`);
    const after = await tool("x207_member_inspect", { account: agent.accountId });
    out(`    the agent after clearing: ${short(after.json, 400)}`);

    out(`\ndone in ${Math.round((Date.now() - t0) / 1000)} s: join, 3 paid calls, 1 listing, 1 cleared epoch, all through MCP tools. The only things not done by the model are the ring of the other agents and the keeper and solver.`);
  });
});
