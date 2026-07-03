import 'server-only';
import { getAccountRow } from '@/core/db/account';
import { getPaperTrades } from '@/core/db/paper';
import { toUSD } from '@/core/format/fx';

/**
 * Paper-trading budget accounting. The balance is DERIVED on every read from
 * starting_balance + the trades table - never stored - so it cannot drift:
 *
 *   cashUsed  = sum over OPEN trades of entry notional   (USD)
 *   realized  = sum over CLOSED trades of pnl            (USD)
 *   cash      = starting + realized - cashUsed
 *   equity    = cash + cashUsed + unrealized  (= starting + realized + unrealized)
 *   bankrupt  = equity <= 0 -> the system failed with this budget
 *
 * All amounts in USD; non-USD trades converted at static fx rates (core/format/fx).
 * No account row set -> null -> callers fall back to legacy 10k notional sizing.
 */

export interface CashAccount {
  startingBalance: number;
  /** Realized P&L over all closed trades (USD). */
  realized: number;
  /** Entry notional locked in open trades (USD). */
  cashUsed: number;
  /** Spendable cash for new trades (USD). */
  cash: number;
  openTrades: number;
  closedTrades: number;
}

export interface AccountSummary extends CashAccount {
  /** Mark-to-market P&L on open trades (USD). Pass-through from caller's marks. */
  unrealized: number;
  /** starting + realized + unrealized (USD). */
  equity: number;
  bankrupt: boolean;
}

/** Cash-side view (no marks needed). Null when no budget has been set. */
export function computeCashAccount(): CashAccount | null {
  const row = getAccountRow();
  if (!row) return null;

  const trades = getPaperTrades();
  let realized = 0;
  let cashUsed = 0;
  let openTrades = 0;
  let closedTrades = 0;

  for (const t of trades) {
    if (t.status === 'open') {
      cashUsed += toUSD(t.entryPrice * t.qty, t.currency);
      openTrades += 1;
    } else {
      realized += toUSD(t.pnl ?? 0, t.currency);
      closedTrades += 1;
    }
  }

  return {
    startingBalance: row.startingBalance,
    realized,
    cashUsed,
    cash: row.startingBalance + realized - cashUsed,
    openTrades,
    closedTrades,
  };
}

export interface EquityHistoryPoint {
  /** Exit date (YYYY-MM-DD). */
  time: string;
  /** starting balance + cumulative realized P&L after this date's exits (USD). */
  equity: number;
}

export interface DailyPnl {
  date: string;
  /** Realized P&L from trades closed on this date (USD). */
  pnl: number;
  trades: number;
}

export interface EquityHistory {
  startingBalance: number;
  /** Realized-only equity curve, one point per date with at least one exit. */
  points: EquityHistoryPoint[];
  /** Realized P&L per calendar date, ascending. */
  dailyPnl: DailyPnl[];
}

/**
 * Realized equity history derived from closed trades, one point per exit
 * date. Same derive-on-read philosophy as computeCashAccount - nothing is
 * stored. Unrealized marks are the caller's concern (the UI appends a
 * provisional "today" point from its live marks if it wants one).
 * Null when no budget has been set.
 */
export function computeEquityHistory(): EquityHistory | null {
  const row = getAccountRow();
  if (!row) return null;

  const closed = getPaperTrades({ status: 'closed' })
    .filter((t) => t.exitTime != null)
    .sort((a, b) => (a.exitTime! < b.exitTime! ? -1 : 1));

  const byDate = new Map<string, { pnl: number; trades: number }>();
  for (const t of closed) {
    const date = t.exitTime!.slice(0, 10);
    const cur = byDate.get(date) ?? { pnl: 0, trades: 0 };
    cur.pnl += toUSD(t.pnl ?? 0, t.currency);
    cur.trades += 1;
    byDate.set(date, cur);
  }

  const dailyPnl: DailyPnl[] = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, v]) => ({ date, pnl: v.pnl, trades: v.trades }));

  let equity = row.startingBalance;
  const points: EquityHistoryPoint[] = dailyPnl.map((d) => {
    equity += d.pnl;
    return { time: d.date, equity };
  });

  return { startingBalance: row.startingBalance, points, dailyPnl };
}

/**
 * Full summary given the unrealized USD P&L (callers obtain it from
 * markOpenTrades / markOpenTradesWithQuotes to avoid a circular import here).
 */
export function buildAccountSummary(
  cashAccount: CashAccount,
  unrealizedUSD: number,
): AccountSummary {
  const equity = cashAccount.startingBalance + cashAccount.realized + unrealizedUSD;
  return {
    ...cashAccount,
    unrealized: unrealizedUSD,
    equity,
    bankrupt: equity <= 0,
  };
}
