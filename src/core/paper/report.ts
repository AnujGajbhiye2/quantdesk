import 'server-only';
import { getPaperTrades } from '@/core/db/paper';
import { getLatestRun, getDecisionsForRun, type ScanRun, type DecisionRow } from '@/core/db/runs';
import { withEstHold, type PaperTradeWithHold } from '@/core/paper/hold';
import { accountSummary } from '@/core/paper/summary';
import { computeEquityHistory, type EquityHistory } from '@/core/paper/account';
import { buildPerformanceMetrics, computeMetricsFromTrades, type PerfMetrics } from '@/core/paper/perf';
import { buildTradeBook, type TradeBook } from '@/core/paper/tradebook';
import { buildReconcileReport, type ReconcileReport } from '@/core/paper/reconcile';
import type { AccountSummary } from '@/core/paper/account';

/**
 * Full data export for feeding into an external analyst (e.g. Claude) -
 * one JSON bundle combining every read-side view the /paper UI already
 * shows, plus the raw trade log and the latest market-scan decision log.
 *
 * Read-only, gated the same as the other read actions in /api/paper
 * (requireUser(), not admin-only).
 */

export interface ReportScope {
  /** ISO date 'YYYY-MM-DD', inclusive. Omit for all-time. */
  from?: string;
  /** ISO date 'YYYY-MM-DD', inclusive. Omit for all-time. */
  to?: string;
}

export interface ReportBundle {
  meta: {
    generatedAt: string;
    scope: { from: string | null; to: string | null; allTime: boolean };
    disclaimer: string;
  };
  account: AccountSummary | null;
  equityHistory: EquityHistory | null;
  performanceLifetime: PerfMetrics;
  /** Present only when from/to narrows the window - metrics for that window alone. */
  performancePeriod: PerfMetrics | null;
  tradebook: TradeBook;
  reconcile: ReconcileReport;
  trades: PaperTradeWithHold[];
  scanSnapshot: {
    run: ScanRun | null;
    decisions: DecisionRow[];
  };
}

const DISCLAIMER = 'Research tool. Not financial advice. Results are hypothetical.';

function inWindow(dateStr: string | undefined, from?: string, to?: string): boolean {
  if (!dateStr) return false;
  const d = dateStr.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

export function buildReport(scope: ReportScope = {}): ReportBundle {
  const { from, to } = scope;
  const allTime = !from && !to;

  // Every trade (open + closed + pending), with estHold attached exactly
  // like the 'list' action - open/pending always included regardless of
  // the date window so current book state is visible in every export.
  const allTrades = withEstHold(getPaperTrades({}));
  const trades = allTime
    ? allTrades
    : allTrades.filter((t) => t.status !== 'closed' || inWindow(t.exitTime, from, to));

  const closedInWindow = getPaperTrades({ status: 'closed' }).filter((t) =>
    inWindow(t.exitTime, from, to),
  );

  const run = getLatestRun();

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      scope: { from: from ?? null, to: to ?? null, allTime },
      disclaimer: DISCLAIMER,
    },
    account: accountSummary(),
    equityHistory: computeEquityHistory(),
    performanceLifetime: buildPerformanceMetrics(),
    performancePeriod: allTime ? null : computeMetricsFromTrades(closedInWindow),
    tradebook: buildTradeBook(),
    reconcile: buildReconcileReport(),
    trades,
    scanSnapshot: {
      run,
      decisions: run ? getDecisionsForRun(run.id) : [],
    },
  };
}
