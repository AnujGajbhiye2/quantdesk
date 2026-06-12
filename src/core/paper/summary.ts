import 'server-only';
import { markOpenTrades } from './broker';
import { computeCashAccount, buildAccountSummary, type AccountSummary } from './account';
import { toUSD } from '@/core/format/fx';

/**
 * Account summary with mark-to-market unrealized P&L from latest stored
 * closes (deterministic, no network). Null when no budget has been set.
 * Lives apart from account.ts so account.ts never imports the broker.
 */
export function accountSummary(): AccountSummary | null {
  const cashAccount = computeCashAccount();
  if (!cashAccount) return null;
  const unrealizedUSD = markOpenTrades().reduce(
    (sum, m) => sum + toUSD(m.unrealizedPnl, m.trade.currency),
    0,
  );
  return buildAccountSummary(cashAccount, unrealizedUSD);
}
