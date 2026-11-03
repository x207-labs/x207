// UM-093: rehearsal of the interface 0.0.12 on NEAR testnet, with the wasm DOWNLOADED FROM THE RELEASE v0.0.12 (X207_RELEASE_WASM), not a local build. In a new circle:
//   1. the code_hash of the account equals the base58 of the sha256 of the release wasm, and `interface_version` is 0.0.12;
//   2. a deal with a bond that both parties confirm (`commit_bundle` with an arbiter, `bond_locked`, `confirm_deal` twice, the bonds are released);
//   3. a deal with a bond that ends in `rule_deal(accused_guilty)`: the bond of the accused goes to the stake of the complainant;
//   4. `propose_freeze`; `apply_freeze` needs 24 hours (the timelock) and the testnet cannot fast-forward: the run records the proposal and its `eta`, and a later run of the same
//      test (same account) applies it once the chain time passed the `eta`, otherwise it is recorded as waiting;
//   5. the list of official contracts: a token of another contract is refused at the offer, at the deposit (the tokens come back) and a held escrow of such a token cannot be bought.
// Every transaction hash goes to X207_UM093_OUT (docs/testnet-0.0.12.json) from the first one on: names and hashes only, no keys. Testnet only; keys stay in .secrets/.
// Create the two accounts first: node scripts/create-faucet-accounts.mjs --keys-dir ../../.secrets/testnet-deployer x207-v012.testnet x207-v012-aux.testnet
// Run: X207_TESTNET=1 X207_RELEASE_WASM=/path/x207-circle-v0.0.12.wasm X207_UM093_OUT=$PWD/docs/testnet-0.0.12.json npx vitest run tests/testnet-0.0.12.live.test.ts
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAssetTemplate, createCircleViewFn, generateVoucherKeypair, onboardMember, signBundle, bundleInput, type AssetInput, type BundleTerms, type ContractCall } from "@x207/core";
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner } from "../backend/node_modules/near-api-js/lib/index.js";
import { Recorder, patient } from "./support/testnet-kit.ts";

const ENABLED = process.env.X207_TESTNET === "1";
const RPC = process.env.X207_TESTNET_RPC ?? "https://rpc.testnet.fastnear.com";
const CIRCLE = "x207-v012.testnet";
const AUX = "x207-v012-aux.testnet";
const USDT = "usdt.x207-deployer.testnet";
const TERMS_HASH = "a".repeat(64);
const STAKE = "300000000";
const CREDIT = 1_000_000n;
const HOUR_NS = 3_600_000_000_000n;
const secretsDir = resolve("../../.secrets/testnet-deployer");
const contractsDir = resolve("contracts/target/near");
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const base58 = (hex: string): string => {
  let n = BigInt(`0x${hex}`);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  return out;
};
const events = (logs: string[]): Array<Record<string, any> & { event: string }> =>
  logs.filter((l) => l.startsWith("EVENT_JSON:")).map((l) => JSON.parse(l.slice("EVENT_JSON:".length)) as Record<string, any> & { event: string });

describe.skipIf(!ENABLED)("UM-093: interface 0.0.12 on testnet with the wasm of the release v0.0.12", () => {
  it("deploys the release and runs two deals with bonds, a freeze proposal and the list of official contracts", async () => {
    const wasmPath = process.env.X207_RELEASE_WASM ?? "";
    if (!wasmPath) throw new Error("X207_RELEASE_WASM must name the wasm downloaded from the release");
    const wasm = readFileSync(wasmPath);
    const wasmSha = createHash("sha256").update(wasm).digest("hex");
    const outPath = process.env.X207_UM093_OUT ?? resolve("docs/testnet-0.0.12.json");
    const recorder = new Recorder(outPath, {
      contract: CIRCLE, aux: AUX, usdt: USDT,
      release: { tag: "v0.0.12", wasmSha256: wasmSha, codeHash: base58(wasmSha), source: "gh release download v0.0.12 --repo x207-labs/contracts" },
    });
    const provider = new JsonRpcProvider({ url: RPC });
    const keyOf = (id: string): string => {
      const file = join(secretsDir, "testnet", `${id}.json`);
      const j = JSON.parse(readFileSync(file, "utf8")) as { private_key?: string; secret_key?: string };
      return (j.private_key ?? j.secret_key) as string;
    };
    const accountOf = (id: string, secret: string) => new Account(id, provider, KeyPairSigner.fromSecretKey(secret as never));
    const owner = accountOf(CIRCLE, keyOf(CIRCLE));
    const aux = accountOf(AUX, keyOf(AUX));
    const keysPath = join(secretsDir, "um093-v012.json");
    const saved: Record<string, { tx: string; voucher: string }> = existsSync(keysPath) ? JSON.parse(readFileSync(keysPath, "utf8")) : {};

    const rpc = (method: string, params: unknown) =>
      patient(async () => {
        const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        const body = (await response.json().catch(() => ({ error: `HTTP ${response.status}` }))) as { result?: any; error?: unknown };
        if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)} ${response.status}`);
        return body.result;
      });
    const view = async <T>(contract: string, method: string, args: object = {}): Promise<T> => {
      const r = await rpc("query", { request_type: "call_function", finality: "optimistic", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
      return JSON.parse(Buffer.from(r.result).toString("utf8")) as T;
    };
    const hasCode = async (id: string): Promise<boolean> => ((await rpc("query", { request_type: "view_account", finality: "final", account_id: id })) as { code_hash: string }).code_hash !== "11111111111111111111111111111111";

    type Call = { receiverId: string; methodName: string; args: object; deposit?: bigint; gas?: bigint };
    /** Sends one call, records its hash, and returns the failures instead of throwing (some calls of the scenario are meant to fail). */
    const raw = async (account: Account, step: string, call: Call): Promise<{ failures: string[]; logs: string[]; value: unknown }> => {
      let r: any;
      try {
        r = (await patient(() =>
        account.callFunctionRaw({ contractId: call.receiverId, methodName: call.methodName, args: call.args, deposit: call.deposit ?? 0n, gas: call.gas ?? 150_000_000_000_000n, waitUntil: "FINAL" }),
      )) as any;
      } catch (error) {
        // the call itself panicked: the node throws; the refusal is the answer that the scenario wants
        const e = error as { message?: string; transaction_outcome?: { id?: string }; transaction?: { hash?: string } };
        const text = String(e.message ?? error);
        if (!/panicked|ContractExecutionError|Smart contract/.test(text)) throw error;
        const hash = e.transaction_outcome?.id ?? e.transaction?.hash;
        if (hash) recorder.add({ step: `${step} (refused)`, account: account.accountId, method: call.methodName, hash });
        return { failures: [text.slice(0, 300)], logs: [], value: undefined };
      }
      recorder.add({ step, account: account.accountId, method: call.methodName, hash: r.transaction_outcome.id });
      const failures = [r.status, ...(r.receipts_outcome ?? []).map((o: any) => o.outcome.status)]
        .filter((s) => s && typeof s === "object" && "Failure" in s)
        .map((s) => JSON.stringify(s).slice(0, 300));
      const logs = ((r.receipts_outcome ?? []) as any[]).flatMap((o) => o.outcome.logs as string[]);
      const sv = r.status?.SuccessValue;
      return { failures, logs, value: sv ? JSON.parse(Buffer.from(sv, "base64").toString("utf8")) : undefined };
    };
    const send = async (account: Account, step: string, call: Call): Promise<unknown> => {
      const r = await raw(account, step, call);
      if (r.failures.length > 0) throw new Error(`${step} ${call.methodName}: ${r.failures.join("; ")}`);
      return r.value;
    };
    const create = async (parent: Account, id: string, near: bigint, step: string): Promise<Account> => {
      if (!saved[id]) {
        saved[id] = { tx: KeyPair.fromRandom("ed25519").toString(), voucher: generateVoucherKeypair().secretKey };
        writeFileSync(keysPath, JSON.stringify(saved));
      }
      const exists = await rpc("query", { request_type: "view_account", finality: "final", account_id: id }).then(() => true, () => false);
      if (!exists) {
        const created = (await patient(() => parent.createAccount({ newAccountId: id, publicKey: KeyPair.fromString(saved[id]!.tx as never).getPublicKey(), nearToTransfer: near }))) as any;
        recorder.add({ step, account: parent.accountId, method: "create_account", hash: created.transaction_outcome.id });
        // the final block of the RPC node may not know the account yet
        for (let i = 0; i < 30; i += 1) {
          if (await rpc("query", { request_type: "view_account", finality: "final", account_id: id }).then(() => true, () => false)) break;
          await new Promise<void>((r) => setTimeout(r, 2000));
        }
      }
      return accountOf(id, saved[id]!.tx);
    };
    const deployMock = async (name: string, wasmFile: string, funding: bigint): Promise<Account> => {
      const id = `${name}.${AUX}`;
      const account = await create(aux, id, funding, `account ${name}`);
      if (!(await hasCode(id))) {
        const deployed = (await patient(() => account.deployContract(readFileSync(join(contractsDir, wasmFile))))) as any;
        recorder.add({ step: `deploy ${name}`, account: id, method: "deploy_contract", hash: deployed.transaction_outcome.id });
        await send(account, `init ${name}`, { receiverId: id, methodName: "new", args: {} });
      }
      return account;
    };


    // ---- the circle: the code of the release, then init (once)
    if (!(await hasCode(CIRCLE))) {
      const deployed = (await patient(() => owner.deployContract(wasm))) as any;
      recorder.add({ step: "deploy", account: CIRCLE, method: "deploy_contract", hash: deployed.transaction_outcome.id });
      await send(owner, "init", {
        receiverId: CIRCLE, methodName: "new",
        args: {
          owner_id: CIRCLE, circle_id: "agents-main", usdt_token_id: USDT, intents_id: "intents.testnet",
          params: { epoch_length: 86_400, payment_window: 900, proposal_window: 60, base_limit_ratio: 8000, limit_growth: 1000, limit_cap: "1000000000", limit_decay: 0, fees: { clearing_fee_bps: 0, solver_fee_bps: 0 }, admission: "open" },
        },
      });
    }
    const codeHash = ((await rpc("query", { request_type: "view_account", finality: "final", account_id: CIRCLE })) as { code_hash: string }).code_hash;
    expect(codeHash).toBe(base58(wasmSha));
    expect(await view<string>(CIRCLE, "interface_version")).toBe("0.0.12");
    const result: Record<string, unknown> = { codeHash };
    const finish = () => {
      const header = JSON.parse(readFileSync(outPath, "utf8")) as Record<string, unknown>;
      writeFileSync(outPath, JSON.stringify({ ...header, result }, null, 2));
    };

    // ---- members alice and bob (the parties), an arbiter account (not a member)
    const circleView = createCircleViewFn({ circleContract: CIRCLE, rpcUrls: [RPC] });
    const members = {} as Record<"alice" | "bob", Account>;
    for (const name of ["alice", "bob"] as const) {
      const id = `${name}.${CIRCLE}`;
      members[name] = await create(owner, id, 800_000_000_000_000_000_000_000n, `account ${name}`);
      const existing = await view<{ status: string } | null>(CIRCLE, "member", { account_id: id });
      if (existing?.status !== "active") {
        await send(members[name], `usdt ${name}`, { receiverId: USDT, methodName: "mint", args: { account_id: id, amount: "1000000000" } });
        const joined = await onboardMember(
          {
            sendCall: (c: ContractCall) => send(members[name], `onboard ${name}`, { receiverId: c.receiverId, methodName: c.methodName, args: c.args, deposit: BigInt(c.deposit ?? 0), ...(c.gas ? { gas: BigInt(c.gas) } : {}) }),
            view: circleView, pollIntervalMs: 2000, timeoutMs: 120_000,
          },
          { circleContract: CIRCLE, circleId: "agents-main", accountId: id, termsHash: TERMS_HASH, stakeAmount: STAKE, secretKey: saved[id]!.voucher as `ed25519:${string}`, usdtTokenId: USDT },
        );
        expect(joined.member.status).toBe("active");
      }
    }
    const arbiter = await create(owner, `arb.${CIRCLE}`, 600_000_000_000_000_000_000_000n, "account arbiter");
    const have = BigInt((await patient(() => provider.viewAccount({ accountId: arbiter.accountId }))).amount);
    if (have < 400_000_000_000_000_000_000_000n) {
      const sent = (await patient(() => owner.transfer({ receiverId: arbiter.accountId, amount: 600_000_000_000_000_000_000_000n }))) as any;
      recorder.add({ step: "top-up arbiter", account: CIRCLE, method: "transfer", hash: sent.transaction_outcome?.id ?? sent.transaction?.hash });
    }
    const [A, B] = [members.alice.accountId, members.bob.accountId];
    const chainNowNs = async (): Promise<bigint> => BigInt((await rpc("block", { finality: "optimistic" })).header.timestamp_nanosec);
    const epoch = (await view<{ epoch: number }>(CIRCLE, "get_epoch")).epoch;
    const stakeOf = async (id: string): Promise<bigint> => BigInt((await view<{ stake: string }>(CIRCLE, "member", { account_id: id })).stake);
    const locked = async (id: string): Promise<bigint> => BigInt(await view<string>(CIRCLE, "bond_locked", { account_id: id }));

    // ---- a deal: a bundle of two parties with an arbiter. The bond is 20 percent of the largest leg (default `bond_bps` 2000); the threshold is 100 credit (default).
    const dealTerms = async (legsAmount: [bigint, bigint], tag: string): Promise<BundleTerms> => ({
      circle: CIRCLE, epoch,
      legs: [
        { payer: A, payee: B, max_amount: String(legsAmount[0]) },
        { payer: B, payee: A, max_amount: String(legsAmount[1]) },
      ],
      arbiter: arbiter.accountId, agreement_hash: sha(`agreement:${tag}`), confirm_by: String((await chainNowNs()) + 2n * HOUR_NS),
    });
    const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
    const commit = async (terms: BundleTerms, name: string): Promise<number> => {
      const signatures = [A, B].map((id) => signBundle(terms, id, saved[id]!.voucher as `ed25519:${string}`)).map((s) => ({ account_id: s.account, signature: s.signature }));
      const r = await raw(owner, `commit_bundle ${name}`, { receiverId: CIRCLE, methodName: "commit_bundle", args: { bundle: bundleInput(terms), signatures }, gas: 200_000_000_000_000n });
      expect(r.failures, `commit_bundle ${name}`).toEqual([]);
      const e = events(r.logs);
      expect(e.filter((x) => x.event === "bond_locked")).toHaveLength(2);
      return Number(e.find((x) => x.event === "bundle_committed")!.data[0].bundle_id);
    };

    // a resumed run: deals that an earlier run left open are closed first (disputed: no fault; open: both confirm), so that their bonds do not take the slack
    for (let id = 1; id <= 30; id += 1) {
      const left = await view<{ state: string } | null>(CIRCLE, "get_deal", { bundle_id: id });
      if (left === null) continue;
      if (left.state === "disputed") await send(arbiter, `cleanup rule_deal ${id}`, { receiverId: CIRCLE, methodName: "rule_deal", args: { bundle_id: id, verdict: "no_fault" } });
      else for (const who of [members.alice, members.bob]) await raw(who, `cleanup confirm_deal ${id}`, { receiverId: CIRCLE, methodName: "confirm_deal", args: { bundle_id: id } });
    }

    // a bundle reserves headroom for its legs until the epoch ends (24 hours here): two deals of 100 and 110 credit need 210 credit above what earlier deals of this epoch took
    for (const who of [members.alice, members.bob]) {
      if (BigInt(await view<string>(CIRCLE, "headroom", { account_id: who.accountId })) < 220n * CREDIT) {
        await send(who, `usdt ${who.accountId}`, { receiverId: USDT, methodName: "mint", args: { account_id: who.accountId, amount: "300000000" } });
        await send(who, `add stake ${who.accountId}`, {
          receiverId: USDT, methodName: "ft_transfer_call", args: { receiver_id: CIRCLE, amount: "300000000", msg: JSON.stringify({ action: "stake" }) }, deposit: 1n, gas: 100_000_000_000_000n,
        });
      }
    }

    // 2. a deal that both parties confirm
    const lockedBefore = [await locked(A), await locked(B)];
    const confirmedId = await commit(await dealTerms([100n * CREDIT, 100n * CREDIT], "confirmed"), "confirmed");
    const bond = 20n * CREDIT;
    expect([await locked(A), await locked(B)]).toEqual([lockedBefore[0]! + bond, lockedBefore[1]! + bond]);
    expect((await view<{ state: string }>(CIRCLE, "get_deal", { bundle_id: confirmedId })).state).toBe("open");
    await send(members.alice, "confirm_deal alice", { receiverId: CIRCLE, methodName: "confirm_deal", args: { bundle_id: confirmedId } });
    await send(members.bob, "confirm_deal bob", { receiverId: CIRCLE, methodName: "confirm_deal", args: { bundle_id: confirmedId } });
    expect(await view<unknown>(CIRCLE, "get_deal", { bundle_id: confirmedId })).toBeNull();
    expect([await locked(A), await locked(B)]).toEqual(lockedBefore);
    result.confirmedDeal = { bundleId: confirmedId, bondEach: String(bond), releasedAfterTwoConfirmations: true };

    // 3. a deal that ends in a ruling: bob is accused by alice and the arbiter finds him guilty
    const guiltyId = await commit(await dealTerms([110n * CREDIT, 100n * CREDIT], "guilty"), "guilty");
    const [aliceBefore, bobBefore] = [await stakeOf(A), await stakeOf(B)];
    const bondGuilty = 22n * CREDIT; // 20 percent of the largest leg, 110
    await send(members.alice, "dispute_deal", { receiverId: CIRCLE, methodName: "dispute_deal", args: { bundle_id: guiltyId, evidence_hash: sha("evidence") } });
    expect((await view<{ state: string }>(CIRCLE, "get_deal", { bundle_id: guiltyId })).state).toBe("disputed");
    const ruling = await raw(arbiter, "rule_deal accused_guilty", { receiverId: CIRCLE, methodName: "rule_deal", args: { bundle_id: guiltyId, verdict: "accused_guilty" } });
    expect(ruling.failures).toEqual([]);
    const ruled = events(ruling.logs).map((x) => x.event);
    expect(ruled).toContain("deal_ruled");
    expect(ruled).toContain("bond_slashed");
    expect(await stakeOf(A)).toBe(aliceBefore + bondGuilty);
    expect(await stakeOf(B)).toBe(bobBefore - bondGuilty);
    expect([await locked(A), await locked(B)]).toEqual(lockedBefore);
    result.guiltyDeal = { bundleId: guiltyId, bond: String(bondGuilty), stakeOfComplainant: `${aliceBefore} -> ${await stakeOf(A)}`, stakeOfAccused: `${bobBefore} -> ${await stakeOf(B)}` };

    // 4. a freeze: propose now; apply after the timelock (24 hours) in a later run of this test
    let freeze = await view<{ state: string; eta: string } | null>(CIRCLE, "get_freeze", { account_id: B });
    if (freeze === null) {
      await send(owner, "propose_freeze bob", { receiverId: CIRCLE, methodName: "propose_freeze", args: { account_id: B, reason_hash: sha("freeze:bob") } });
      freeze = await view<{ state: string; eta: string }>(CIRCLE, "get_freeze", { account_id: B });
    }
    expect(freeze).not.toBeNull();
    if (freeze!.state === "pending") {
      const now = await chainNowNs();
      if (now >= BigInt(freeze!.eta)) {
        await send(members.alice, "apply_freeze bob", { receiverId: CIRCLE, methodName: "apply_freeze", args: { account_id: B } });
        freeze = await view<{ state: string; eta: string }>(CIRCLE, "get_freeze", { account_id: B });
      }
    }
    result.freeze = freeze!.state === "frozen" ? { state: "frozen", is_frozen: await view<boolean>(CIRCLE, "is_frozen", { account_id: B }) } : { state: "pending", eta: freeze!.eta, waiting: "apply_freeze runs 24 hours after the proposal; run this test again after the eta" };
    expect(await view<boolean>(CIRCLE, "is_frozen", { account_id: B })).toBe(freeze!.state === "frozen");

    // 5. official contracts: the type is class A, the list names one token contract; a token of another contract is refused everywhere
    const nowS = Math.floor(Date.now() / 1000);
    const official = await deployMock("official", "mock_rwa/mock_rwa.wasm", 1_700_000_000_000_000_000_000_000n);
    const fake = await deployMock("fake", "mock_rwa/mock_rwa.wasm", 1_700_000_000_000_000_000_000_000n);
    for (const token of [official, fake]) await send(token, `mint ${token.accountId}`, { receiverId: token.accountId, methodName: "mint", args: { account_id: A, amount: "100000000" } });
    const input = (contract: string): AssetInput => ({ kind: "ft", ftContract: contract, symbol: "TKN", decimals: 6, amount: "2500000", unitPrice: "1000000", expiresAt: nowS + 6 * 3600 });
    const template = (contract: string) => buildAssetTemplate(input(contract), nowS);
    const assetType = template(official.accountId).assetType;
    const known = await view<unknown>(CIRCLE, "get_asset_class", { asset_type: assetType }).catch(() => null);
    if (known === null) {
      const entry = { asset_type: assetType, class: "A", delivery_methods: ["escrow_ft"], accepted_proofs: [], terms_hash: sha(`x207 asset class v1 ${assetType}`) };
      await send(owner, "set_asset_class", { receiverId: CIRCLE, methodName: "set_asset_class", args: { asset_type: assetType, entry } });
    }
    const offer = (contract: string) => raw(members.alice, `offer_grant ${contract.split(".")[0]}`, { receiverId: CIRCLE, methodName: "offer_grant", args: { input: template(contract).grantInput } });
    let earlyId = 0;
    if ((await view<string[]>(CIRCLE, "get_asset_contracts", { asset_type: assetType })).length === 0) {
      const early = await offer(fake.accountId); // before the list exists: accepted
      expect(early.failures).toEqual([]);
      earlyId = Number(early.value);
      await send(owner, "set_asset_contracts", { receiverId: CIRCLE, methodName: "set_asset_contracts", args: { asset_type: assetType, contracts: [official.accountId] } });
    } else {
      // a resumed run: the list is set; the grant that an earlier run offered to the fake token before the list is found by its scope
      for (let id = 1; id <= 60 && earlyId === 0; id += 1) {
        const g = await view<{ status: string; limits: { scope: string } } | null>(CIRCLE, "get_grant", { grant_id: id });
        if (g !== null && g.status === "offered" && g.limits.scope.includes(fake.accountId)) earlyId = id;
      }
      expect(earlyId).toBeGreaterThan(0);
    }
    expect(await view<string[]>(CIRCLE, "get_asset_contracts", { asset_type: assetType })).toEqual([official.accountId]);
    const refusedOffer = await offer(fake.accountId);
    expect(refusedOffer.failures.join(" ")).toContain("ERR_CONTRACT_NOT_OFFICIAL");
    const balanceBefore = BigInt(await view<string>(fake.accountId, "ft_balance_of", { account_id: A }));
    const call = template(fake.accountId).deposit(CIRCLE, earlyId);
    const deposit = await raw(members.alice, "deposit fake token", { receiverId: call.receiverId, methodName: call.methodName, args: call.args as object, deposit: BigInt(call.deposit ?? 0), gas: 150_000_000_000_000n });
    expect(await view<unknown>(CIRCLE, "get_ft_escrow", { grant_id: earlyId })).toBeNull();
    expect(BigInt(await view<string>(fake.accountId, "ft_balance_of", { account_id: A }))).toBe(balanceBefore);
    void deposit;
    const goodId = Number((await offer(official.accountId)).value);
    const goodCall = template(official.accountId).deposit(CIRCLE, goodId);
    await send(members.alice, "deposit official token", { receiverId: goodCall.receiverId, methodName: goodCall.methodName, args: goodCall.args as object, deposit: BigInt(goodCall.deposit ?? 0), gas: 150_000_000_000_000n });
    expect((await view<{ state: string }>(CIRCLE, "get_ft_escrow", { grant_id: goodId })).state).toBe("held");
    result.officialContracts = { assetType, list: [official.accountId], fakeOfferRefused: "ERR_CONTRACT_NOT_OFFICIAL", fakeDepositReturned: true, officialDepositHeld: true };

    finish();
  }, 3_600_000);
});
