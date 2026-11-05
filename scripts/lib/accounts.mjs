// UM-008: account plan and idempotent creation for the demo circle (FX-01, FX-02).
// near-api-js is resolved from the backend workspace, which pins 7.4.0.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const requireFromBackend = createRequire(resolve(here, "../../backend/package.json"));
const { Account, JsonRpcProvider, KeyPair, KeyPairSigner, parseNearAmount } = requireFromBackend("near-api-js");

export const AGENTS = ["translator", "summarizer", "scraper", "image", "cleaner", "gpu"];

export const NETWORKS = {
  sandbox: { contractId: "x207-circle.test.near" },
  testnet: { contractId: "x207-circle.testnet", rpcUrl: "https://rpc.testnet.fastnear.com" }, // UM-191: rpc.testnet.near.org is deprecated (429 for every transaction); --rpc-url takes another endpoint
};

/** Contract account first, then the six agent sub-accounts. */
export function planAccounts(contractId) {
  return [contractId, ...AGENTS.map((agent) => `${agent}.${contractId}`)];
}

export function keyFilePath(keysDir, network, accountId) {
  return join(keysDir, network, `${accountId}.json`);
}

/** Reads the stored key of an account, or creates one. The secret stays in the file. */
export function loadOrCreateKey(keysDir, network, accountId) {
  const file = keyFilePath(keysDir, network, accountId);
  if (existsSync(file)) return KeyPair.fromString(JSON.parse(readFileSync(file, "utf8")).secret_key);
  const keyPair = KeyPair.fromRandom("ed25519");
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify({ account_id: accountId, secret_key: keyPair.toString() }), { mode: 0o600 });
  chmodSync(file, 0o600);
  return keyPair;
}

async function accountExists(provider, accountId) {
  try {
    await provider.viewAccount({ accountId });
    return true;
  } catch (err) {
    if (/does not exist|UNKNOWN_ACCOUNT|UnknownAccount/i.test(`${err?.type ?? ""} ${err?.message ?? ""}`)) return false;
    throw err;
  }
}

/**
 * Creates the contract account and the agent sub-accounts that do not exist yet.
 * Returns one entry per account: { accountId, status: "created" | "exists", balance }.
 *
 * sandbox: `funder` signs for the root account; the contract account is created under it.
 * testnet: the contract account is created through the faucet service of near-cli-rs.
 * In both cases the contract account then creates and funds the agent sub-accounts.
 */
export async function ensureAccounts({
  network,
  rpcUrl,
  contractId,
  keysDir,
  funder,
  contractBalance = "20",
  agentBalance = "3",
  log = () => {},
}) {
  const provider = new JsonRpcProvider({ url: rpcUrl });
  const results = [];
  const [, ...agentIds] = planAccounts(contractId);

  const contractKey = loadOrCreateKey(keysDir, network, contractId);
  if (await accountExists(provider, contractId)) {
    results.push({ accountId: contractId, status: "exists" });
  } else if (network === "sandbox") {
    const root = new Account(funder.accountId, provider, KeyPairSigner.fromSecretKey(funder.secretKey));
    await root.createAccount({
      newAccountId: contractId,
      publicKey: contractKey.getPublicKey(),
      nearToTransfer: BigInt(parseNearAmount(contractBalance)),
    });
    results.push({ accountId: contractId, status: "created" });
  } else {
    const run = spawnSync(
      "near",
      ["account", "create-account", "sponsor-by-faucet-service", contractId, "use-manually-provided-public-key",
        contractKey.getPublicKey().toString(), "network-config", "testnet", "create"],
      { encoding: "utf8" },
    );
    if (run.status !== 0) throw new Error(`near-cli-rs could not create ${contractId} (exit ${run.status})`);
    results.push({ accountId: contractId, status: "created" });
  }

  const contract = new Account(contractId, provider, KeyPairSigner.fromSecretKey(contractKey.toString()));
  for (const accountId of agentIds) {
    const key = loadOrCreateKey(keysDir, network, accountId);
    if (await accountExists(provider, accountId)) {
      results.push({ accountId, status: "exists" });
      continue;
    }
    await contract.createAccount({
      newAccountId: accountId,
      publicKey: key.getPublicKey(),
      nearToTransfer: BigInt(parseNearAmount(agentBalance)),
    });
    results.push({ accountId, status: "created" });
  }

  for (const entry of results) {
    entry.balance = (await provider.viewAccount({ accountId: entry.accountId })).amount.toString();
    log(`${entry.status.padEnd(7)} ${entry.accountId}`);
  }
  return results;
}
