import 'server-only';
import { getPaperTrades } from '@/core/db/paper';
import { buildPerformanceMetrics } from '@/core/paper/perf';
import { computeEquityHistory } from '@/core/paper/account';
import { buildReconcileReport } from '@/core/paper/reconcile';
import { toUSD } from '@/core/format/fx';

/**
 * Automated monthly report (IMPROVEMENT_PLAN.md WS5): one Telegram message on
 * the first day of each month summarizing the PREVIOUS calendar month plus
 * lifetime state - equity, drawdown, hit rate, profit factor, costs paid,
 * per-strategy counts, and any reconciliation drift flags.
 */

export interface MonthlyReportInput {
  /** Month to report, 'YYYY-MM'. Defaults to the previous calendar month. */
  month?: string;
}

function previousMonth(now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function buildMonthlyReport(input: MonthlyReportInput = {}): string {
  const month = input.month ?? previousMonth();

  const closed = getPaperTrades({ status: 'closed' }).filter(
    (t) => t.exitTime != null && t.exitTime.slice(0, 7) === month,
  );
  const monthPnl   = closed.reduce((s, t) => s + toUSD(t.pnl ?? 0, t.currency), 0);
  const monthCosts = closed.reduce((s, t) => s + toUSD(t.costs, t.currency), 0);
  const monthWins  = closed.filter((t) => (t.pnl ?? 0) > 0).length;

  const byStrategy = new Map<string, { n: number; pnl: number }>();
  for (const t of closed) {
    const cur = byStrategy.get(t.strategyId) ?? { n: 0, pnl: 0 };
    cur.n += 1;
    cur.pnl += toUSD(t.pnl ?? 0, t.currency);
    byStrategy.set(t.strategyId, cur);
  }

  const perf    = buildPerformanceMetrics();
  const history = computeEquityHistory();
  const recon   = buildReconcileReport();
  const equity  = history && history.points.length > 0
    ? history.points[history.points.length - 1].equity
    : null;

  const lines: string[] = [];
  lines.push(`<b>MONTHLY REPORT - ${month}</b>`);
  lines.push('');
  lines.push(`<b>Month:</b> ${closed.length} closed | ${monthWins}W/${closed.length - monthWins}L | P&amp;L ${monthPnl >= 0 ? '+' : ''}$${monthPnl.toFixed(2)} | costs $${monthCosts.toFixed(2)}`);
  for (const [sid, v] of byStrategy) {
    lines.push(`  ${sid}: ${v.n} trades, ${v.pnl >= 0 ? '+' : ''}$${v.pnl.toFixed(2)}`);
  }
  lines.push('');
  lines.push(
    `<b>Lifetime:</b> ${perf.totalTrades} trades | WR ${(perf.winRate * 100).toFixed(0)}% | ` +
    `PF ${Number.isFinite(perf.profitFactor) ? perf.profitFactor.toFixed(2) : 'inf'} | ` +
    `maxDD ${perf.maxDrawdownPct.toFixed(1)}%` +
    (perf.sharpe != null ? ` | Sharpe ${perf.sharpe.toFixed(2)}` : ''),
  );
  if (equity != null && history) {
    const ret = ((equity - history.startingBalance) / history.startingBalance) * 100;
    lines.push(`<b>Equity:</b> $${equity.toFixed(2)} (${ret >= 0 ? '+' : ''}${ret.toFixed(2)}% realized)`);
  }

  const flagged = recon.rows.filter((r) => r.flags.length > 0);
  if (flagged.length > 0) {
    lines.push('');
    lines.push('<b>Drift flags:</b>');
    for (const r of flagged) lines.push(`  ${r.strategyId}: ${r.flags.join('; ')}`);
  }

  const passing = recon.criteria.filter((c) => c.status === 'pass').length;
  const scored  = recon.criteria.filter((c) => c.status !== 'n/a').length;
  lines.push('');
  lines.push(`<b>Promotion criteria:</b> ${passing}/${scored} passing (see /reconcile)`);
  lines.push('');
  lines.push('<i>Research tool. Not financial advice. Results are hypothetical.</i>');

  return lines.join('\n');
}
