// Who buys what from whom in epoch `e` of the swarm demos (AG-032 on near-sandbox, UM-124 on testnet): the same traffic in both, so the results are comparable.
import { AGENT_NAMES, type AgentName } from "../agents/shared/registry.ts";

export type Trade = { buyer: AgentName; seller: AgentName; credit: number };

/** Every agent buys from the next one and from the one after next, and the odd ones also buy from the one three places on, so debts form cycles of different sizes. 15 trades per epoch. */
export function trafficFor(e: number): Trade[] {
  const n = AGENT_NAMES.length;
  const rows: Trade[] = [];
  for (let i = 0; i < n; i++) {
    rows.push({ buyer: AGENT_NAMES[i]!, seller: AGENT_NAMES[(i + 1) % n]!, credit: 10 + ((3 * i + e) % 7) });
    rows.push({ buyer: AGENT_NAMES[i]!, seller: AGENT_NAMES[(i + 2) % n]!, credit: 3 + ((i + 2 * e) % 4) });
    if (i % 2 === 1) rows.push({ buyer: AGENT_NAMES[i]!, seller: AGENT_NAMES[(i + 3) % n]!, credit: 4 + (e % 3) });
  }
  return rows;
}
