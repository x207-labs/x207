// Helpers for the live tests on NEAR testnet: patience with the 429 of the free endpoints, a recorder of transaction hashes that is written after every
// transaction, and a block source for the indexer that is told about each transaction (the free endpoints cannot follow every block).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { BlockLog, BlockSource, SourceBlock } from "../../backend/src/index.ts";

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The free endpoints answer 429 when they are asked too often (refused before the node touches the transaction), and a network that drops for a moment is waited out. */
export async function patient<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const text = `${(error as Error).message} ${JSON.stringify((error as { cause?: unknown }).cause ?? "")}`;
      if (attempt >= 12 || !/429|rate limit|fetch failed|EHOSTUNREACH|ECONNRESET|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|socket hang up/i.test(text)) throw error;
      await sleep(4000 + attempt * 2000);
    }
  }
}

export type Step = { step: string; account: string; method: string; hash: string };

/** Hashes and names only (no keys), written to `path` after every record so that nothing is lost when a run stops. Earlier steps in the file are kept. */
export class Recorder {
  readonly steps: Step[];
  constructor(private readonly path: string, private readonly header: Record<string, unknown>) {
    this.steps = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as { steps: Step[] }).steps : [];
  }
  add(step: Step): void {
    this.steps.push(step);
    writeFileSync(this.path, JSON.stringify({ ...this.header, steps: this.steps }, null, 2));
  }
}

type Rpc = (method: string, params: unknown) => Promise<any>;

/** Serves only the blocks of the transactions it was told about; every other height is a skipped block. The logs are the real ones of the chain. */
export class TxFeedSource implements BlockSource {
  readonly endpoint = "tx-feed";
  readonly #blocks = new Map<number, SourceBlock>();
  readonly #headers = new Map<string, { height: number; timestampNs: bigint }>();
  #head: number;

  constructor(private readonly contractId: string, startHeight: number, private readonly rpc: Rpc) {
    this.#head = startHeight;
  }

  async finalHeight(): Promise<number> {
    return this.#head;
  }

  async getBlock(height: number): Promise<SourceBlock | null> {
    return this.#blocks.get(height) ?? null;
  }

  async add(txHash: string, signer: string): Promise<void> {
    const result = await this.rpc("tx", { tx_hash: txHash, sender_account_id: signer, wait_until: "FINAL" });
    for (const outcome of result.receipts_outcome as Array<any>) {
      if (outcome.outcome.executor_id !== this.contractId || outcome.outcome.logs.length === 0) continue;
      const hash: string = outcome.block_hash;
      let header = this.#headers.get(hash);
      if (!header) {
        const block = await this.rpc("block", { block_id: hash });
        header = { height: block.header.height, timestampNs: BigInt(block.header.timestamp_nanosec) };
        this.#headers.set(hash, header);
      }
      const block = this.#blocks.get(header.height) ?? { height: header.height, hash, timestampNs: header.timestampNs, logs: [] as BlockLog[] };
      (outcome.outcome.logs as string[]).forEach((log, logIndex) => block.logs.push({ receiptId: outcome.id, logIndex, executorId: this.contractId, txHash, log }));
      this.#blocks.set(header.height, block);
      this.#head = Math.max(this.#head, header.height);
    }
  }
}
