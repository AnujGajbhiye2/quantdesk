import 'server-only';
import { getEdgeStats } from '@/core/db/edge';
import { symScope, GLOBAL_SCOPE } from '@/core/edge/types';
import { projectExitRange } from '@/core/edge/projection';
import type { PaperTrade } from '@/core/types';

/**
 * Estimated hold for an open paper trade, derived from the strategy's
 * backtested median winning-trade hold time. Historical median - NOT a
 * forecast; every UI surface must label it as such.
 */
export interface EstHold {
  medianHoldBars: number;
  /** entryTime + 75% of median hold (ISO date). */
  earliest: string;
  /** entryTime + 125% of median hold (ISO date). */
  latest: string;
  /** 'symbol' = this strategy on this symbol; 'universe' = global fallback. */
  source: 'symbol' | 'universe';
  sampleSize: number;
}

export type PaperTradeWithHold = PaperTrade & { estHold?: EstHold | null };

/** Minimum closed trades before a symbol-scoped median is trusted. */
const MIN_SYMBOL_TRADES = 10;

/**
 * Attach an estimated hold to each OPEN trade. Closed trades pass through
 * unchanged (the UI shows their actual held time instead).
 */
export function withEstHold(trades: PaperTrade[]): PaperTradeWithHold[] {
  return trades.map((t) => {
    if (t.status !== 'open') return t;
    return { ...t, estHold: estimateHold(t) };
  });
}

function estimateHold(trade: PaperTrade): EstHold | null {
  let source: EstHold['source'] = 'symbol';
  let stats = getEdgeStats({
    strategyId: trade.strategyId,
    scope:      symScope(trade.symbol),
  })[0];

  if (!stats || stats.numTrades < MIN_SYMBOL_TRADES || stats.medianWinHoldBars <= 0) {
    source = 'universe';
    stats = getEdgeStats({
      strategyId: trade.strategyId,
      scope:      GLOBAL_SCOPE,
    })[0];
  }

  if (!stats || stats.numTrades < MIN_SYMBOL_TRADES || stats.medianWinHoldBars <= 0) {
    return null;
  }

  const range = projectExitRange(
    trade.entryTime.slice(0, 10),
    stats.medianWinHoldBars,
    '1d',
  );
  if (!range) return null;

  return {
    medianHoldBars: range.medianHoldBars,
    earliest:       range.earliest,
    latest:         range.latest,
    source,
    sampleSize:     stats.numTrades,
  };
}
