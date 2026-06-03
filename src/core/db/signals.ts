import 'server-only';
import { getDb } from './client';
import type { Signal } from '@/core/types';

/** Insert an array of signals in a single transaction. */
export function insertSignals(signals: Signal[]): void {
  if (signals.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO signals (symbol, time, side, strength, reason, strategy_id)
    VALUES (@symbol, @time, @side, @strength, @reason, @strategyId)
  `);
  const insertMany = db.transaction((rows: Signal[]) => {
    for (const s of rows) {
      stmt.run({
        symbol:     s.symbol,
        time:       s.time,
        side:       s.side,
        strength:   s.strength ?? null,
        reason:     s.reason,
        strategyId: s.strategyId,
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
}

function rowToSignal(r: SignalRow): Signal {
  return {
    symbol:     r.symbol,
    time:       r.time,
    side:       r.side as Signal['side'],
    strength:   r.strength ?? undefined,
    reason:     r.reason,
    strategyId: r.strategy_id,
  };
}

export interface GetSignalsOpts {
  strategyId?: string;
  symbol?:     string;
  limit?:      number;
}

/** Return signals ordered by time descending (most recent first). */
export function getSignals(opts: GetSignalsOpts = {}): Signal[] {
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

  const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit  = opts.limit ? `LIMIT ${opts.limit}` : '';
  const rows   = db
    .prepare(`SELECT symbol, time, side, strength, reason, strategy_id FROM signals ${where} ORDER BY time DESC ${limit}`)
    .all(params) as SignalRow[];

  return rows.map(rowToSignal);
}
