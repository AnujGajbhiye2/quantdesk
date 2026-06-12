import 'server-only';
import type { PaperTrade } from '@/core/types';
import { getPaperTrades } from '@/core/db/paper';
import { markOpenTrades, type MarkResult } from '@/core/paper/broker';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StrategyStats {
  trades:            number;
  closedTrades:      number;   // sample size behind winRate - verdicts need it
  winRate:           number;   // closed trades only; 0 if none closed
  totalPnl:          number;   // realized (closed) P&L only
  avgPnlPct:         number;   // average of closed pnlPct; 0 if none closed
  openUnrealizedPnl: number;   // sum of unrealized P&L for open positions
}

export interface TradeBook {
  totalTrades:       number;
  open:              number;
  closed:            number;
  winRate:           number;         // closed trades only; 0 if none closed
  totalPnl:          number;         // realized (closed) P&L only
  avgPnlPct:         number;         // average of closed pnlPct; 0 if none closed
  openUnrealizedPnl: number;         // sum of unrealized P&L for open positions
  bestTrade:         PaperTrade | null;
  worstTrade:        PaperTrade | null;
  openExposure:      number;         // sum of entryPrice * qty for open trades
  byStrategy:        Record<string, StrategyStats>;
}

/** Mark results passed in or computed inline - exported for testing. */
export type { MarkResult };

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
 * Calls markOpenTrades() to fold in unrealized P&L for open positions.
 * winRate / totalPnl remain realized-only to preserve historical edge accuracy.
 */
export function buildTradeBook(): TradeBook {
  const all    = getPaperTrades();
  const closed = all.filter((t) => t.status === 'closed');
  const open   = all.filter((t) => t.status === 'open');

  const closedWithPnl = closed.filter((t) => t.pnl != null);
  const best  = closedWithPnl.reduce<PaperTrade | null>(
    (acc, t) => acc === null || (t.pnl ?? -Infinity) > (acc.pnl ?? -Infinity) ? t : acc,
    null,
  );
  const worst = closedWithPnl.reduce<PaperTrade | null>(
    (acc, t) => acc === null || (t.pnl ?? Infinity) < (acc.pnl ?? Infinity) ? t : acc,
    null,
  );

  const openExposure = open.reduce((sum, t) => sum + t.entryPrice * t.qty, 0);

  // Mark open positions to get unrealized P&L
  const marks = markOpenTrades();
  const unrealizedByTradeId = new Map(
    marks.map((m) => [m.trade.id, m.unrealizedPnl]),
  );
  const totalOpenUnrealizedPnl = marks.reduce((sum, m) => sum + m.unrealizedPnl, 0);

  // Per-strategy breakdown (realized P&L + open unrealized P&L split)
  const strategyMap = new Map<string, PaperTrade[]>();
  for (const t of all) {
    const list = strategyMap.get(t.strategyId) ?? [];
    list.push(t);
    strategyMap.set(t.strategyId, list);
  }

  const byStrategy: Record<string, StrategyStats> = {};
  for (const [id, trades] of strategyMap) {
    const openUnrealizedPnl = trades
      .filter((t) => t.status === 'open')
      .reduce((sum, t) => sum + (unrealizedByTradeId.get(t.id) ?? 0), 0);

    byStrategy[id] = {
      trades:            trades.length,
      closedTrades:      trades.filter((t) => t.status === 'closed').length,
      winRate:           winRate(trades),
      totalPnl:          totalPnl(trades),
      avgPnlPct:         avgPnlPct(trades),
      openUnrealizedPnl,
    };
  }

  return {
    totalTrades:       all.length,
    open:              open.length,
    closed:            closed.length,
    winRate:           winRate(all),
    totalPnl:          totalPnl(all),
    avgPnlPct:         avgPnlPct(all),
    openUnrealizedPnl: totalOpenUnrealizedPnl,
    bestTrade:         best,
    worstTrade:        worst,
    openExposure,
    byStrategy,
  };
}
