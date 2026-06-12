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
