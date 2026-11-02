// UM-032: langkah F5 (cincin barter) dari demo jaringan, dipisah supaya test sandbox menjalankan kode yang sama (tests/network-barter.sandbox.test.ts).
// Tiga agent menandatangani `terms_hash`, akun solver memanggil `commit_bundle`, lalu tiap leg dibayar dengan voucher ber-`bundleId`.
// Langkah ini harus berjalan sebelum pembayaran F2 pada pasangan yang sama: verifikasi menolak leg bila kumulatif melewati `max_amount`.
import { signBundle, termsHash, type BundleTerms, type CircleViewFn, type ContractCall } from "@x207/core";
import { LEG_AMOUNT, RING_MEMBERS, payLegs } from "../agents/scenario/ring.ts";
import type { AgentIdentity } from "../agents/shared/identity.ts";
import { AGENTS, type AgentName } from "../agents/shared/registry.ts";
import { createAgentBuyer } from "../agents/shared/x207.ts";

export type BarterStepOptions = {
  view: CircleViewFn;
  /** Mengirim satu panggilan kontrak dari akun solver dan mengembalikan nilai suksesnya (`bundle_id`). */
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
  log(`== F5 barter bundle (epoch ${epoch}, cincin ${RING_MEMBERS.join(" -> ")})`);
  // get_bundle ada sejak antarmuka 0.0.4; kontrak lama menolak panggilan view itu, jadi langkah dilewati.
  const supported = await view("get_bundle", { bundle_id: 1 }).then(() => true, () => false);
  if (!supported) {
    log(`   dilewati: ${contract} belum punya get_bundle (antarmuka sebelum 0.0.4). Isi CIRCLE_CONTRACT dengan alamat 0.0.4.`);
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
  log(`   terms_hash ${hash}, ${legs.length} leg masing-masing ${LEG_AMOUNT}`);
  const bundleId = Number(
    await o.send({ receiverId: contract, methodName: "commit_bundle", args: { bundle: { epoch, legs }, signatures }, deposit: 0n, gas: 200_000_000_000_000n }),
  );
  log(`   bundle ${bundleId} di-commit`);
  // facilitator membaca blok final: tunggu bundle terlihat sebelum membayar leg
  for (let i = 0; i < 60 && !(await view("get_bundle", { bundle_id: bundleId })); i++) await sleep(1_000);
  const pairs = new Set(legs.map((l) => `${l.payer}>${l.payee}`));
  const buyers = Object.fromEntries(
    RING_MEMBERS.map((n) => [n, createAgentBuyer(identity[n], { rpcUrls: [o.rpcUrl], bundleFor: (payee, e) => (e === epoch && pairs.has(`${accounts[n]}>${payee}`) ? bundleId : undefined) })]),
  );
  const paid = await payLegs((buyer, seller) => buyers[buyer]!(`${urls[seller]}/api/${AGENTS[seller].verb}?input=halo`));
  for (const [pair, amount] of Object.entries(paid)) log(`   leg ${pair} dibayar ${amount}`);
  return { status: "done", bundleId, termsHash: hash, terms, paid };
}
