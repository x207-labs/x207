// Cross review of the code of batch 1 of the barter catalogue (#1 to #10) as an attacker: the templates of the SDK (SD-061, asset-templates.ts), the listing form of the
// frontend (FE-023, assetForm.ts) and the scenario of the agents (AG-023), against what the contract checks (CT-075, CT-090, CT-092) and what the backend checks (BE-049).
// No file of `sdk`, `frontend` or `agents` is changed. Unit tests only, no sandbox. A test with `it.fails` asserts the safe behaviour and passes only while the problem
// exists (the convention of security-review-sdk.test.ts): when the code is fixed that test fails and becomes a plain `it`. Plain `it` tests record a question that was
// asked and answered "no problem". Findings are written in backend/docs/security-review-batch1.md.
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { AssetTemplateError, buildAssetTemplate, validateListing, type AssetInput, type Listing } from "@x207/core";
import { KIND_FIELDS, toAssetInput, tokenToAtomic } from "../frontend/src/lib/assetForm.ts";
import { batch1Inputs, BATCH1_KINDS } from "../agents/test/batch1-scenario.ts";

const NOW = 1_793_000_000;
const common = { unitPrice: "1000000", expiresAt: NOW + 3600 };
const KEYS = {
  ftOnly: ["ft_contract", "amount"],
  nft: ["nft_contract", "token_id"],
  mt: ["mt_contract", "token_id", "amount"],
};

const inputs: Record<string, AssetInput> = {
  nft: { kind: "nft", name: "Art", nftContract: "art.near", tokenId: "42", ...common },
  ticket: { kind: "ticket", event: { name: "Conf", startsAt: NOW + 7200, endsAt: NOW + 10_000 }, nftContract: "tix.near", tokenId: "A1", ...common },
  "game-item": { kind: "game-item", game: { name: "Quest", collection: "swords" }, nftContract: "game.near", tokenId: "s7", ...common },
  coupon: { kind: "coupon", description: "10 percent off", validUntil: NOW + 5000, nftContract: "cpn.near", tokenId: "c1", ...common },
  license: { kind: "license", product: "Studio", termsHash: "ab".repeat(32), seats: 3, nftContract: "lic.near", tokenId: "seat-1", ...common },
  ft: { kind: "ft", ftContract: "usdc.token.near", amount: "2500000", decimals: 6, symbol: "USDC", ...common },
  rwa: { kind: "rwa", ftContract: "rwa.token.near", amount: "5000", decimals: 6, symbol: "BOND", whitelist: { circleContract: true, grantor: true }, ...common },
  lst: { kind: "lst", ftContract: "meta-pool.near", amount: "1000000000000000000000000", decimals: 24, symbol: "stNEAR", ...common },
  "intents-balance": { kind: "intents-balance", mtContract: "intents.near", tokenId: "nep141:usdc.near", amount: "250", ...common },
  "pool-share-ft": { kind: "pool-share", pool: "NEAR-USDC", standard: "nep141", ftContract: "lp.near", amount: "99", decimals: 18, symbol: "LP", ...common },
  "pool-share-mt": { kind: "pool-share", pool: "NEAR-USDC", standard: "nep245", mtContract: "amm.near", tokenId: "pool-3", amount: "99", ...common },
};

/** The listing that the frontend would post for a template: the offered side and the detail. */
const listingOf = (detail: string, side: { asset_type: string; asset_class: "A"; quantity: number; value: string }, expiresAt = NOW + 3600): Listing => ({
  circle: "x207-circle.near", account: "andi.x207-circle.near", offer: side,
  want: { asset_type: "translation", asset_class: "B", quantity: 1, value: "1000000" },
  terms: "deliver within 24h", detail, expires_at: expiresAt, discount_bps: 0, accept_payment: true, discoverable: true, nonce: "n1",
} as Listing);

const code = (fn: () => unknown): string => {
  try {
    fn();
    return "no error";
  } catch (e) {
    return e instanceof AssetTemplateError ? e.code : `other: ${String(e)}`;
  }
};

describe("batch 1 review: can the template make a listing whose scope differs from what the escrow checks?", () => {
  it("TC-XR1-01 [no problem] for the eleven inputs, the scope of the grant, the keys of the detail and the arguments of the deposit say the same thing", () => {
    for (const [name, input] of Object.entries(inputs)) {
      const t = buildAssetTemplate(input, NOW);
      const scope = JSON.parse(t.scope) as Record<string, string>;
      const detail = JSON.parse(t.detail) as Record<string, unknown>;
      expect(JSON.parse(t.grantInput.limits.scope), name).toEqual(scope);
      for (const [k, v] of Object.entries(scope)) expect(detail[k], `${name}.${k}`).toBe(v);
      const call = t.deposit("circle.near", 7);
      const args = call.args as Record<string, unknown>;
      const contractKey = Object.keys(scope).find((k) => k.endsWith("_contract")) as string;
      expect(call.receiverId, name).toBe(scope[contractKey]);
      if ("amount" in scope) expect(args.amount, name).toBe(scope.amount);
      if ("token_id" in scope && contractKey === "mt_contract") expect(args.token_id, name).toBe(scope.token_id);
      if (contractKey === "nft_contract") expect(args.token_id, name).toBe(scope.token_id);
      expect(t.grantInput.asset_type, name).toBe(t.assetType);
      expect(t.side.asset_type, name).toBe(t.assetType);
      expect(Object.keys(scope).sort(), name).toEqual((contractKey === "nft_contract" ? KEYS.nft : contractKey === "ft_contract" ? KEYS.ftOnly : KEYS.mt).slice().sort());
    }
  });

  it("TC-XR1-02 [no problem] the grant expires at the second that was asked, in nanoseconds, and a listing side is one lot worth the price", () => {
    const t = buildAssetTemplate(inputs.ft!, NOW);
    expect(t.grantInput.limits.expires_at).toBe(`${(NOW + 3600) * 1_000_000_000}`);
    expect(t.side).toMatchObject({ quantity: 1, value: "1000000", asset_class: "A" });
  });

  // FINDING X1: a token id that is not ASCII passes the template, but `Listing.detail` must be ASCII. The grant and the deposit do not look at the detail, so the owner
  // can offer the grant and put the asset in escrow, and only then the listing is refused: the asset waits in escrow until the grant has expired.
  it.fails("TC-XR1-03 [finding X1] a template that succeeds gives a detail that is a valid listing (a non-ASCII token id must be refused by the template)", () => {
    const input: AssetInput = { kind: "nft", nftContract: "art.near", tokenId: "tök-1", unitPrice: "1000000", expiresAt: NOW + 3600 };
    const t = buildAssetTemplate(input, NOW);
    expect(() => validateListing(listingOf(t.detail, t.side))).not.toThrow();
  });
});

describe("batch 1 review: controls (the same calls with harmless input succeed, so each finding above is about the input it names)", () => {
  it("TC-XR1-00 an ASCII token id builds a valid listing, decimals typed as 6 are read as 6, and a harmless description is accepted", () => {
    const t = buildAssetTemplate({ kind: "nft", nftContract: "art.near", tokenId: "tok-1", unitPrice: "1000000", expiresAt: NOW + 3600 }, NOW);
    expect(() => validateListing(listingOf(t.detail, t.side))).not.toThrow();
    const input = toAssetInput("ft", { ftContract: "usdc.near", symbol: "USDC", decimals: "6", amount: "2.5", price: "1", hours: "6" }, NOW);
    expect((input as { decimals: number; amount: string }).decimals).toBe(6);
    expect((input as { amount: string }).amount).toBe("2500000");
    expect(code(() => buildAssetTemplate({ ...(inputs.coupon as Extract<AssetInput, { kind: "coupon" }>), description: "20 percent off at the store" }, NOW))).toBe("no error");
  });
});

describe("batch 1 review: are amounts, decimals or token ids rounded or cut anywhere?", () => {
  it("TC-XR1-04 [no problem] the amounts of the SDK are exact strings up to u128, and the display is computed on the digits, not on a float", () => {
    const t = buildAssetTemplate({ ...(inputs.lst as Extract<AssetInput, { kind: "lst" }>), amount: "340282366920938463463374607431768211455", decimals: 24 }, NOW);
    expect(JSON.parse(t.scope).amount).toBe("340282366920938463463374607431768211455");
    expect((JSON.parse(t.detail) as { display: string }).display).toBe("340282366920938.463463374607431768211455 stNEAR");
    expect(code(() => buildAssetTemplate({ ...(inputs.ft as Extract<AssetInput, { kind: "ft" }>), amount: "340282366920938463463374607431768211456" }, NOW))).toBe("bad_amount");
    for (const bad of ["0", "-1", "1.5", "1e6", "0x10", " 5", "5 ", "", "+5"]) expect(code(() => buildAssetTemplate({ ...(inputs.ft as Extract<AssetInput, { kind: "ft" }>), amount: bad }, NOW)), bad).toBe("bad_amount");
  });

  it("TC-XR1-05 [no problem] the form turns a full amount into the smallest unit without losing a digit and refuses more fraction digits than the token has", () => {
    expect(tokenToAtomic("2.5", 6)).toBe("2500000");
    expect(tokenToAtomic("123456789.123456789123456789", 18)).toBe("123456789123456789123456789");
    expect(tokenToAtomic("0.000001", 6)).toBe("1");
    expect(tokenToAtomic("1.0000001", 6)).toBeNull();
    for (const bad of ["1e6", "1,5", "+5", "-5", "0", "0.0", ".5", "5.", "0x10", "1_000", "١"]) expect(tokenToAtomic(bad, 6), bad).toBeNull();
    expect(tokenToAtomic("5", 0)).toBe("5");
    expect(tokenToAtomic("5.1", 0)).toBeNull();
  });

  it("TC-XR1-06 [no problem] a token id is kept byte for byte, and the multi-token amount of the form is not parsed as a number", () => {
    const id = "nep141:usdt.tether-token.near";
    const input = toAssetInput("intents-balance", { mtContract: "intents.near", tokenId: id, amount: "750000", price: "1", hours: "6" }, NOW) as AssetInput;
    expect(input).toMatchObject({ tokenId: id, amount: "750000" });
    const frac = toAssetInput("intents-balance", { mtContract: "intents.near", tokenId: id, amount: "2.5", price: "1", hours: "6" }, NOW) as AssetInput;
    expect(code(() => buildAssetTemplate(frac, NOW))).toBe("bad_amount");
    const big = toAssetInput("intents-balance", { mtContract: "intents.near", tokenId: id, amount: "9007199254740993", price: "1", hours: "6" }, NOW) as Extract<AssetInput, { kind: "intents-balance" }>;
    expect(big.amount).toBe("9007199254740993");
  });

  // FINDING X2: the form reads the decimals of the token with `Number(text)`, so "0x6" is 6 and "1e1" is 10. Nothing is rounded, but a text that is not a plain integer is
  // silently read as another number, and the amount in the smallest unit is computed from it.
  it.fails("TC-XR1-07 [finding X2] decimals typed as 0x6 or 1e1 are refused, not read as 6 and 10", () => {
    const v = { ftContract: "usdc.near", symbol: "USDC", decimals: "0x6", amount: "2.5", price: "1", hours: "6" };
    const input = toAssetInput("ft", v, NOW);
    const odd = typeof input === "string" ? "refused" : String((input as { decimals: number }).decimals);
    expect(odd).toBe("refused");
    const input2 = toAssetInput("ft", { ...v, decimals: "1e1" }, NOW);
    expect(typeof input2 === "string" ? "refused" : String((input2 as { decimals: number }).decimals)).toBe("refused");
  });

  // FINDING X3: the display ("2.5 USDC") and the amount in the smallest unit come from the decimals that the OWNER typed. Nothing compares them with `ft_metadata` of the
  // token, and nothing in the warnings says so. A grantor (or a slip) with 2 decimals for a 6-decimal token lists "2.5 USDC" for 250 units, which is 0.00025 USDC.
  it.fails("TC-XR1-08 [finding X3] the warnings of a fungible token say that the decimals and the symbol were not checked against the token", () => {
    const t = buildAssetTemplate(inputs.ft!, NOW);
    expect(t.warnings.join(" ")).toMatch(/desimal.*(belum|tidak) (diperiksa|diverifikasi)|(belum|tidak) (diperiksa|diverifikasi).*desimal/i);
  });
});

describe("batch 1 review: do the risk warnings always appear?", () => {
  const FEE = /biaya transfer/i;
  const REGISTER = /storage_deposit/;
  const KINDS_WITH_TOKEN_FEE = ["ft", "rwa", "lst", "intents-balance", "pool-share-ft", "pool-share-mt"];

  it("TC-XR1-09 [no problem] the fee-token warning is in every kind that moves a fungible amount, and absent from the NFT kinds", () => {
    for (const name of KINDS_WITH_TOKEN_FEE) expect(buildAssetTemplate(inputs[name]!, NOW).warnings.join(" "), name).toMatch(FEE);
    for (const name of ["nft", "ticket", "game-item", "coupon", "license"]) expect(buildAssetTemplate(inputs[name]!, NOW).warnings.join(" "), name).not.toMatch(FEE);
  });

  it("TC-XR1-10 [no problem] the buyer-registration warning is in every NEP-141 kind, and the RWA rules warning is in every RWA listing, whatever the whitelist input", () => {
    for (const name of ["ft", "rwa", "lst", "pool-share-ft"]) expect(buildAssetTemplate(inputs[name]!, NOW).warnings.join(" "), name).toMatch(REGISTER);
    const rwa = inputs.rwa as Extract<AssetInput, { kind: "rwa" }>;
    for (const whitelist of [undefined, { circleContract: true, grantor: true }, { circleContract: true, grantor: true, buyer: false }, { circleContract: true, grantor: true, buyer: true }]) {
      const w = buildAssetTemplate({ ...rwa, ...(whitelist ? { whitelist } : { whitelist: undefined }) } as AssetInput, NOW).warnings.join(" ");
      expect(w, JSON.stringify(whitelist)).toMatch(/aturan penerbitnya/);
    }
    expect(buildAssetTemplate({ ...rwa, whitelist: undefined } as AssetInput, NOW).warnings.join(" ")).toMatch(/belum diperiksa/);
    expect(buildAssetTemplate({ ...rwa, whitelist: { circleContract: true, grantor: true, buyer: false } }, NOW).warnings.join(" ")).toMatch(/Pembeli belum ada di whitelist/);
  });

  it("TC-XR1-11 [no problem] an RWA token is refused by the template when the circle or the grantor is not on the whitelist of the token", () => {
    const rwa = inputs.rwa as Extract<AssetInput, { kind: "rwa" }>;
    for (const whitelist of [{ circleContract: false, grantor: true }, { circleContract: true, grantor: false }, { circleContract: false, grantor: false }]) {
      expect(code(() => buildAssetTemplate({ ...rwa, whitelist }, NOW)), JSON.stringify(whitelist)).toBe("rwa_not_whitelisted");
    }
  });

  it("TC-XR1-12 [no problem] the form shows the warnings of the template as they are, for every kind that builds", () => {
    // the component renders `template.warnings` in a list; the form has no list of its own, so what appears is what the template says
    for (const kind of Object.keys(KIND_FIELDS)) expect(KIND_FIELDS[kind as keyof typeof KIND_FIELDS].fields.length, kind).toBeGreaterThan(0);
  });

  // FINDING X4: for an RWA token the owner can say nothing about the whitelist of THE CIRCLE (the backend refuses `rwa:tokenized` unless the contract is on its
  // `rwaWhitelist`), and the template says nothing about it. In the order the form allows (grant, deposit, then the listing) a listing that the backend refuses leaves the
  // token in escrow until the grant has expired.
  it.fails("TC-XR1-13 [finding X4] the warnings of an RWA listing say that the circle keeps its own list of accepted tokens and that the listing can be refused", () => {
    const w = buildAssetTemplate(inputs.rwa!, NOW).warnings.join(" ");
    expect(w).toMatch(/(daftar|whitelist) (milik )?(lingkaran|circle)/i);
  });
});

describe("batch 1 review: can a secret get into the detail of a listing?", () => {
  const SECRET_KEY = `ed25519:${"5".repeat(88)}`;
  const withText = (kind: string, text: string): AssetInput => {
    const base = inputs[kind === "label" ? "intents-balance" : kind === "name" ? "nft" : kind === "description" ? "coupon" : kind === "product" ? "license" : kind === "valueInfo" ? "pool-share-mt" : "lst"]!;
    if (kind === "label") return { ...(base as Extract<AssetInput, { kind: "intents-balance" }>), label: text };
    if (kind === "name") return { ...(base as Extract<AssetInput, { kind: "nft" }>), name: text };
    if (kind === "description") return { ...(base as Extract<AssetInput, { kind: "coupon" }>), description: text };
    if (kind === "product") return { ...(base as Extract<AssetInput, { kind: "license" }>), product: text };
    if (kind === "valueInfo") return { ...(base as Extract<AssetInput, { kind: "pool-share" }>), valueInfo: text } as AssetInput;
    return { ...(base as Extract<AssetInput, { kind: "lst" }>), rate: { nearPerToken: "1.05", source: text, asOf: NOW - 60 } };
  };

  it("TC-XR1-14 [no problem] a key named code, secret, password or api_key cannot be put in the detail by a field of the template", () => {
    // the template writes fixed keys; the only free text lands in values, never in keys
    const t = buildAssetTemplate(inputs.coupon!, NOW);
    expect(Object.keys(JSON.parse(t.detail))).not.toEqual(expect.arrayContaining(["code"]));
  });

  // FINDING X5: `secret_in_listing` looks at the NAMES of the keys of the detail, not at the free text in the values (name, description, product, label, source, valueInfo),
  // so a coupon code, a password or a key typed in a free text field is written into a listing that everybody can read.
  it.fails("TC-XR1-15 [finding X5] a private key of an account typed into a free text field is refused", () => {
    for (const field of ["name", "description", "product", "label", "valueInfo", "source"]) {
      expect(code(() => buildAssetTemplate(withText(field, `my key ${SECRET_KEY}`), NOW)), field).toBe("secret_in_listing");
    }
  });

  it.fails("TC-XR1-16 [finding X5] a password or an API key written as text in a free text field is refused", () => {
    for (const text of ["password=hunter2", "api_key: sk_live_4eC39HqLyjWDarjtT1zdp7dc", "token ghp_16C7e42F292c6912E7710c838347Ae178B4a", "redeem code SAVE50-ABCD-1234 at checkout"]) {
      expect(code(() => buildAssetTemplate(withText("description", text), NOW)), text).toBe("secret_in_listing");
    }
  });
});

describe("batch 1 review: are the validation of the backend (BE-049) and the templates of the SDK (SD-061) the same for the ten kinds?", () => {
  const require = createRequire(new URL("../backend/package.json", import.meta.url));
  const Database = require("better-sqlite3") as new (path: string) => { exec(sql: string): void; prepare(sql: string): { run(...a: unknown[]): unknown; get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[]; safeIntegers(on: boolean): unknown }; close(): void };

  async function backendCheck(options: { rwaWhitelist?: string[]; intentsId?: string; usdtTokenId?: string }, assetTypes: string[]) {
    const { scopeCheck } = (await import("../backend/src/marketplace/listing-scope.ts")) as typeof import("../backend/src/marketplace/listing-scope.ts");
    const db = new Database(":memory:");
    db.exec("CREATE TABLE asset_classes (circle_id TEXT, asset_type TEXT, class TEXT, block_height INT, receipt_id TEXT, log_index INT)");
    for (const t of assetTypes) db.prepare("INSERT INTO asset_classes VALUES ('agents-main', ?, 'A', 1, 'r', 0)").run(t);
    const check = scopeCheck(options);
    return (listing: Listing): string => {
      try {
        check(listing, { db: db as never, circleId: "agents-main", nowS: NOW });
        return "accepted";
      } catch (e) {
        return `refused: ${(e as Error).message}`;
      }
    };
  }

  it("TC-XR1-17 [no problem] every template that the SDK builds for the ten kinds passes the check of the backend when the circle has registered the type and whitelisted the RWA token", async () => {
    const types = Object.values(inputs).map((i) => buildAssetTemplate(i, NOW).assetType);
    const run = await backendCheck({ rwaWhitelist: ["rwa.token.near"], intentsId: "intents.near", usdtTokenId: "usdt.token.near" }, types);
    for (const [name, input] of Object.entries(inputs)) {
      const t = buildAssetTemplate(input, NOW);
      expect([name, run(listingOf(t.detail, t.side, Number(BigInt(t.grantInput.limits.expires_at) / 1_000_000_000n)))]).toEqual([name, "accepted"]);
    }
  });

  it("TC-XR1-18 [no problem] the inputs of the scenario AG-023 pass the check of the backend", async () => {
    const world = { nft: "nft.near", tokens: { ft: "ft.near", rwa: "rwa.near", lst: "lst.near" }, mt: "intents.near" };
    const batch = batch1Inputs(world, NOW);
    const types = BATCH1_KINDS.map((k) => buildAssetTemplate(batch[k], NOW).assetType);
    const run = await backendCheck({ rwaWhitelist: ["rwa.near"], intentsId: "intents.near", usdtTokenId: "usdt.token.near" }, types);
    for (const kind of BATCH1_KINDS) {
      const t = buildAssetTemplate(batch[kind], NOW);
      expect([kind, run(listingOf(t.detail, t.side, Number(BigInt(t.grantInput.limits.expires_at) / 1_000_000_000n)))]).toEqual([kind, "accepted"]);
    }
  });

  it("TC-XR1-19 [no problem] the backend and the SDK name the same asset types, the same kinds, and the same delivery method for the ten kinds", async () => {
    const { ESCROW_ASSET_TYPES } = (await import("../backend/src/marketplace/listing-scope.ts")) as typeof import("../backend/src/marketplace/listing-scope.ts");
    const methodOf = (t: ReturnType<typeof buildAssetTemplate>) => t.deliveryMethod;
    for (const [name, input] of Object.entries(inputs)) {
      const t = buildAssetTemplate(input, NOW);
      const entry = ESCROW_ASSET_TYPES[t.assetType];
      expect(entry, `${name} ${t.assetType}`).toBeDefined();
      expect(entry!.kind, name).toBe(input.kind);
      expect(entry!.delivery, name).toContain(methodOf(t));
    }
  });

  // FINDING X6: the SDK does not know the USDT of the circle. An `ft`, `lst` or pool-share listing whose token is the USDT of the circle passes the template, and the
  // contract refuses the deposit (`ERR_ESCROW_USDT`), so such a listing can never be bought. (The backend check of BE-049 is to refuse it when it is told the USDT; this test
  // is about the SDK, which has no input for it.)
  it.fails("TC-XR1-20 [finding X6] the template can be told the USDT of the circle and refuses it as the asset of a token escrow", () => {
    const usdt = "usdt.tether-token.near";
    const input = { ...(inputs.ft as Extract<AssetInput, { kind: "ft" }>), ftContract: usdt };
    const options = { circleUsdt: usdt };
    expect(code(() => (buildAssetTemplate as unknown as (i: AssetInput, n: number, o?: unknown) => unknown)(input, NOW, options))).not.toBe("no error");
  });
});
