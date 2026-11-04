// UM-095 (#66 domain name, #29 transfer code of the domain): transfer of a domain through its registrar (P4, ADR-49) in near-sandbox. A seller and two buyers, members of a real circle on a real contract, the transfer ledger of the backend (BE-074)
// and a fake internet for the platforms (DNS over HTTPS and the registry RDAP of AG-031; the backend refuses a loopback address, so they are injected as the agent tests do):
//   - a domain is sold: the buyer's voucher is held while the registrar has not finished, `POST /transfers/{id}/proof` answers `pending` and says what is missing, the registry moves the domain,
//     the proof is met, and only then the voucher is released; the seller registers it on the contract and the pair holds the price;
//   - the transfer code (the auth code of the registrar, #29) is handed once, outside x207, and the registrar accepts it once; it never appears in an answer of the API, in the log or in any table of D9;
//   - a domain whose transfer never finishes: the window of 7 days passes, the transfer is `cancelled` with `transfer_window_passed`, no voucher is ever handed out and nothing moves on the chain.
import { afterAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { TRANSFER_WINDOW_SECONDS, createCircleViewFn, onboardMember, type ContractAbi, type ContractCall } from "@x207/core";
import { FailoverRpcClient, Indexer, RpcBlockSource, createApiServer, openDatabase, rpcChainReader } from "../backend/src/index.ts";
import { viewClearedEdges } from "../backend/src/indexer/view-edges.ts";
import { marketplaceRoutes } from "../backend/src/marketplace/index.ts";
import { DnsTxtProof } from "../backend/src/marketplace/transfer-proofs.ts";
import { TERMS_HASH, deployCircle, type CircleFixture } from "../sdk/test-support/circle.ts";
import { sandboxAvailable, type SandboxAccount } from "../sdk/test-support/sandbox.ts";
import { HttpTransferBook, buyTransfer, buyerTxt, postTransfer, prepareTransfer, releasedVoucher, waitForProof, type TransferActor } from "../agents/scenario/transfer.ts";

const credit = (n: number): string => (BigInt(n) * 1_000_000n).toString();
type Member = { account: SandboxAccount; secretKey: `ed25519:${string}`; publicKey: string };

describe.skipIf(!sandboxAvailable)("UM-095 transfer of a domain through its registrar: paid after the proof, an unfinished transfer is never paid", () => {
  let fx: CircleFixture;
  let api: Server | undefined;
  afterAll(async () => {
    api?.close();
    await fx?.stop();
  });
  // the platforms: DNS over HTTPS and the RDAP of the registry
  const dns = new Map<string, string[]>();
  const rdap = new Map<string, unknown>();
  const reply = (status: number, body: unknown) => ({ status, body: Buffer.from(JSON.stringify(body)), truncated: false });
  const transport = async ({ host, path }: { host: string; path: string }) => {
    if (host === "dns.google") {
      const name = new URL(`https://x${path}`).searchParams.get("name") ?? "";
      const records = dns.get(name);
      return records === undefined ? reply(200, { Status: 3 }) : reply(200, { Status: 0, Answer: records.map((r) => ({ name, type: 16, TTL: 60, data: `"${r}"` })) });
    }
    if (host === "rdap.verisign.com") return rdap.has(path.split("/").pop() ?? "") ? reply(200, rdap.get(path.split("/").pop() ?? "")) : reply(404, null);
    return { status: 404, body: Buffer.alloc(0), truncated: false };
  };
  const resolver = async () => ["93.184.216.34"];
  // the clock of the backend: the window of the transfer is measured on it, so the test moves it instead of waiting 7 days
  const clock = { now: Date.now() };

  // the registrar: it moves the domain only for the transfer code of the seller, once; then the registry shows the domain `active` and the buyer sets its TXT
  const registrar = {
    codes: new Map<string, string>(),
    transfer(domain: string, code: string, buyerTxtValue: string, sellerTxtValue: string): void {
      if (this.codes.get(domain) !== code) throw new Error("registrar: transfer code refused");
      this.codes.delete(domain); // the code is used up
      rdap.set(domain, { ldhName: domain, status: ["pending transfer"] });
      dns.set(domain, [sellerTxtValue, buyerTxtValue]);
    },
    settle(domain: string): void { rdap.set(domain, { ldhName: domain, status: ["active"] }); },
  };
  // everything that crosses the API and everything the process writes to stderr, to look for the transfer code afterwards
  const seen: string[] = [];
  const realFetch = globalThis.fetch;
  const realWrite = process.stderr.write.bind(process.stderr);
  afterAll(() => { globalThis.fetch = realFetch; process.stderr.write = realWrite; });

  it("TC-UM-095-01 a domain is paid only after the registry shows it moved; a transfer that never finishes is cancelled and nothing is registered", async () => {
    globalThis.fetch = (async (input: any, init?: any) => {
      const res = await realFetch(input, init);
      if (String(input?.url ?? input).startsWith("http://127.0.0.1")) seen.push(String(init?.body ?? "") + (await res.clone().text()));
      return res;
    }) as typeof fetch;
    process.stderr.write = ((chunk: any, ...rest: any[]) => { seen.push(String(chunk)); return (realWrite as any)(chunk, ...rest); }) as typeof process.stderr.write;
    fx = await deployCircle();
    const rpcUrl = fx.sandbox.rpcUrl;
    const rpc = async (method: string, params: unknown) => ((await (await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()) as any).result;
    // from the first block: the indexer must see the epoch_opened of the first epoch, which was emitted when the contract was initialised, before any member joined
    const startBlock = 1;
    const view = createCircleViewFn({ circleContract: fx.circle.accountId, rpcUrls: [rpcUrl] });
    const join = async (name: string): Promise<Member> => {
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
        { circleContract: fx.circle.accountId, circleId: fx.circleId, accountId: account.accountId, termsHash: TERMS_HASH, stakeAmount: "150000000", usdtTokenId: fx.usdt.accountId },
      );
      return { account, secretKey: joined.secretKey, publicKey: joined.publicKey };
    };
    const seller = await join("seller");
    const buyer = await join("buyer");
    const second = await join("second");
    const contract = fx.circle.accountId;
    const view_ = <T,>(method: string, args: object) => fx.sandbox.view<T>(contract, method, args);

    // --- indexer and read API with the license routes; the backend downloads from a fake internet (the guard of the backend refuses a loopback address)
    const advance = async (ns: string | null | undefined) => {
      await fx.sandbox.advanceTo(Number(BigInt(ns!) / 1_000_000n) + 1_000);
      await new Promise((r) => setTimeout(r, 3_000));
    };
    const db = openDatabase(":memory:");
    const indexer = new Indexer({
      db, source: new RpcBlockSource(rpcChainReader(new FailoverRpcClient({ endpoints: [rpcUrl] })), contract, startBlock), circleId: "agents-main",
      contractId: contract, startBlock, fetchParams: () => view_("get_params", {}) as Promise<ContractAbi.Params>,
      fetchClearedEdges: (epoch) => viewClearedEdges(rpcUrl, contract, epoch),
    });
    await indexer.bootstrap();
    // The indexer reads final blocks, and the sandbox makes blocks slowly when nothing is sent: nudge the clock a little while waiting.
    const catchUp = async (done: () => boolean) => {
      for (let i = 0; i < 90; i++) {
        await indexer.drain();
        if (done()) return;
        if (i % 5 === 4) await fx.sandbox.advanceTo((await fx.sandbox.blockTimestampMs()) + 2_000);
        await new Promise((r) => setTimeout(r, 1_000));
      }
      const members = (db.prepare("select count(*) as n from members").get() as { n: number }).n;
      const epochs = db.prepare("select epoch, phase from epochs").all();
      const cursor = db.prepare("select last_block_height, head_block_height from indexer_cursor").get();
      throw new Error(`the indexer did not catch up in 90 seconds: members ${members}, epochs ${JSON.stringify(epochs)}, cursor ${JSON.stringify(cursor)}`);
    };
    const phaseOf = (epoch: number) => (db.prepare("select phase from epochs where epoch = ?").get(epoch) as { phase: string } | undefined)?.phase;
    // The epoch rows of the indexer appear with the first epoch event after the cutoff, so the open epoch is read from the contract (the book falls back to the rows otherwise).
    api = createApiServer({ db, now: () => clock.now, extraRoutes: marketplaceRoutes(db, { chainView: (_contract: string, method: string, args: object) => view_(method, args), sourceFetch: { resolver, transport }, dnsTxt: new DnsTxtProof({ resolver, transport }), proofMinSeconds: 0 }) });
    await new Promise<void>((resolve) => api!.listen(0, "127.0.0.1", resolve));
    const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
    const book = new HttpTransferBook(apiUrl, "agents-main", contract, () => Math.floor(clock.now / 1000));
    await catchUp(() => (db.prepare("select count(*) as n from members").get() as { n: number }).n === 3);
    const E = (await view_<ContractAbi.EpochView>("get_epoch", {})).epoch;
    const actor = (m: Member): TransferActor => ({ account: m.account.accountId, secretKey: m.secretKey });
    const [sellerA, buyerA, secondA] = [actor(seller), actor(buyer), actor(second)];
    const expiresAt = Math.floor(clock.now / 1000) + 30 * 86_400;
    const pairOf = (debtor: Member, creditor: Member) => {
      const row = db.prepare("SELECT cumulative_amount FROM obligations WHERE circle_id = 'agents-main' AND epoch = ? AND debtor = ? AND creditor = ?").get(E, debtor.account.accountId, creditor.account.accountId) as { cumulative_amount?: string } | undefined;
      return String(row?.cumulative_amount ?? "0");
    };
    const wait = async () => { clock.now += 1_000; };

    // --- 1. a domain that finishes: the voucher moves only after the proof
    const shop = prepareTransfer(book, sellerA, { platform: "domain", ref: "agent-shop.com", price: credit(40), estimateSeconds: 3600, nonce: "um095-ok", expiresAt });
    dns.set("agent-shop.com", [shop.sellerTxt!]);
    await postTransfer(book, sellerA, shop);
    const bought = await buyTransfer(book, buyerA, shop, E, { seq: 0, cumulative: "0" });
    expect([bought.status, bought.platform, bought.proofMethod]).toEqual(["paid_held", "domain", "dns_txt"]);
    expect(bought.voucher).toBeUndefined();
    expect(bought.windowUntil - book.at()).toBe(TRANSFER_WINDOW_SECONDS.domain);
    // the seller sets the transfer code at the registrar and hands it to the buyer once, outside x207 (it is not sent to the backend)
    const transferCode = randomBytes(12).toString("hex");
    registrar.codes.set("agent-shop.com", transferCode);
    // the registrar has not finished: pending, with what is missing, and no voucher
    const early = await book.proof(bought.transferId);
    expect(early).toMatchObject({ outcome: "pending" });
    // since UM-096 the answer names the TXT record but does not show its value (it is bound to the voucher of the buyer, so a third party cannot read it off the proof endpoint)
    expect((early as unknown as { missing: { want: string } }).missing.want).toMatch(/x207-own TXT record/);
    expect(JSON.stringify(early)).not.toContain(buyerTxt(bought));
    expect((await book.getTransfer(bought.transferId)).voucher).toBeUndefined();
    // the buyer redeems the code at the registrar: a wrong code is refused, the right one works once and a second use is refused
    expect(() => registrar.transfer("agent-shop.com", "0".repeat(24), buyerTxt(bought), shop.sellerTxt!)).toThrow("transfer code refused");
    registrar.transfer("agent-shop.com", transferCode, buyerTxt(bought), shop.sellerTxt!);
    expect(() => registrar.transfer("agent-shop.com", transferCode, buyerTxt(bought), shop.sellerTxt!)).toThrow("transfer code refused");
    // the domain moves but the registry still says the transfer is pending
    expect((await book.proof(bought.transferId)).outcome).toBe("pending");
    expect(pairOf(buyer, seller)).toBe("0");
    // the registry settles: the proof is met and the voucher is released
    registrar.settle("agent-shop.com");
    const done = await waitForProof(book, bought.transferId, { tries: 3, wait });
    expect(done.outcome).toBe("confirmed");
    const { voucher, signature } = releasedVoucher((done as { transfer: any }).transfer);
    expect(voucher).toMatchObject({ payer: buyerA.account, payee: sellerA.account, cumulativeAmount: credit(40), epoch: E });
    const r = await seller.account.call({ receiverId: contract, methodName: "register_cumulative", args: { voucher, signature }, deposit: 0n, gas: 100_000_000_000_000n }, "FINAL");
    expect(r.failures).toEqual([]);
    await catchUp(() => pairOf(buyer, seller) === credit(40));
    expect(pairOf(buyer, seller)).toBe(credit(40));

    // the transfer code never reached the backend: not in an answer or a request of the API, not in the log, not in any table of D9
    const dump = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => JSON.stringify(db.prepare(`SELECT * FROM "${t.name}"`).all(), (_k, v) => (typeof v === "bigint" ? v.toString() : v))).join("\n");
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.join("\n")).not.toContain(transferCode);
    expect(dump).not.toContain(transferCode);
    expect(JSON.stringify(await book.getTransfer(bought.transferId))).not.toContain(transferCode);

    // --- 2. a domain whose transfer never finishes: the window passes, the voucher never leaves
    const late = prepareTransfer(book, sellerA, { platform: "domain", ref: "slow-shop.com", price: credit(30), estimateSeconds: 3600, nonce: "um095-late", expiresAt });
    dns.set("slow-shop.com", [late.sellerTxt!]);
    await postTransfer(book, sellerA, late);
    const heldLate = await buyTransfer(book, secondA, late, E, { seq: 0, cumulative: "0" });
    expect(heldLate.status).toBe("paid_held");
    expect((await book.proof(heldLate.transferId)).outcome).toBe("pending");
    clock.now += (TRANSFER_WINDOW_SECONDS.domain + 60) * 1000;
    expect((await book.proof(heldLate.transferId)).outcome).toBe("window_passed");
    const after = await book.getTransfer(heldLate.transferId);
    expect(after).toMatchObject({ status: "cancelled", cancelReason: "transfer_window_passed" });
    expect(after.voucher).toBeUndefined();
    expect(after.voucherSignature).toBeUndefined();
    expect(pairOf(second, seller)).toBe("0"); // nothing was registered for the transfer that did not finish
    console.log(["UM-095", `epoch ${E}`, `finished pair ${pairOf(buyer, seller)}`, `unfinished pair ${pairOf(second, seller)}`, `status ${after.status} (${after.cancelReason})`].join(" | "));
  }, 1_800_000);
});
