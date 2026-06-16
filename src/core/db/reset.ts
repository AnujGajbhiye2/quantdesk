import 'server-only';
import { getDb } from './client';

/**
 * Reset paper-trading state only.
 * Clears: paper_trades, journal, signals, strategy_edge, alert_log, account.
 * Preserves: symbols, bars, fundamentals_cache, news_cache, watchlist.
 * (Market data is expensive to re-ingest - keep it.)
 */
export function resetPaperState(): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM paper_trades').run();
    db.prepare('DELETE FROM journal').run();
    db.prepare('DELETE FROM signals').run();
    db.prepare('DELETE FROM strategy_edge').run();
    db.prepare('DELETE FROM alert_log').run();
    db.prepare('DELETE FROM account').run();
  })();
}

/**
 * Full wipe - removes everything including market data and caches.
 * Requires re-ingest after this operation.
 */
export function wipeAll(): void {
  const db = getDb();
  db.transaction(() => {
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
  })();
}
