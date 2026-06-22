import 'server-only';
import { getDb } from '@/core/db/client';
import type { IngestResult } from '@/core/data/ingest';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IngestRunInput {
  startedAt:    string;   // ISO timestamp
  finishedAt:   string;   // ISO timestamp
  trigger:      'eod-cron' | 'manual' | 'api';
  totalSymbols: number;
  totalBars:    number;
  errorCount:   number;
  errors:       Array<{ symbol: string; error: string }>;
  durationMs:   number;
}

export interface IngestRun {
  id:           number;
  startedAt:    string;
  finishedAt:   string;
  trigger:      string;
  totalSymbols: number;
  totalBars:    number;
  errorCount:   number;
  errors:       Array<{ symbol: string; error: string }>;
  durationMs:   number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an IngestRunInput from the raw IngestResult[] returned by refreshUniverse. */
export function buildIngestRunInput(
  results:   IngestResult[],
  startedAt: string,
  trigger:   IngestRunInput['trigger'],
): IngestRunInput {
  const finishedAt  = new Date().toISOString();
  const durationMs  = Date.now() - new Date(startedAt).getTime();
  const totalBars   = results.reduce((s, r) => s + r.barsAdded, 0);
  const errorItems  = results
    .filter((r) => r.error)
    .map((r) => ({ symbol: r.symbol, error: r.error! }));
  return {
    startedAt,
    finishedAt,
    trigger,
    totalSymbols: results.length,
    totalBars,
    errorCount:   errorItems.length,
    errors:       errorItems,
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

export function insertIngestRun(input: IngestRunInput): number {
  const db     = getDb();
  const result = db.prepare(`
    INSERT INTO ingest_runs
      (started_at, finished_at, trigger, total_symbols, total_bars, error_count, errors_json, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.startedAt,
    input.finishedAt,
    input.trigger,
    input.totalSymbols,
    input.totalBars,
    input.errorCount,
    JSON.stringify(input.errors),
    input.durationMs,
  );
  return result.lastInsertRowid as number;
}

export function pruneOldIngestRuns(keepMostRecent = 30): void {
  const db = getDb();
  db.prepare(`
    DELETE FROM ingest_runs
    WHERE id NOT IN (
      SELECT id FROM ingest_runs ORDER BY started_at DESC LIMIT ?
    )
  `).run(keepMostRecent);
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

export function getLatestIngestRun(): IngestRun | null {
  try {
    const db  = getDb();
    const row = db.prepare(`
      SELECT id, started_at, finished_at, trigger,
             total_symbols, total_bars, error_count, errors_json, duration_ms
      FROM ingest_runs
      ORDER BY started_at DESC
      LIMIT 1
    `).get() as Record<string, unknown> | undefined;
    if (!row) return null;
    return rowToIngestRun(row);
  } catch {
    // Table not yet created (migration pending - restart server)
    return null;
  }
}

export function getRecentIngestRuns(limit = 10): IngestRun[] {
  try {
    const db   = getDb();
    const rows = db.prepare(`
      SELECT id, started_at, finished_at, trigger,
             total_symbols, total_bars, error_count, errors_json, duration_ms
      FROM ingest_runs
      ORDER BY started_at DESC
      LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;
    return rows.map(rowToIngestRun);
  } catch {
    return [];
  }
}

function rowToIngestRun(r: Record<string, unknown>): IngestRun {
  let errors: Array<{ symbol: string; error: string }> = [];
  try {
    errors = JSON.parse(r['errors_json'] as string) as typeof errors;
  } catch { /* corrupt JSON - treat as no errors */ }
  return {
    id:           r['id'] as number,
    startedAt:    r['started_at'] as string,
    finishedAt:   r['finished_at'] as string,
    trigger:      r['trigger'] as string,
    totalSymbols: r['total_symbols'] as number,
    totalBars:    r['total_bars'] as number,
    errorCount:   r['error_count'] as number,
    errors,
    durationMs:   r['duration_ms'] as number,
  };
}
