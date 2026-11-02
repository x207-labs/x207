#!/usr/bin/env node
// UM-053: builds and validates the payload for POST https://nearhackathon.com/api/applications from fixed project facts and
// the fields a human fills in. It never sends anything and has no network code (UM-054 is the owner's decision).
//
//   node scripts/submission-payload.mjs --draft            print the payload with null for every missing human field, plus a problem list
//   node scripts/submission-payload.mjs --check            exit 1 unless the payload is complete and valid (no placeholder left)
//   node scripts/submission-payload.mjs                    print the final payload when it is valid (the human reads it before sending)
//   --file <path>     human fields, default .secrets/submission.json (ignored by git)
//   --idea <path>     text for `idea`, default docs/submission/idea.txt
//   --project-url <url>
//
// Human fields in the file: projectName, leadName, email, size, nearAddress, demoUrl, consent (true only after the human
// agreed to the contact notice), and optionally requestId. When requestId is missing, one is generated and written next to the
// file as submission.request-id so that a retry reuses it. The file holds personal data and must not be committed.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TRACKS = ["swarms", "agents", "defi", "social", "business", "realworld", "security", "open"];
export const ALL_TRACKS = ["defi", "thesis", "privacy", "business", "swarms", "security", "agents", "realworld", "games", "nfts", "memecoins", "social", "open"];
export const SIZES = ["1", "2 - 4", "4 - 6", "6 - 8", "8+"];
export const FIELDS = ["requestId", "projectName", "leadName", "email", "size", "tracks", "nearAddress", "projectUrl", "demoUrl", "idea", "consent"];
export const HUMAN_FIELDS = ["projectName", "leadName", "email", "size", "nearAddress", "demoUrl", "consent"];
export const DEFAULT_PROJECT_URL = "https://github.com/x207-labs/x207";
const NEAR_ADDRESS = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PLACEHOLDER = /<[^>]*>|\bFILL\b|\bTODO\b|\bTBD\b|X{4,}|\bexample\.(com|org)\b|\.\.\./i;

const between = (value, min, max) => typeof value === "string" && value.length >= min && value.length <= max;
const httpUrl = (value) => {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

/** Returns `{ payload, problems }`; a missing human field is `null` in the payload and a line in `problems`. */
export function buildPayload({ human = {}, idea, requestId, projectUrl = DEFAULT_PROJECT_URL, tracks = TRACKS }) {
  const payload = {
    requestId: requestId ?? human.requestId ?? null,
    projectName: human.projectName ?? null,
    leadName: human.leadName ?? null,
    email: human.email ?? null,
    size: human.size ?? null,
    tracks: [...tracks],
    nearAddress: human.nearAddress ?? null,
    projectUrl,
    demoUrl: human.demoUrl ?? null,
    idea: idea?.trim() ?? null,
    consent: human.consent ?? null,
  };
  const problems = [];
  const need = (field, ok, rule) => {
    if (payload[field] === null) problems.push(`${field}: missing (human field)`);
    else if (!ok) problems.push(`${field}: ${rule}`);
    else if (typeof payload[field] === "string" && PLACEHOLDER.test(payload[field])) problems.push(`${field}: looks like a placeholder`);
  };
  need("requestId", UUID.test(String(payload.requestId)), "must be a lowercase UUID");
  need("projectName", between(payload.projectName, 2, 80), "2-80 characters");
  need("leadName", between(payload.leadName, 2, 80), "2-80 characters");
  need("email", between(payload.email, 3, 160) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email), "valid email, at most 160 characters");
  need("size", SIZES.includes(payload.size), `one of ${SIZES.map((s) => JSON.stringify(s)).join(", ")}`);
  need("nearAddress", between(payload.nearAddress, 2, 64) && NEAR_ADDRESS.test(payload.nearAddress), "2-64 characters, lowercase, NEAR account pattern");
  need("projectUrl", httpUrl(payload.projectUrl) && payload.projectUrl.length <= 300, "http(s) URL, at most 300 characters");
  need("demoUrl", payload.demoUrl !== null && httpUrl(payload.demoUrl) && payload.demoUrl.length <= 300, "http(s) URL of the public post, at most 300 characters");
  need("idea", between(payload.idea, 20, 2000), "20-2000 characters");
  if (payload.consent === null) problems.push("consent: missing (human field)");
  else if (payload.consent !== true) problems.push("consent: must be true, and only after the human agreed to the contact notice");
  const unique = new Set(payload.tracks);
  if (unique.size !== payload.tracks.length || !payload.tracks.every((t) => ALL_TRACKS.includes(t))) problems.push("tracks: each listed once, from the track ids of the form");
  const missing = TRACKS.filter((t) => !unique.has(t));
  if (missing.length > 0) problems.push(`tracks: K-59 requires all eight tracks, missing ${missing.join(", ")}`);
  if (Buffer.byteLength(JSON.stringify(payload)) > 12000) problems.push("body: more than 12000 bytes");
  const extra = Object.keys(human).filter((k) => !HUMAN_FIELDS.includes(k) && k !== "requestId");
  if (extra.length > 0) problems.push(`file: fields the API does not take: ${extra.join(", ")}`);
  return { payload, problems };
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

function main(argv) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const file = resolve(arg(argv, "--file") ?? join(root, ".secrets", "submission.json"));
  const ideaFile = resolve(arg(argv, "--idea") ?? join(root, "docs", "submission", "idea.txt"));
  const human = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const idFile = join(dirname(file), "submission.request-id");
  let requestId = human.requestId;
  if (!requestId && existsSync(idFile)) requestId = readFileSync(idFile, "utf8").trim();
  if (!requestId && existsSync(dirname(file)) && !argv.includes("--check")) {
    requestId = randomUUID();
    writeFileSync(idFile, `${requestId}\n`, { mode: 0o600 });
  }
  const { payload, problems } = buildPayload({
    human, requestId, idea: existsSync(ideaFile) ? readFileSync(ideaFile, "utf8") : undefined, projectUrl: arg(argv, "--project-url") ?? DEFAULT_PROJECT_URL,
  });
  if (!existsSync(file)) problems.unshift(`file: ${file} does not exist; copy docs/submission/human-fields.example.json there and fill it`);
  if (argv.includes("--draft")) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.stderr.write(problems.length > 0 ? `Open items (${problems.length}):\n${problems.map((p) => `  - ${p}`).join("\n")}\n` : "No open items.\n");
    return 0;
  }
  if (problems.length > 0) {
    process.stderr.write(`Payload is not ready (${problems.length}):\n${problems.map((p) => `  - ${p}`).join("\n")}\n`);
    return 1;
  }
  if (!argv.includes("--check")) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else process.stderr.write("Payload is complete and valid. Nothing was sent.\n");
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
