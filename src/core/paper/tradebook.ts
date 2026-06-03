import 'server-only';
import type { PaperTrade } from '@/core/types';
import { getPaperTrades } from '@/core/db/paper';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StrategyStats {
  trades:     number;
  winRate:    number;   // closed trades only; 0 if none closed
  totalPnl:   number;
  avgPnlPct:  number;   // average of closed pnlPct; 0 if none closed
}

export interface TradeBook {
  totalTrades:   number;
  open:          number;
  closed:        number;
  winRate:       number;         // closed trades only; 0 if none closed
  totalPnl:      number;
  avgPnlPct:     number;         // average of closed pnlPct; 0 if none closed
  bestTrade:     PaperTrade | null;
  worstTrade:    PaperTrade | null;
  openExposure:  number;         // sum of entryPrice * qty for open trades
  byStrategy:    Record<string, StrategyStats>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function winRate(trades: PaperTrade[]): number {
  const closed = trades.filter((t) => t.status === 'closed');
  if (closed.length === 0) return 0;
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length;
  return wins / closed.length;
}

function avgPnlPct(trades: PaperTrade[]): number {
  const closed = trades.filter((t) => t.status === 'closed' && t.pnlPct != null);
  if (closed.length === 0) return 0;
  return closed.reduce((sum, t) => sum + (t.pnlPct ?? 0), 0) / closed.length;
}

function totalPnl(trades: PaperTrade[]): number {
  return trades
    .filter((t) => t.status === 'closed')
    .reduce((sum, t) => sum + (t.pnl ?? 0), 0);
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/**
 * Aggregate all paper trades into a trade book.
 * Pure computation over DB rows - no engine dependency.
 */
export function buildTradeBook(): TradeBook {
  const all    = getPaperTrades();
  const closed = all.filter((t) => t.status === 'closed');
  const open   = all.filter((t) => t.status === 'open');

  const closedWithPnl  = closed.filter((t) => t.pnl != null);
  const best  = closedWithPnl.reduce<PaperTrade | null>(
    (acc, t) => acc === null || (t.pnl ?? -Infinity) > (acc.pnl ?? -Infinity) ? t : acc,
    null,
  );
  const worst = closedWithPnl.reduce<PaperTrade | null>(
    (acc, t) => acc === null || (t.pnl ?? Infinity) < (acc.pnl ?? Infinity) ? t : acc,
    null,
  );

  const openExposure = open.reduce((sum, t) => sum + t.entryPrice * t.qty, 0);

  // Per-strategy breakdown
  const strategyMap = new Map<string, PaperTrade[]>();
  for (const t of all) {
    const list = strategyMap.get(t.strategyId) ?? [];
    list.push(t);
    strategyMap.set(t.strategyId, list);
  }

  const byStrategy: Record<string, StrategyStats> = {};
  for (const [id, trades] of strategyMap) {
    byStrategy[id] = {
      trades:    trades.length,
      winRate:   winRate(trades),
      totalPnl:  totalPnl(trades),
      avgPnlPct: avgPnlPct(trades),
    };
  }

  return {
    totalTrades:  all.length,
    open:         open.length,
    closed:       closed.length,
    winRate:      winRate(all),
    totalPnl:     totalPnl(all),
    avgPnlPct:    avgPnlPct(all),
    bestTrade:    best,
    worstTrade:   worst,
    openExposure,
    byStrategy,
  };
}
