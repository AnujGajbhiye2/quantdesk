import type { Signal } from '@/core/types';

/**
 * Consensus over a batch of last-bar signals from multiple strategies.
 * Pure - no DB, no I/O. All of a symbol's signals in a scanAll batch share
 * that symbol's latest bar time by construction, so grouping by symbol+side
 * is automatically per-bar.
 */

export interface ConsensusSignal {
  symbol: string;
  side: 'long' | 'short';
  /** Latest bar time the agreeing signals fired on. */
  time: string;
  agreeCount: number;
  totalStrategies: number;
  /** agreeCount / totalStrategies, 0..1. */
  strength: number;
  strategyIds: string[];
  /** strategyId -> human-readable reason. */
  reasons: Record<string, string>;
}

/**
 * Group entry signals by (symbol, side) and rank strongest first.
 * 'flat' (exit) signals are excluded - they are not directional agreement.
 */
export function buildConsensus(
  signals: readonly Signal[],
  totalStrategies: number,
): ConsensusSignal[] {
  const groups = new Map<string, ConsensusSignal>();

  for (const s of signals) {
    if (s.side === 'flat') continue;
    const key = `${s.symbol}|${s.side}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        symbol: s.symbol,
        side: s.side,
        time: s.time,
        agreeCount: 0,
        totalStrategies,
        strength: 0,
        strategyIds: [],
        reasons: {},
      };
      groups.set(key, group);
    }
    if (group.reasons[s.strategyId] !== undefined) continue; // one vote per strategy
    group.agreeCount += 1;
    group.strategyIds.push(s.strategyId);
    group.reasons[s.strategyId] = s.reason;
  }

  const out = Array.from(groups.values());
  for (const g of out) {
    g.strength = totalStrategies > 0 ? g.agreeCount / totalStrategies : 0;
  }
  out.sort(
    (a, b) =>
      b.strength - a.strength ||
      b.agreeCount - a.agreeCount ||
      a.symbol.localeCompare(b.symbol),
  );
  return out;
}
