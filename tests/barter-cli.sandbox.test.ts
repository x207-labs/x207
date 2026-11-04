// SV-011 and SV-015 against a live stack: the built `x207-barter` command (solver/dist/barter-cli.js) talks to the real backend
// (indexer, read API, marketplace routes) over HTTP, in a near-sandbox with the real contract and six onboarded agents.
// rings --send -> agents sign through the book -> commit -> commit_bundle lands on chain; seek --send -> the referral reaches the
// inbox of the agent, a second run does not repeat it. CT-082: a marketplace bundle that names its seeker leg lands when the
// leg is under max_search_share_bps (500) and is refused with ERR_SEARCH_SHARE_EXCEEDED above it; a proposal that carries a
// searcher without search_leg is refused by the book. Run: npm run test:integration.
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { postListing, signBundle, termsHash, type BundleTerms, type ContractAbi, type Listing } from "@x207/core";
import { FailoverRpcClient, Indexer, RpcBlockSource, createApiServer, openDatabase, rpcChainReader } from "../backend/src/index.ts";
import { viewClearedEdges } from "../backend/src/indexer/view-edges.ts";
import { marketplaceRoutes } from "../backend/src/marketplace/index.ts";
import { rpcViewFunction } from "../backend/src/settlement/intents.ts";
import { CALL_PRICE } from "../agents/scenario/ring.ts";
import { BarterAgent, BookClient } from "../agents/shared/barter.ts";
import { startStack, type Stack } from "../agents/test/stack.ts";
import { sandboxAvailable } from "../sdk/test-support/sandbox.ts";

const run = promisify(execFile);
const CLI = resolve("solver/dist/barter-cli.js");

describe.skipIf(!sandboxAvailable)("x207-barter against the live backend in near-sandbox", () => {
  let stack: Stack;
  let api: Server | undefined;
  afterAll(async () => {
    api?.closeAllConnections?.();
    api?.close();
    await stack?.stop();
  });

  it("rings --send, agents sign, commit puts the bundle on chain; seek --send reaches the inbox once", async () => {
    stack = await startStack();
    const { fx, identity: id } = stack;
    const rpcUrl = fx.sandbox.rpcUrl;
    const contract = fx.circle.accountId;
    const solver = await fx.sandbox.createAccount("barter-solver", "20");

    const db = openDatabase(":memory:");
    const indexer = new Indexer({
      db, source: new RpcBlockSource(rpcChainReader(new FailoverRpcClient({ endpoints: [rpcUrl] })), contract, 1), circleId: "agents-main",
      contractId: contract, startBlock: 1, fetchParams: () => fx.sandbox.view(contract, "get_params", {}) as Promise<ContractAbi.Params>,
      fetchClearedEdges: (epoch) => viewClearedEdges(rpcUrl, contract, epoch),
    });
    await indexer.bootstrap();
    api = createApiServer({ db, extraRoutes: marketplaceRoutes(db, { chainView: rpcViewFunction(rpcUrl) }) });
    await new Promise<void>((resolveListen) => api!.listen(0, "127.0.0.1", resolveListen));
    const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    for (let i = 0; i < 90; i++) {
      await indexer.drain();
      if (Number((db.prepare("select count(*) as n from members where status = 'active'").get() as { n: number }).n) >= 6) break;
      await new Promise((r) => setTimeout(r, 1_000));
    }

    const book = new BookClient({ baseUrl: apiUrl, circleId: "agents-main" });
    const epoch = (await fx.sandbox.view<ContractAbi.EpochView>(contract, "get_epoch", {})).epoch;
    const env = {
      PATH: process.env.PATH ?? "", X207_READ_API_URL: apiUrl, X207_CIRCLE_ID: "agents-main", X207_CONTRACT_ID: contract,
      NEAR_RPC_URL: rpcUrl, SOLVER_ACCOUNT_ID: solver.accountId, SOLVER_PRIVATE_KEY: solver.secretKey,
    };
    const cli = async (args: string[], extra: Record<string, string> = {}) => {
      const { stdout } = await run(process.execPath, [CLI, ...args], { env: { ...env, ...extra }, cwd: tmpdir() });
      return JSON.parse(stdout.trim().split("\n").pop()!) as any;
    };

    // ring of three intents image -> gpu -> translator -> image
    const names = ["image", "gpu", "translator"] as const;
    const services = { image: "image", gpu: "compute", translator: "translate" } as const;
    const side = (n: keyof typeof services) => ({ service: services[n], calls: 5, value: String(5 * CALL_PRICE) });
    const agents = new Map(names.map((n) => [n, new BarterAgent({ identity: id[n], book, contractId: contract, now: () => Math.floor(Date.now() / 1000) })]));
    for (const [i, n] of names.entries()) await agents.get(n)!.postIntent(side(n), side(names[(i + 1) % names.length]!));

    const rings = await cli(["rings", "--epoch", String(epoch), "--send"]);
    expect(rings.intentRings).toHaveLength(1);
    expect(rings.sent).toEqual([{ termsHash: rings.intentRings[0].termsHash, created: true }]);
    const again = await cli(["rings", "--epoch", String(epoch), "--send"]);
    expect(again.sent).toEqual([{ termsHash: rings.intentRings[0].termsHash, created: false }]);

    // the agents see the proposal in the book and sign it
    for (const n of names) {
      const proposals = await book.proposals(id[n].accountId, "proposed");
      expect(proposals.map((p) => p.termsHash)).toContain(rings.intentRings[0].termsHash);
      expect((await agents.get(n)!.answerProposals()).map((a) => a.action)).toEqual(["signed"]);
    }
    expect((await book.proposals(id.image.accountId, "ready")).map((p) => p.termsHash)).toEqual([rings.intentRings[0].termsHash]);

    // commit_bundle goes on chain through the command
    const committed = await cli(["commit", "--epoch", String(epoch)]);
    expect(committed.committed).toEqual([expect.objectContaining({ termsHash: rings.intentRings[0].termsHash, ok: true })]);
    const onChain = await fx.sandbox.view<{ bundle_id: number; epoch: number; legs: unknown[] }>(contract, "get_bundle", { bundle_id: 1 });
    expect(onChain).toMatchObject({ bundle_id: 1, epoch });
    expect(onChain.legs).toHaveLength(3);

    // seeker: a discount listing by translator, an idle opt-in agent (summarizer) who can pay
    const listing: Listing = {
      circle: contract, account: id.scraper.accountId,
      offer: { asset_type: "compute.gpu", asset_class: "A", quantity: 1, value: "200000" },
      want: { asset_type: "data.set", asset_class: "A", quantity: 1, value: "200000" },
      terms: "t", detail: "d", expires_at: Math.floor(Date.now() / 1000) + 7200, discount_bps: 2000, accept_payment: true, discoverable: true, nonce: "e2e-1",
    };
    const signed = postListing(listing, id.scraper.voucherSecretKey);
    await book.postListing(signed.listing, signed.signature);
    const dir = mkdtempSync(join(tmpdir(), "barter-e2e-"));
    const agentsFile = join(dir, "agents.json");
    writeFileSync(agentsFile, JSON.stringify([{ account: id.summarizer.accountId, discoverable: true, optIn: true, idle: true, offers: [], canPay: true }]));
    const seekArgs = ["seek", "--epoch", String(epoch), "--agents", agentsFile, "--seeker", id.cleaner.accountId, "--ledger", join(dir, "ledger.json"), "--record", "--send"];
    const seek = await cli(seekArgs, { SEEKER_PRIVATE_KEY: id.cleaner.voucherSecretKey });
    expect(seek.sent.map((o: any) => o.status)).toEqual(["sent"]);
    const inbox = await book.referralInbox(id.summarizer.accountId);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ seeker: id.cleaner.accountId, to: id.summarizer.accountId });
    const second = await cli(seekArgs, { SEEKER_PRIVATE_KEY: id.cleaner.voucherSecretKey });
    expect(second.offers).toEqual([]);
    expect(await book.referralInbox(id.summarizer.accountId)).toHaveLength(1);

    // CT-082: seeker leg under and over max_search_share_bps (500 bps of the sum of the legs)
    const base = `${apiUrl}/x207/circles/agents-main/bundle-proposals`;
    const post = async (body: unknown) => {
      const res = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: res.status, json: (await res.json()) as any };
    };
    const commitAll = async () => {
      try {
        return await cli(["commit", "--epoch", String(epoch)]);
      } catch (error) {
        const stdout = (error as { stdout?: string }).stdout ?? "";
        return JSON.parse(stdout.trim().split("\n").pop()!) as any;
      }
    };
    const u = CALL_PRICE;
    const signAll = async (terms: BundleTerms, who: (keyof typeof id)[]) => {
      for (const n of who) await book.signProposal(termsHash(terms), id[n].accountId, signBundle(terms, id[n].accountId, id[n].voucherSecretKey).signature);
    };
    const bundleTerms = (legs: [keyof typeof id, keyof typeof id, number][], search: [keyof typeof id, keyof typeof id]): BundleTerms => ({
      circle: contract, epoch,
      legs: legs.map(([a, b, n]) => ({ payer: id[a].accountId, payee: id[b].accountId, max_amount: String(n * u) })),
      search_leg: { payer: id[search[0]].accountId, payee: id[search[1]].accountId },
    });

    // under the cap: scraper pays summarizer 97 and the seeker cleaner 3 of 200 (1.5%), summarizer pays scraper 100
    const under = bundleTerms([["scraper", "summarizer", 97], ["summarizer", "scraper", 100], ["scraper", "cleaner", 3]], ["scraper", "cleaner"]);
    const { search_leg: _unnamed, ...unnamed } = under;
    const refused = await post({ terms: unnamed, searcher: id.cleaner.accountId });
    expect(refused.status).toBe(400);
    expect(refused.json.error.message).toMatch(/search_leg/);
    expect((await post({ terms: under, termsHash: termsHash(under), searcher: id.cleaner.accountId })).status).toBe(201);
    await signAll(under, ["scraper", "summarizer", "cleaner"]);
    const landed = (await commitAll()).committed.find((c: any) => c.termsHash === termsHash(under));
    expect(landed).toMatchObject({ ok: true });
    const bundle2 = await fx.sandbox.view<{ legs: unknown[] }>(contract, "get_bundle", { bundle_id: 2 });
    expect(bundle2.legs).toHaveLength(3);

    // over the cap: cleaner pays summarizer 85 and the seeker translator 15 of 200 (7.5%)
    const over = bundleTerms([["cleaner", "summarizer", 85], ["summarizer", "cleaner", 100], ["cleaner", "translator", 15]], ["cleaner", "translator"]);
    expect((await post({ terms: over, searcher: id.translator.accountId })).status).toBe(201);
    await signAll(over, ["cleaner", "summarizer", "translator"]);
    const refusedOnChain = (await commitAll()).committed.find((c: any) => c.termsHash === termsHash(over));
    expect(refusedOnChain).toMatchObject({ ok: false });
    expect(refusedOnChain.error).toContain("ERR_SEARCH_SHARE_EXCEEDED");
    expect(await fx.sandbox.view(contract, "get_bundle", { bundle_id: 3 })).toBeNull();
  }, 600_000);
});
