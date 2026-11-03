// SV-018 end to end, in process: random checks of deterministic jobs of pipeline P5. Two providers run jobs behind `createMeteredEndpoint` (SD-064); one of them forges
// the result of some jobs. The verifier (a third member) chooses jobs with a secret seed, runs them again, compares the hash of the result, signs a notice and sends it by HTTP
// to the real read API of the backend (BE-053), which checks the signature against the voucher key of the verifier and keeps the notice as evidence. No network, no sandbox.
// The golden vector of the notice (backend/test/marketplace/reputation.test.ts, `3002d87`) is checked on the solver side as well.
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createMeteredEndpoint } from "@x207/scheme";
import { acct, CIRCLE, CONTRACT, NOW_S, startMarket, type Market } from "../backend/test/marketplace/helpers.ts";
import { verifySpotCheckSignature, type SpotCheckNotice as BackendNotice } from "../backend/src/marketplace/reputation.ts";
import { httpReporter, jobHashOf, runSpotChecks, serializeSpotCheck, signSpotCheck, spotCheckHash, type JobRecord, type SpotCheckNotice } from "../solver/src/verifier/index.ts";

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");
/** The deterministic work: the same input always gives the same bytes. */
const work = (input: string): string => JSON.stringify({ input, result: sha(`work:${input}`) });

describe("SV-018 e2e: random checks of P5 jobs, a forged result is found and recorded in the reputation", () => {
  let market: Market | undefined;
  afterEach(async () => {
    await market?.srv.close();
    market?.db.close();
  });

  /** A provider: a metered endpoint whose handler does the work, honestly or with a forged result for the inputs in `forge`. */
  const provider = (forge: ReadonlySet<string>) => {
    const endpoint = createMeteredEndpoint({
      kind: "inference", unitPrice: "$0.01",
      handler: (request) => {
        const input = new URL(request.url).searchParams.get("input")!;
        return new Response(forge.has(input) ? work(`${input}-forged`) : work(input));
      },
    });
    return async (input: string): Promise<string> => (await endpoint.handler(new Request(`https://provider.example/api/infer?quantity=1&input=${input}`))).text();
  };

  const jobsOf = async (name: string, run: (input: string) => Promise<string>, ids: string[]): Promise<JobRecord[]> =>
    Promise.all(ids.map(async (id) => ({ jobId: id, provider: acct(name), deterministic: true, input: id, resultHash: sha(await run(id)) })));

  it("TC-SV-018-E2E-01 honest jobs pass, forged jobs fail, all are signed, sent over HTTP and recorded; a second pass records nothing twice", async () => {
    market = await startMarket(["andi", "budi", "fina"]);
    const m = market;
    const ids = Array.from({ length: 12 }, (_, i) => `j${i}`);
    const forged = new Set(["j3", "j7"]);
    const jobs = [...(await jobsOf("andi", provider(new Set()), ids)), ...(await jobsOf("budi", provider(forged), ids)), { ...(await jobsOf("budi", provider(new Set()), ["n1"]))[0]!, deterministic: false }];

    const config = { circle: CONTRACT, verifier: acct("fina"), secretKey: m.keys.fina!.secretKey, rate: 1, seed: "secret-seed" };
    const ports = {
      rerun: async (job: JobRecord) => sha(work(String(job.input))), // the verifier runs the honest work again
      report: httpReporter({ readApiUrl: m.srv.url, circle: CIRCLE }),
      now: () => NOW_S,
    };
    const results = await runSpotChecks(jobs, config, ports);
    expect(results).toHaveLength(24); // the non-deterministic job is not eligible
    expect(results.filter((r) => r.provider === acct("andi")).every((r) => r.status === "passed")).toBe(true);
    expect(results.filter((r) => r.provider === acct("budi") && r.status === "failed").map((r) => r.jobId).sort()).toEqual(["j3", "j7"]);
    expect(results.every((r) => r.status === "passed" || r.status === "failed")).toBe(true);
    expect(results.every((r) => "reported" in r && r.reported === "sent")).toBe(true);

    // the read API: the reputation shows the counts per provider
    const budi = (await m.get(`/reputation/${acct("budi")}`)).json;
    const andi = (await m.get(`/reputation/${acct("andi")}`)).json;
    expect(budi.spotChecks).toEqual({ passed: 10, failed: 2, verifiers: 1 });
    expect(andi.spotChecks).toEqual({ passed: 12, failed: 0, verifiers: 1 });

    // evidence: the failed notice is stored with both hashes and a signature that verifies with the voucher key of the verifier
    const rows = m.db.prepare("SELECT subject, verifier, job_hash, passed, expected_hash, got_hash, at_s, signature FROM spot_checks WHERE passed = 0 ORDER BY job_hash").all() as Array<{ subject: string; verifier: string; job_hash: string; passed: bigint | number; expected_hash: string; got_hash: string; at_s: bigint | number; signature: string }>;
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.subject).toBe(acct("budi"));
      expect(r.got_hash).toBe(sha(work(["j3", "j7"].find((id) => jobHashOf(acct("budi"), id) === r.job_hash)!)));
      expect(r.expected_hash).not.toBe(r.got_hash);
      const notice: BackendNotice = { circle: CONTRACT, subject: r.subject, verifier: r.verifier, job_hash: r.job_hash, passed: false, expected_hash: r.expected_hash, got_hash: r.got_hash, at: Number(r.at_s) };
      expect(verifySpotCheckSignature(notice, r.signature, m.keys.fina!.publicKey)).toBe(true);
    }

    // a second pass finds every result recorded: the read API answers 409, the verifier reports `already_recorded` and nothing is added
    const again = await runSpotChecks(jobs, config, ports);
    expect(again.every((r) => "reported" in r && r.reported === "already_recorded")).toBe(true);
    expect(m.db.prepare("SELECT COUNT(*) AS n FROM spot_checks").get()).toEqual({ n: 24 });
  });

  it("TC-SV-018-E2E-02 the choice of jobs follows the secret seed; a rate below 1 checks a share, and a forged job outside it is not found", async () => {
    market = await startMarket(["andi", "budi", "fina"]);
    const m = market;
    const ids = Array.from({ length: 200 }, (_, i) => `k${i}`);
    const jobs = await jobsOf("budi", provider(new Set(ids.filter((_, i) => i % 5 === 0))), ids); // 40 forged
    const config = { circle: CONTRACT, verifier: acct("fina"), secretKey: m.keys.fina!.secretKey, rate: 0.25, seed: "s-1" };
    const ports = { rerun: async (job: JobRecord) => sha(work(String(job.input))), report: httpReporter({ readApiUrl: m.srv.url, circle: CIRCLE }), now: () => NOW_S };
    const results = await runSpotChecks(jobs, config, ports);
    expect(results.length).toBeGreaterThan(30);
    expect(results.length).toBeLessThan(75);
    const failed = results.filter((r) => r.status === "failed").length;
    expect(failed).toBeGreaterThan(0); // 40 forged among 200: a quarter of them is hit with near certainty
    expect(failed).toBeLessThan(40); // not all of them: the provider cannot know which, and cheating is found at the rate, not always
    const other = await runSpotChecks(jobs, { ...config, seed: "s-2" }, ports);
    expect(other.map((r) => r.jobId)).not.toEqual(results.map((r) => r.jobId));
    expect((await m.get(`/reputation/${acct("budi")}`)).json.spotChecks.failed).toBeGreaterThanOrEqual(failed);
  });

  it("TC-SV-018-E2E-03 the golden vector of the notice is the same on the solver side and the backend side", () => {
    const secret = `ed25519:${"3".repeat(88)}` as const;
    const n: SpotCheckNotice = { circle: "x207-circle.near", subject: "andi.x207-circle.near", verifier: "fina.x207-circle.near", job_hash: "ab".repeat(32), passed: false, expected_hash: "cd".repeat(32), got_hash: "ef".repeat(32), at: 1793000000 };
    expect(spotCheckHash(n)).toBe("325958b0b59c669df4b8b3c51fa4645d3b01e7c788feffc7d0066bd5287a9501");
    expect(signSpotCheck(n, secret)).toBe("ed25519:4zFBUFgwfVuHexfymRiWs28WXZ49bZckfVDrw7Xuzr2CbpTXc8RV3A87gQnpMoKu1CNiVmEMpdyHc2RbNJqJbj9k");
    expect(serializeSpotCheck(n)).toContain('"passed":false');
  });
});
