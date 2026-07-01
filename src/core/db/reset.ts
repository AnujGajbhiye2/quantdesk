import 'server-only';
import { getDb } from './client';

// NOTE: no db.transaction() - libsql's embedded-replica connection throws
// InvalidParserState("Init") for a bare SAVEPOINT outside an active
// transaction (upstream bug: https://github.com/tursodatabase/libsql/issues/1382).
// See client.ts header comment for the full explanation. These deletes have
// no cross-table invariants to protect mid-sequence, so plain sequential
// statements are an acceptable (and simpler) substitute for real atomicity.

/**
 * Reset paper-trading state only.
 * Clears: paper_trades, journal, signals, strategy_edge, alert_log, account.
 * Preserves: symbols, bars, fundamentals_cache, news_cache, watchlist.
 * (Market data is expensive to re-ingest - keep it.)
 */
export function resetPaperState(): void {
  const db = getDb();
  db.prepare('DELETE FROM paper_trades').run();
  db.prepare('DELETE FROM journal').run();
  db.prepare('DELETE FROM signals').run();
  db.prepare('DELETE FROM strategy_edge').run();
  db.prepare('DELETE FROM alert_log').run();
  db.prepare('DELETE FROM account').run();
}

/**
 * Full wipe - removes everything including market data and caches.
 * Requires re-ingest after this operation.
 */
export function wipeAll(): void {
  const db = getDb();
  db.prepare('DELETE FROM paper_trades').run();
  db.prepare('DELETE FROM journal').run();
  db.prepare('DELETE FROM signals').run();
  db.prepare('DELETE FROM strategy_edge').run();
  db.prepare('DELETE FROM alert_log').run();
  db.prepare('DELETE FROM account').run();
  db.prepare('DELETE FROM bars').run();
  db.prepare('DELETE FROM symbols').run();
  db.prepare('DELETE FROM fundamentals_cache').run();
  db.prepare('DELETE FROM news_cache').run();
  db.prepare('DELETE FROM watchlist').run();
}
