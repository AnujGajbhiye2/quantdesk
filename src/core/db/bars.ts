import 'server-only';
import { getDb } from './client';
import type { Bar, SymbolMeta, Timeframe } from '@/core/types';

/**
 * DB helpers for bars and symbols.
 * These are the only functions that write to the bars/symbols tables.
 * Adapters never call these directly - ingestion goes through core/data/ingest.ts.
 */

/** Upsert a single SymbolMeta row into the symbols table. */
export function upsertSymbol(meta: SymbolMeta): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO symbols (symbol, provider_symbol, name, asset_class, currency, exchange, provider_id)
    VALUES (@symbol, @providerSymbol, @name, @assetClass, @currency, @exchange, @providerId)
    ON CONFLICT(symbol) DO UPDATE SET
      provider_symbol = excluded.provider_symbol,
      name            = excluded.name,
      asset_class     = excluded.asset_class,
      currency        = excluded.currency,
      exchange        = excluded.exchange,
      provider_id     = excluded.provider_id
  `);
  stmt.run({
    symbol: meta.symbol,
    providerSymbol: meta.providerSymbol,
    name: meta.name,
    assetClass: meta.assetClass,
    currency: meta.currency,
    exchange: meta.exchange ?? null,
    providerId: meta.providerId,
  });
}

/** Upsert an array of bars for a given symbol + timeframe in a single transaction. */
export function upsertBars(
  symbol: string,
  timeframe: Timeframe,
  bars: Bar[],
): void {
  if (bars.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO bars (symbol, timeframe, time, open, high, low, close, volume)
    VALUES (@symbol, @timeframe, @time, @open, @high, @low, @close, @volume)
    ON CONFLICT(symbol, timeframe, time) DO UPDATE SET
      open   = excluded.open,
      high   = excluded.high,
      low    = excluded.low,
      close  = excluded.close,
      volume = excluded.volume
  `);
  const insertMany = db.transaction((rows: Bar[]) => {
    for (const bar of rows) {
      stmt.run({ symbol, timeframe, ...bar });
    }
  });
  insertMany(bars);
}

/**
 * Return the most recent bar time stored for a symbol + timeframe,
 * or null if no bars exist yet.
 */
export function getLatestBarTime(
  symbol: string,
  timeframe: Timeframe,
): string | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT MAX(time) as latest FROM bars WHERE symbol = ? AND timeframe = ?`,
    )
    .get(symbol, timeframe) as { latest: string | null } | undefined;
  return row?.latest ?? null;
}

/**
 * Return all bars for a symbol + timeframe, sorted by time ascending.
 * Used by the backtest engine and the manual sanity-check script.
 */
export function getBars(symbol: string, timeframe: Timeframe): Bar[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT time, open, high, low, close, volume
       FROM bars
       WHERE symbol = ? AND timeframe = ?
       ORDER BY time ASC`,
    )
    .all(symbol, timeframe) as Array<{
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  return rows.map((r) => ({
    time:   r.time,
    open:   r.open,
    high:   r.high,
    low:    r.low,
    close:  r.close,
    volume: r.volume,
  }));
}

/**
 * Return the most recent `limit` bars for a symbol + timeframe, sorted ascending.
 * Scanner path: avoids loading 10y of history when 600 bars cover every
 * registered indicator's warm-up (MA200 + convergence margin).
 */
export function getRecentBars(
  symbol: string,
  timeframe: Timeframe,
  limit: number,
): Bar[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT time, open, high, low, close, volume
       FROM bars
       WHERE symbol = ? AND timeframe = ?
       ORDER BY time DESC
       LIMIT ?`,
    )
    .all(symbol, timeframe, limit) as Array<{
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  rows.reverse();
  return rows.map((r) => ({
    time:   r.time,
    open:   r.open,
    high:   r.high,
    low:    r.low,
    close:  r.close,
    volume: r.volume,
  }));
}

/** Return the most recent close price for a symbol + timeframe, or null. */
export function getLatestClose(
  symbol: string,
  timeframe: Timeframe,
): number | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT close FROM bars WHERE symbol = ? AND timeframe = ? ORDER BY time DESC LIMIT 1`,
    )
    .get(symbol, timeframe) as { close: number } | undefined;
  return row?.close ?? null;
}

/** Return all stored symbol rows. */
export function getAllSymbols(): SymbolMeta[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT symbol, provider_symbol, name, asset_class, currency, exchange, provider_id FROM symbols`,
    )
    .all() as Array<{
    symbol: string;
    provider_symbol: string;
    name: string;
    asset_class: string;
    currency: string;
    exchange: string | null;
    provider_id: string;
  }>;
  return rows.map((r) => ({
    symbol: r.symbol,
    providerSymbol: r.provider_symbol,
    name: r.name,
    assetClass: r.asset_class as SymbolMeta['assetClass'],
    currency: r.currency,
    exchange: r.exchange ?? undefined,
    providerId: r.provider_id,
  }));
}
