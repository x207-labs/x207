// A circle of members on a real contract in near-sandbox, an indexer, the read API with the license routes, and a fake internet that serves the ciphertext (UM-114). The code is the setup of
// tests/licenses.sandbox.test.ts: the backend refuses a loopback address, so the hosting is injected the way the agent tests do it.
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect } from "vitest";
import { createCircleViewFn, httpsSource, onboardMember, type ContentRef, type ContentSource, type ContractAbi, type ContractCall } from "@x207/core";
import { FailoverRpcClient, Indexer, RpcBlockSource, createApiServer, openDatabase, rpcChainReader } from "../../backend/src/index.ts";
import { viewClearedEdges } from "../../backend/src/indexer/view-edges.ts";
import { marketplaceRoutes } from "../../backend/src/marketplace/index.ts";
import { TERMS_HASH, deployCircle, type CircleFixture } from "../../sdk/test-support/circle.ts";
import type { SandboxAccount } from "../../sdk/test-support/sandbox.ts";
import type { LicenseActor } from "../../agents/scenario/license.ts";
import { HttpCodeBook } from "../../agents/scenario/code.ts";

export const credit = (n: number): string => (BigInt(n) * 1_000_000n).toString();
export type LicenseMember = { account: SandboxAccount; secretKey: `ed25519:${string}`; publicKey: string };

export type LicenseCircle = {
  fx: CircleFixture;
  /** The license book with the takedown route of the code book on top (`HttpCodeBook` extends `LicenseBook`). */
  book: HttpCodeBook;
  contract: string;
  epoch: number;
  members: Record<string, LicenseMember>;
  actor: (m: LicenseMember) => LicenseActor;
  /** What the fake internet serves: `https://store.example.com/<path>` -> bytes. */
  publish: (name: string, bytes: Uint8Array) => ContentRef;
  sources: Partial<Record<ContentRef["kind"], ContentSource>>;
  pair: (debtor: LicenseMember, creditor: LicenseMember) => string;
  registerOnChain: (voucher: unknown, signature: unknown, by: LicenseMember) => Promise<void>;
  catchUp: (done: () => boolean) => Promise<void>;
  stop: () => Promise<void>;
};

export async function startLicenseCircle(names: string[]): Promise<LicenseCircle> {
  const fx = await deployCircle();
  const rpcUrl = fx.sandbox.rpcUrl;
  const startBlock = 1;
  const view = createCircleViewFn({ circleContract: fx.circle.accountId, rpcUrls: [rpcUrl] });
  const join = async (name: string): Promise<LicenseMember> => {
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
  const members: Record<string, LicenseMember> = {};
  for (const name of names) members[name] = await join(name);
  const contract = fx.circle.accountId;
  const view_ = <T,>(method: string, args: object) => fx.sandbox.view<T>(contract, method, args);
  const db = openDatabase(":memory:");
  const indexer = new Indexer({
    db, source: new RpcBlockSource(rpcChainReader(new FailoverRpcClient({ endpoints: [rpcUrl] })), contract, startBlock), circleId: "agents-main",
    contractId: contract, startBlock, fetchParams: () => view_("get_params", {}) as Promise<ContractAbi.Params>,
    fetchClearedEdges: (epoch) => viewClearedEdges(rpcUrl, contract, epoch),
  });
  await indexer.bootstrap();
  const catchUp = async (done: () => boolean) => {
    for (let i = 0; i < 90; i++) {
      await indexer.drain();
      if (done()) return;
      if (i % 5 === 4) await fx.sandbox.advanceTo((await fx.sandbox.blockTimestampMs()) + 2_000);
      await new Promise((r) => setTimeout(r, 1_000));
    }
    throw new Error("the indexer did not catch up in 90 seconds");
  };
  const files = new Map<string, Uint8Array>();
  const transport = async ({ host, path, method, onChunk }: any) => {
    const bytes = files.get(`${host}${path}`);
    if (!bytes) return { status: 404, body: Buffer.alloc(0), truncated: false };
    if (method === "HEAD") return { status: 200, body: Buffer.alloc(0), truncated: false };
    if (onChunk) {
      for (let i = 0; i < bytes.length; i += 16_384) onChunk(Buffer.from(bytes.subarray(i, i + 16_384)));
      return { status: 200, body: Buffer.alloc(0), truncated: false };
    }
    return { status: 200, body: Buffer.from(bytes), truncated: false };
  };
  const resolver = async () => ["93.184.216.34"];
  const sources: Partial<Record<ContentRef["kind"], ContentSource>> = {
    https: httpsSource({ fetch: async (url: string) => {
      const bytes = files.get(url.replace("https://", ""));
      return bytes ? new Response(Buffer.from(bytes), { status: 200 }) : new Response("not found", { status: 404 });
    } }),
  };
  const api: Server = createApiServer({ db, extraRoutes: marketplaceRoutes(db, { chainView: (_contract: string, method: string, args: object) => view_(method, args), sourceFetch: { resolver, transport } }) });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  const book = new HttpCodeBook(apiUrl, "agents-main", contract);
  await catchUp(() => (db.prepare("select count(*) as n from members").get() as { n: number }).n === names.length);
  const epoch = (await view_<ContractAbi.EpochView>("get_epoch", {})).epoch;
  return {
    fx, book, contract, epoch, members, sources,
    actor: (m) => ({ account: m.account.accountId, secretKey: m.secretKey, publicKey: m.publicKey }),
    publish: (name, bytes) => {
      files.set(`store.example.com/${name}.bin`, bytes);
      return { kind: "https", ref: `https://store.example.com/${name}.bin` };
    },
    pair: (debtor, creditor) => {
      const row = db.prepare("SELECT cumulative_amount FROM obligations WHERE circle_id = 'agents-main' AND epoch = ? AND debtor = ? AND creditor = ?").get(epoch, debtor.account.accountId, creditor.account.accountId) as { cumulative_amount: string } | undefined;
      return String(row?.cumulative_amount ?? "0");
    },
    registerOnChain: async (voucher, signature, by) => {
      const r = await by.account.call({ receiverId: contract, methodName: "register_cumulative", args: { voucher, signature }, deposit: 0n, gas: 100_000_000_000_000n }, "FINAL");
      expect(r.failures).toEqual([]);
    },
    catchUp,
    stop: async () => {
      api.close();
      await fx.stop();
    },
  };
}
