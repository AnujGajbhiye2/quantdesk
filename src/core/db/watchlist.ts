import 'server-only';
import { getDb } from './client';

export interface WatchlistEntry {
  symbol:   string;
  pinnedAt: string;
}

interface WatchlistRow {
  symbol:    string;
  pinned_at: string;
}

/** All pinned symbols, most recently pinned first. */
export function getWatchlist(): WatchlistEntry[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT symbol, pinned_at FROM watchlist ORDER BY pinned_at DESC')
    .all() as WatchlistRow[];
  return rows.map((r) => ({ symbol: r.symbol, pinnedAt: r.pinned_at }));
}

export function addToWatchlist(symbol: string): void {
  const db = getDb();
  db.prepare('INSERT OR IGNORE INTO watchlist (symbol, pinned_at) VALUES (?, ?)')
    .run(symbol, new Date().toISOString());
}

export function removeFromWatchlist(symbol: string): void {
  const db = getDb();
  db.prepare('DELETE FROM watchlist WHERE symbol = ?').run(symbol);
}
