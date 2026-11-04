#!/usr/bin/env node
// UM-103: check the numbers of epoch 8 (the realistic epoch on testnet) that the README, CLAIMS.md and docs/submission/ quote. Two sources of truth are
// compared with each other and then with the text: `docs/testnet-0.0.13-realistic.json` (what the run recorded) and the hosted read API
// (`/epochs/8/metrics`, `--offline` skips it). A figure in the text that follows one of the rules below must equal the truth, rounded to the
// decimals the text writes. The rules read phrases such as "21.8 credit cancelled", "the 19.55 left", "7.75 USDT due", "ratio 0.527", "24 vouchers";
// a figure outside these phrases is not checked. Reads files and the API only; changes nothing.
//
// Usage: node scripts/check-numbers.mjs [--root <umbrella dir>] [--api <base url>] [--offline] [--epoch-file docs/testnet-0.0.13-realistic.json]
// Exit code 0 when everything agrees, 1 when a number differs (or the API cannot be read without --offline).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_API = "https://x207-backend-production.up.railway.app/x207/circles/agents-main";
export const FILES = ["README.md", "CLAIMS.md", "docs/submission/idea.txt", "docs/submission/form-draft.md", "docs/submission/video-script.md", "docs/submission/x-post.md"];

const credit = (units) => Number(units) / 1e6;
const near = (a, b) => Math.abs(a - b) < 1e-9;

/** The figures of the recorded run, in credit (USDT has the same 6 decimals). */
export function truthFromRun(run) {
  const result = run.result;
  const obligation = credit(result.clearing.totalObligation);
  const cleared = credit(result.clearing.clearedTotal);
  const debtors = result.positions.debtors;
  const defaulted = new Set((result.finalize.defaulted ?? []).map((d) => d.account));
  const due = debtors.reduce((n, d) => n + Number(d.due), 0) / 1e6;
  const paid = debtors.filter((d) => !defaulted.has(d.account)).reduce((n, d) => n + Number(d.due), 0) / 1e6;
  const fromStake = (result.finalize.defaulted ?? []).reduce((n, d) => n + Number(d.fromStake), 0) / 1e6;
  return {
    vouchers: result.edgesRegistered.count, obligation, cleared, ratio: result.clearing.clearedRatio, left: obligation - cleared,
    due, paid, fromStake, debtors: debtors.length, debtorsPaid: debtors.length - defaulted.size, creditors: result.positions.creditors.length,
  };
}

/** The same figures as the read API gives them (`/epochs/8/metrics`). */
export function truthFromApi(m) {
  return {
    vouchers: m.voucherCount, obligation: credit(m.totalVoucherValue), cleared: credit(m.cleared), ratio: m.clearedRatio, left: credit(m.debtAfter), due: credit(m.netDebt),
    participants: m.graph.participants, residualTransfers: m.residualTransfers,
  };
}

/** Differences between the run and the API; `ratio` is compared at the 3 decimals that the texts use. */
export function compareSources(run, api) {
  const out = [];
  for (const key of ["vouchers", "obligation", "cleared", "left", "due"]) if (!near(run[key], api[key])) out.push(`run ${key} ${run[key]} differs from the API ${api[key]}`);
  if (Math.round(run.ratio * 1000) !== Math.round(api.ratio * 1000)) out.push(`run ratio ${run.ratio} differs from the API ${api.ratio}`);
  return out;
}

const NUM = String.raw`(?<![\d.])(\d+(?:\.\d+)?)`;
/** Phrases that carry a figure of epoch 8, and the key of the truth they must equal. Each regex has the figure in group 1. */
export const RULES = [
  { key: "cleared", re: new RegExp(`(?<!of )${NUM} (?:credit )?(?:was |were )?(?:cancelled|cleared)\\b(?! ratio)`, "gi") },
  { key: "cleared", re: new RegExp(`(?:cancelled|cleared|cancels) ${NUM}(?! of)\\b(?!\\.\\d)(?=[;,.)\\s]|$)(?! USDT)`, "gi"), onlyNear: /epoch 8|realistic|voucher|clearing|obligation/i },
  { key: "cleared", re: new RegExp(`${NUM} of ${"\\d+(?:\\.\\d+)?"} credit cleared`, "gi") },
  { key: "obligation", re: new RegExp(`${"\\d+"} (?:asymmetric )?obligations of ${NUM} credit`, "gi") },
  { key: "obligation", re: new RegExp(`${"\\d+(?:\\.\\d+)?"} of ${NUM} credit cleared`, "gi") },
  { key: "obligation", re: new RegExp(`\\d+ vouchers? \\(?(?:worth )?${NUM}\\)?`, "gi"), onlyNear: /clearing|cancel|epoch|testnet/i },
  { key: "left", re: new RegExp(`(?:the )?${NUM}(?: credit)? (?:left|remain)`, "gi"), onlyNear: /clearing|cancel|net|residual|epoch/i },
  { key: "due", re: new RegExp(`${NUM} USDT (?:due|net)`, "gi") },
  { key: "due", re: new RegExp(`nets? to ${NUM} USDT`, "gi") },
  { key: "paid", re: new RegExp(`(?:paid|pay) ${NUM}(?: USDT)?`, "gi"), onlyNear: /debtor|five|5 paid|netting|7\.75/i },
  { key: "fromStake", re: new RegExp(`(?:the )?${NUM} (?:of|came from|was taken from|from) (?:the |a |its )?(?:stake|`+"`m06`)", "gi") },
  { key: "ratio", re: /(?:ratio|\(ratio) (0\.\d{3})(?!\d)/gi },
  { key: "vouchers", re: new RegExp(`(\\d+) (?:asymmetric )?(?:obligations|vouchers) (?:of|worth|\\()\\s*\\d`, "gi") },
];

const decimals = (text) => (text.split(".")[1] ?? "").length;
const same = (found, expected) => near(Number(found), Math.round(expected * 10 ** decimals(found)) / 10 ** decimals(found));

/** Findings in one text: figures that differ from the truth, and the sentence "half of the credit never moves" said as a claim. */
export function checkText(name, text, truth, counter = { n: 0 }) {
  const findings = [];
  text.split("\n").forEach((line, i) => {
    if (/half of the credit (?:never )?(?:has to |does not |doesn't )?move/i.test(line) && !/\b(?:do not|don't|never say|not say|must not)\b|\"half of the credit never moves\"/i.test(line)) {
      findings.push({ file: name, line: i + 1, found: "half of the credit never moves", expected: "21.8 cancelled, 19.55 left, 7.75 USDT due", rule: "half" });
    }
    if (!/epoch 8|realistic|24 (?:vouchers|asymmetric)|41\.35|21\.8|19\.55|7\.75|0\.527/i.test(line)) return; // only lines that speak of this epoch
    for (const rule of RULES) {
      if (rule.onlyNear && !rule.onlyNear.test(line)) continue;
      for (const m of line.matchAll(rule.re)) {
        const found = m[1];
        const expected = truth[rule.key];
        if (expected === undefined) continue;
        counter.n += 1;
        if (!same(found, expected)) findings.push({ file: name, line: i + 1, found: `${rule.key} ${found}`, expected: String(Math.round(expected * 1e4) / 1e4), rule: rule.key });
      }
    }
  });
  return findings.filter((f, i) => findings.findIndex((g) => g.line === f.line && g.found === f.found) === i);
}

async function fetchMetrics(api) {
  const response = await fetch(`${api.replace(/\/+$/, "")}/epochs/8/metrics`, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`GET /epochs/8/metrics answered ${response.status}`);
  return response.json();
}

async function main(argv) {
  const arg = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
  const root = resolve(arg("--root", join(dirname(fileURLToPath(import.meta.url)), "..")));
  const runFile = arg("--epoch-file", "docs/testnet-0.0.13-realistic.json");
  const truth = truthFromRun(JSON.parse(readFileSync(join(root, runFile), "utf8")));
  const problems = [];
  if (!argv.includes("--offline")) {
    try {
      problems.push(...compareSources(truth, truthFromApi(await fetchMetrics(arg("--api", DEFAULT_API)))));
    } catch (error) {
      problems.push(`the read API could not be read: ${error.message} (use --offline to check the files against the recorded run only)`);
    }
  }
  const findings = [];
  const checked = {};
  for (const file of FILES) {
    if (!existsSync(join(root, file))) continue;
    const counter = { n: 0 };
    findings.push(...checkText(file, readFileSync(join(root, file), "utf8"), truth, counter));
    checked[file] = counter.n;
  }
  for (const [file, n] of Object.entries(checked)) if (n === 0) problems.push(`${file}: no figure of epoch 8 was recognised, so nothing was checked (did the wording change?)`);
  for (const p of problems) console.log(`source: ${p}`);
  for (const f of findings) console.log(`${f.file}:${f.line}: ${f.found} (expected ${f.expected})`);
  const rounded = (n) => Math.round(n * 1e4) / 1e4;
  console.log(`figures checked per file: ${JSON.stringify(checked)}`);
  console.log(`epoch 8: ${truth.vouchers} vouchers, obligation ${rounded(truth.obligation)}, cleared ${rounded(truth.cleared)} (ratio ${truth.ratio}), left ${rounded(truth.left)}, due ${rounded(truth.due)} (paid ${rounded(truth.paid)}, from stake ${rounded(truth.fromStake)}); ${findings.length} difference(s) in ${FILES.length} files${argv.includes("--offline") ? ", API not asked" : ""}`);
  return problems.length + findings.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => { console.error(error.message); process.exit(1); });
}
