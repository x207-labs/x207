// UM-032: the F5 step (barter ring) of the network demo, split out so the sandbox test runs the same code (tests/network-barter.sandbox.test.ts).
// Three agents sign `terms_hash`, the solver account calls `commit_bundle`, then every leg is paid with vouchers that carry a `bundleId`.
// This step must run before the F2 payments on the same pair: verification rejects a leg when the cumulative amount passes `max_amount`.
import { signBundle, termsHash, type BundleTerms, type CircleViewFn, type ContractCall } from "@x207/core";
import { LEG_AMOUNT, RING_MEMBERS, payLegs } from "../agents/scenario/ring.ts";
import type { AgentIdentity } from "../agents/shared/identity.ts";
import { AGENTS, type AgentName } from "../agents/shared/registry.ts";
import { createAgentBuyer } from "../agents/shared/x207.ts";

export type BarterStepOptions = {
  view: CircleViewFn;
  /** Sends one contract call from the solver account and returns its success value (`bundle_id`). */
  send: (call: ContractCall) => Promise<unknown>;
  rpcUrl: string;
  contract: string;
  epoch: number;
  accounts: Record<AgentName, string>;
  identity: Record<AgentName, AgentIdentity>;
  urls: Record<AgentName, string>;
  log: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
};

export type BarterStepResult =
  | { status: "skipped" }
  | { status: "done"; bundleId: number; termsHash: string; terms: BundleTerms; paid: Record<string, bigint> };

export async function runBarterRing(o: BarterStepOptions): Promise<BarterStepResult> {
  const { view, contract, epoch, accounts, identity, urls, log } = o;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  log(`== F5 barter bundle (epoch ${epoch}, ring ${RING_MEMBERS.join(" -> ")})`);
  // get_bundle exists since interface 0.0.4; an old contract rejects that view call, so the step is skipped.
  const supported = await view("get_bundle", { bundle_id: 1 }).then(() => true, () => false);
  if (!supported) {
    log(`   skipped: ${contract} has no get_bundle yet (interface before 0.0.4). Set CIRCLE_CONTRACT to a 0.0.4 address.`);
    return { status: "skipped" };
  }
  const legs = RING_MEMBERS.map((buyer, i) => ({ payer: accounts[buyer], payee: accounts[RING_MEMBERS[(i + 1) % RING_MEMBERS.length]!], max_amount: String(LEG_AMOUNT) }))
    .sort((a, b) => (a.payer !== b.payer ? (a.payer < b.payer ? -1 : 1) : a.payee < b.payee ? -1 : 1));
  const terms: BundleTerms = { circle: contract, epoch, legs };
  const signatures = RING_MEMBERS.map((n) => {
    const signed = signBundle(terms, accounts[n], identity[n].voucherSecretKey);
    return { account_id: signed.account, signature: signed.signature };
  });
  const hash = termsHash(terms);
  log(`   terms_hash ${hash}, ${legs.length} legs of ${LEG_AMOUNT}`);
  const bundleId = Number(
    await o.send({ receiverId: contract, methodName: "commit_bundle", args: { bundle: { epoch, legs }, signatures }, deposit: 0n, gas: 200_000_000_000_000n }),
  );
  log(`   bundle ${bundleId} committed`);
  // The facilitator reads the final block: wait until the bundle is visible before paying the leg
  for (let i = 0; i < 60 && !(await view("get_bundle", { bundle_id: bundleId })); i++) await sleep(1_000);
  const pairs = new Set(legs.map((l) => `${l.payer}>${l.payee}`));
  const buyers = Object.fromEntries(
    RING_MEMBERS.map((n) => [n, createAgentBuyer(identity[n], { rpcUrls: [o.rpcUrl], bundleFor: (payee, e) => (e === epoch && pairs.has(`${accounts[n]}>${payee}`) ? bundleId : undefined) })]),
  );
  const paid = await payLegs((buyer, seller) => buyers[buyer]!(`${urls[seller]}/api/${AGENTS[seller].verb}?input=halo`));
  for (const [pair, amount] of Object.entries(paid)) log(`   leg ${pair} paid ${amount}`);
  return { status: "done", bundleId, termsHash: hash, terms, paid };
}
