import 'server-only';
import { getDb } from './client';
import type { Signal } from '@/core/types';

/** Signal as stored in the DB - includes the insertion timestamp. */
export interface StoredSignal extends Signal {
  createdAt: string;
}

/**
 * Insert an array of signals in a single transaction.
 * OR IGNORE: re-scanning the same bar keeps the original row and created_at,
 * so signal history reflects when a signal was first seen.
 */
export function insertSignals(signals: Signal[]): void {
  if (signals.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO signals (symbol, time, side, strength, reason, strategy_id, created_at)
    VALUES (@symbol, @time, @side, @strength, @reason, @strategyId, @createdAt)
  `);
  const createdAt = new Date().toISOString();
  const insertMany = db.transaction((rows: Signal[]) => {
    for (const s of rows) {
      stmt.run({
        symbol:     s.symbol,
        time:       s.time,
        side:       s.side,
        strength:   s.strength ?? null,
        reason:     s.reason,
        strategyId: s.strategyId,
        createdAt,
      });
    }
  });
  insertMany(signals);
}

interface SignalRow {
  symbol:      string;
  time:        string;
  side:        string;
  strength:    number | null;
  reason:      string;
  strategy_id: string;
  created_at:  string | null;
}

function rowToSignal(r: SignalRow): StoredSignal {
  return {
    symbol:     r.symbol,
    time:       r.time,
    side:       r.side as Signal['side'],
    strength:   r.strength ?? undefined,
    reason:     r.reason,
    strategyId: r.strategy_id,
    createdAt:  r.created_at ?? r.time,
  };
}

export interface GetSignalsOpts {
  strategyId?: string;
  symbol?:     string;
  /** Only signals with bar time >= since (ISO date). */
  since?:      string;
  limit?:      number;
}

/** Return signals ordered by time descending (most recent first). */
export function getSignals(opts: GetSignalsOpts = {}): StoredSignal[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (opts.strategyId) {
    conditions.push('strategy_id = @strategyId');
    params.strategyId = opts.strategyId;
  }
  if (opts.symbol) {
    conditions.push('symbol = @symbol');
    params.symbol = opts.symbol;
  }
  if (opts.since) {
    conditions.push('time >= @since');
    params.since = opts.since;
  }

  const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit  = opts.limit ? `LIMIT ${opts.limit}` : '';
  const rows   = db
    .prepare(`SELECT symbol, time, side, strength, reason, strategy_id, created_at FROM signals ${where} ORDER BY time DESC ${limit}`)
    .all(params) as SignalRow[];

  return rows.map(rowToSignal);
}

/**
 * Latest stored signal per (symbol, strategy) for the given symbols.
 * Used by the watchlist sidebar to show current signal status at a glance.
 */
export function getLatestSignals(symbols: string[]): StoredSignal[] {
  if (symbols.length === 0) return [];
  const db = getDb();
  const placeholders = symbols.map(() => '?').join(', ');
  const rows = db
    .prepare(`
      SELECT symbol, time, side, strength, reason, strategy_id, created_at FROM (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY symbol, strategy_id ORDER BY time DESC, id DESC
        ) AS rn
        FROM signals
        WHERE symbol IN (${placeholders})
      )
      WHERE rn = 1
      ORDER BY symbol, strategy_id
    `)
    .all(...symbols) as SignalRow[];
  return rows.map(rowToSignal);
}
