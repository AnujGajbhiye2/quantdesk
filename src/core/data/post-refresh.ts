import 'server-only';
import { sweepOpenTrades, sweepPendingTrades, type SweepResult, type PendingFillResult } from '@/core/paper/broker';
import { scanAll, type ScanAllResult } from '@/core/scan/scan-all';
import { computeEdgeForUniverse, type ComputeEdgeResult } from '@/core/edge/compute';
import { invalidateSnapshotCache } from '@/core/market/snapshot';

/**
 * Tasks that must run after every EOD data refresh, regardless of how the
 * refresh was triggered (scripts/refresh.ts CLI, node-cron in
 * instrumentation.ts, or POST /api/ingest).
 *
 * 1. Sweep open paper trades against new bars (stop/target fills).
 * 2. Run the all-strategies x all-symbols scan and persist signals,
 *    so signal history accumulates daily without manual scans.
 * 3. Recompute backtested edge stats (trailing 2y) for every strategy.
 */

export interface PostRefreshSummary {
  pendingFills: { results: PendingFillResult[]; error?: string };
  sweep:        { results: SweepResult[]; error?: string };
  scan:         { result: ScanAllResult | null; error?: string };
  edge:         { result: ComputeEdgeResult | null; error?: string };
}

export function postRefreshTasks(): PostRefreshSummary {
  const summary: PostRefreshSummary = {
    pendingFills: { results: [] },
    sweep:        { results: [] },
    scan:         { result: null },
    edge:         { result: null },
  };

  // New bars just landed - force a fresh snapshot on the next dashboard load.
  invalidateSnapshotCache();

  // Check resting limit orders FIRST so a trade that fills and immediately
  // hits its stop/target is also caught in the sweep below.
  try {
    summary.pendingFills.results = sweepPendingTrades();
  } catch (err) {
    summary.pendingFills.error = err instanceof Error ? err.message : String(err);
  }

  try {
    summary.sweep.results = sweepOpenTrades();
  } catch (err) {
    summary.sweep.error = err instanceof Error ? err.message : String(err);
  }

  try {
    // excludeToday: false - post-refresh runs after market close (EOD cron or
    // refresh script), where today's bar is final and MUST be scanned;
    // dropping it would make every signal a day late.
    summary.scan.result = scanAll({ persist: true, excludeToday: false });
  } catch (err) {
    summary.scan.error = err instanceof Error ? err.message : String(err);
  }

  try {
    summary.edge.result = computeEdgeForUniverse();
  } catch (err) {
    summary.edge.error = err instanceof Error ? err.message : String(err);
  }

  return summary;
}
