#!/usr/bin/env node
// UM-025: turns the JSON report of vitest (`--reporter=json --outputFile.json=<file>`) into a Markdown table of test files and their durations, for the job summary of
// .github/workflows/e2e-sandbox.yml (the workflow appends the output to $GITHUB_STEP_SUMMARY).
//   node scripts/e2e-summary.mjs <report.json> [title]
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

/** Markdown for one vitest JSON report: files by duration, longest first, with status and the number of tests. */
export function summarize(report, title = "E2E sandbox", cwd = process.cwd()) {
  const rows = (report.testResults ?? []).map((r) => ({
    file: relative(cwd, r.name).replaceAll("\\", "/"),
    seconds: Math.max(0, (r.endTime ?? 0) - (r.startTime ?? 0)) / 1000,
    status: r.status,
    tests: (r.assertionResults ?? []).length,
  }));
  rows.sort((a, b) => b.seconds - a.seconds || a.file.localeCompare(b.file));
  const total = rows.reduce((n, r) => n + r.seconds, 0);
  const failed = rows.filter((r) => r.status === "failed").length;
  const lines = [`### ${title}`, "", `${rows.length} test files, ${report.numTotalTests ?? "?"} tests, ${failed} failed files, ${(total / 60).toFixed(1)} min of test time in total.`, "", "| file | seconds | tests | status |", "| --- | ---: | ---: | --- |"];
  for (const r of rows) lines.push(`| \`${r.file}\` | ${r.seconds.toFixed(1)} | ${r.tests} | ${r.status} |`);
  return lines.join("\n") + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, title] = process.argv.slice(2);
  if (!file) {
    console.error("usage: e2e-summary.mjs <report.json> [title]");
    process.exit(2);
  }
  process.stdout.write(summarize(JSON.parse(readFileSync(file, "utf8")), title));
}
