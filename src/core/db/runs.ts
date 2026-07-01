import 'server-only';
import { getDb } from '@/core/db/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScanRunInput {
  startedAt:        string;   // ISO timestamp
  finishedAt:       string;   // ISO timestamp
  timeframe:        string;   // e.g. '1d'
  trigger:          'eod-cron' | 'manual' | 'api';
  symbolsScanned:   number;
  strategiesCount:  number;
  evaluations:      number;   // symbolsScanned * strategiesCount
  signalsGenerated: number;
  tradesOpened:     number;
  tradesClosed:     number;
  durationMs:       number;
}

export interface ScanRun {
  id:               number;
  startedAt:        string;
  finishedAt:       string;
  timeframe:        string;
  trigger:          string;
  symbolsScanned:   number;
  strategiesCount:  number;
  evaluations:      number;
  signalsGenerated: number;
  tradesOpened:     number;
  tradesClosed:     number;
  durationMs:       number;
}

export interface DecisionRow {
  runId:      number;
  symbol:     string;
  strategyId: string;
  barTime:    string;
  fired:      0 | 1;
  action:     string;
  reason:     string | null;
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

/** Insert a scan run and return its auto-assigned id. */
export function insertScanRun(input: ScanRunInput): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO scan_runs
      (started_at, finished_at, timeframe, trigger,
       symbols_scanned, strategies_count, evaluations,
       signals_generated, trades_opened, trades_closed, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.startedAt,
    input.finishedAt,
    input.timeframe,
    input.trigger,
    input.symbolsScanned,
    input.strategiesCount,
    input.evaluations,
    input.signalsGenerated,
    input.tradesOpened,
    input.tradesClosed,
    input.durationMs,
  );
  return result.lastInsertRowid as number;
}

/**
 * Bulk-insert decision log rows for a run.
 *
 * No db.transaction() - libsql's embedded-replica connection throws
 * InvalidParserState("Init") for a bare SAVEPOINT outside an active
 * transaction (upstream bug: https://github.com/tursodatabase/libsql/issues/1382).
 * See client.ts header comment for the full explanation.
 */
export function insertDecisions(rows: DecisionRow[]): void {
  if (rows.length === 0) return;
  const db   = getDb();
  const stmt = db.prepare(`
    INSERT INTO decision_log (run_id, symbol, strategy_id, bar_time, fired, action, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const r of rows) {
    stmt.run(r.runId, r.symbol, r.strategyId, r.barTime, r.fired, r.action, r.reason ?? null);
  }
}

/**
 * Prune old runs (and their decision_log rows) keeping only the most recent N.
 * Called at the end of each EOD run to bound DB growth (~1,500 rows/run).
 */
export function pruneOldRuns(keepMostRecent = 30): void {
  const db = getDb();
  db.prepare(`
    DELETE FROM decision_log
    WHERE run_id IN (
      SELECT id FROM scan_runs
      ORDER BY started_at DESC
      LIMIT -1 OFFSET ?
    )
  `).run(keepMostRecent);
  db.prepare(`
    DELETE FROM scan_runs
    WHERE id NOT IN (
      SELECT id FROM scan_runs ORDER BY started_at DESC LIMIT ?
    )
  `).run(keepMostRecent);
}

/**
 * Update trades_opened and trades_closed on the most recent scan_runs row.
 * Called from post-refresh after sweep results are known.
 */
export function updateScanRunCounts(runId: number, tradesOpened: number, tradesClosed: number): void {
  const db = getDb();
  db.prepare(`
    UPDATE scan_runs SET trades_opened = ?, trades_closed = ? WHERE id = ?
  `).run(tradesOpened, tradesClosed, runId);
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

/** Return the most recent scan run, or null if none exist. */
export function getLatestRun(): ScanRun | null {
  try {
    const db  = getDb();
    const row = db.prepare(`
      SELECT id, started_at, finished_at, timeframe, trigger,
             symbols_scanned, strategies_count, evaluations,
             signals_generated, trades_opened, trades_closed, duration_ms
      FROM scan_runs
      ORDER BY started_at DESC
      LIMIT 1
    `).get() as Record<string, unknown> | undefined;
    if (!row) return null;
    return rowToScanRun(row);
  } catch {
    // Table not yet created (migration pending - restart server)
    return null;
  }
}

/** Return all decision_log rows for a given run_id. */
export function getDecisionsForRun(runId: number): DecisionRow[] {
  try {
    const db   = getDb();
    const rows = db.prepare(`
      SELECT run_id, symbol, strategy_id, bar_time, fired, action, reason
      FROM decision_log
      WHERE run_id = ?
      ORDER BY symbol, strategy_id
    `).all(runId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      runId:      r['run_id'] as number,
      symbol:     r['symbol'] as string,
      strategyId: r['strategy_id'] as string,
      barTime:    r['bar_time'] as string,
      fired:      (r['fired'] as number) as 0 | 1,
      action:     r['action'] as string,
      reason:     (r['reason'] ?? null) as string | null,
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToScanRun(r: Record<string, unknown>): ScanRun {
  return {
    id:               r['id'] as number,
    startedAt:        r['started_at'] as string,
    finishedAt:       r['finished_at'] as string,
    timeframe:        r['timeframe'] as string,
    trigger:          r['trigger'] as string,
    symbolsScanned:   r['symbols_scanned'] as number,
    strategiesCount:  r['strategies_count'] as number,
    evaluations:      r['evaluations'] as number,
    signalsGenerated: r['signals_generated'] as number,
    tradesOpened:     r['trades_opened'] as number,
    tradesClosed:     r['trades_closed'] as number,
    durationMs:       r['duration_ms'] as number,
  };
}
