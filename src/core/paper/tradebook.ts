import 'server-only';
import type { PaperTrade } from '@/core/types';
import { getPaperTrades } from '@/core/db/paper';
import { markOpenTrades, type MarkResult } from '@/core/paper/broker';
import { toUSD } from '@/core/format/fx';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StrategyStats {
  trades:            number;
  closedTrades:      number;   // sample size behind winRate - verdicts need it
  winRate:           number;   // closed trades only; 0 if none closed
  totalPnl:          number;   // realized (closed) P&L - USD-normalized
  avgPnlPct:         number;   // average of closed pnlPct; 0 if none closed
  openUnrealizedPnl: number;   // sum of unrealized P&L for open positions - USD-normalized
}

export interface TradeBook {
  totalTrades:          number;  // open + closed only (not pending)
  open:                 number;
  pending:              number;
  closed:               number;
  winRate:              number;         // closed trades only; 0 if none closed
  totalPnl:             number;         // realized (closed) P&L - USD-normalized
  totalPnlByCurrency:   Record<string, number>; // raw native sums per currency (for hover breakdown)
  avgPnlPct:            number;         // average of closed pnlPct; 0 if none closed
  openUnrealizedPnl:    number;         // sum of unrealized P&L for open positions - USD-normalized
  bestTrade:            PaperTrade | null;
  worstTrade:           PaperTrade | null;
  openExposure:         number;         // sum of entryPrice * qty for open trades - USD-normalized
  byStrategy:           Record<string, StrategyStats>;
}

/** Mark results passed in or computed inline - exported for testing. */
export type { MarkResult };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function winRate(trades: PaperTrade[]): number {
  const closed = trades.filter((t) => t.status === 'closed');
  if (closed.length === 0) return 0;
  // Win/loss direction is currency-agnostic (any positive pnl = win)
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length;
  return wins / closed.length;
}

function avgPnlPct(trades: PaperTrade[]): number {
  const closed = trades.filter((t) => t.status === 'closed' && t.pnlPct != null);
  if (closed.length === 0) return 0;
  // pnlPct is already dimensionless (%) - no FX conversion needed
  return closed.reduce((sum, t) => sum + (t.pnlPct ?? 0), 0) / closed.length;
}

/** Sum of realized P&L normalized to USD for cross-currency comparison. */
function totalPnlUSD(trades: PaperTrade[]): number {
  return trades
    .filter((t) => t.status === 'closed')
    .reduce((sum, t) => sum + toUSD(t.pnl ?? 0, t.currency), 0);
}

/** Raw native sum per currency (for hover breakdown tooltip). */
function totalPnlByCurrency(trades: PaperTrade[]): Record<string, number> {
  const byCur: Record<string, number> = {};
  for (const t of trades.filter((t) => t.status === 'closed')) {
    const cur = t.currency ?? 'USD';
    byCur[cur] = (byCur[cur] ?? 0) + (t.pnl ?? 0);
  }
  return byCur;
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
  const all     = getPaperTrades();
  const closed  = all.filter((t) => t.status === 'closed');
  const open    = all.filter((t) => t.status === 'open');
  const pending = all.filter((t) => t.status === 'pending');
  // Exclude pending (resting limit orders) from stats - they have no committed position
  const active  = [...open, ...closed];

  const closedWithPnl = closed.filter((t) => t.pnl != null);
  // Compare via USD so best/worst is meaningful across currencies
  const best  = closedWithPnl.reduce<PaperTrade | null>(
    (acc, t) => acc === null || toUSD(t.pnl ?? -Infinity, t.currency) > toUSD(acc.pnl ?? -Infinity, acc.currency) ? t : acc,
    null,
  );
  const worst = closedWithPnl.reduce<PaperTrade | null>(
    (acc, t) => acc === null || toUSD(t.pnl ?? Infinity, t.currency) < toUSD(acc.pnl ?? Infinity, acc.currency) ? t : acc,
    null,
  );

  // openExposure normalized to USD
  const openExposure = open.reduce((sum, t) => sum + toUSD(t.entryPrice * t.qty, t.currency), 0);

  // Mark open positions to get unrealized P&L (native per trade)
  const marks = markOpenTrades();
  const unrealizedByTradeId = new Map(
    marks.map((m) => [m.trade.id, { pnl: m.unrealizedPnl, currency: m.trade.currency }]),
  );
  // Sum unrealized P&L normalized to USD
  const totalOpenUnrealizedPnl = marks.reduce(
    (sum, m) => sum + toUSD(m.unrealizedPnl, m.trade.currency),
    0,
  );

  // Per-strategy breakdown (realized P&L + open unrealized P&L split; exclude pending)
  const strategyMap = new Map<string, PaperTrade[]>();
  for (const t of active) {
    const list = strategyMap.get(t.strategyId) ?? [];
    list.push(t);
    strategyMap.set(t.strategyId, list);
  }

  const byStrategy: Record<string, StrategyStats> = {};
  for (const [id, trades] of strategyMap) {
    // Normalize per-strategy unrealized P&L to USD
    const openUnrealizedPnl = trades
      .filter((t) => t.status === 'open')
      .reduce((sum, t) => {
        const entry = unrealizedByTradeId.get(t.id);
        return sum + toUSD(entry?.pnl ?? 0, entry?.currency ?? t.currency);
      }, 0);

    byStrategy[id] = {
      trades:            trades.length,
      closedTrades:      trades.filter((t) => t.status === 'closed').length,
      winRate:           winRate(trades),
      totalPnl:          totalPnlUSD(trades),
      avgPnlPct:         avgPnlPct(trades),
      openUnrealizedPnl,
    };
  }

  return {
    totalTrades:          active.length,
    open:                 open.length,
    pending:              pending.length,
    closed:               closed.length,
    winRate:              winRate(active),
    totalPnl:             totalPnlUSD(active),
    totalPnlByCurrency:   totalPnlByCurrency(active),
    avgPnlPct:            avgPnlPct(active),
    openUnrealizedPnl:    totalOpenUnrealizedPnl,
    bestTrade:            best,
    worstTrade:           worst,
    openExposure,
    byStrategy,
  };
}
