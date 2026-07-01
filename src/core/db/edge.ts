import 'server-only';
import { getDb } from './client';
import type { AssetClass } from '@/core/types';
import type { EdgeStats } from '@/core/edge/types';

interface EdgeRow {
  strategy_id:          string;
  scope:                string;
  symbol:               string | null;
  asset_class:          string | null;
  win_rate:             number;
  avg_win_pct:          number;
  avg_loss_pct:         number;
  profit_factor:        number;
  num_trades:           number;
  median_win_hold_bars: number;
  tested_from:          string;
  tested_to:            string;
  computed_at:          string;
}

function rowToStats(r: EdgeRow): EdgeStats {
  return {
    strategyId:        r.strategy_id,
    scope:             r.scope,
    symbol:            r.symbol,
    assetClass:        r.asset_class as AssetClass | null,
    winRate:           r.win_rate,
    avgWinPct:         r.avg_win_pct,
    avgLossPct:        r.avg_loss_pct,
    profitFactor:      r.profit_factor,
    numTrades:         r.num_trades,
    medianWinHoldBars: r.median_win_hold_bars,
    testedFrom:        r.tested_from,
    testedTo:          r.tested_to,
    computedAt:        r.computed_at,
  };
}

/**
 * Upsert edge rows, keyed (strategy_id, scope).
 *
 * Positional (?) params, no db.transaction() - libsql's embedded-replica
 * connection silently drops writes bound via named object args, and its
 * transaction() helper throws InvalidParserState("Init") (upstream bug:
 * https://github.com/tursodatabase/libsql/issues/1382). See client.ts
 * header comment for the full explanation.
 */
export function upsertEdgeStats(rows: EdgeStats[]): void {
  if (rows.length === 0) return;
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO strategy_edge (
      strategy_id, scope, symbol, asset_class, win_rate, avg_win_pct,
      avg_loss_pct, profit_factor, num_trades, median_win_hold_bars,
      tested_from, tested_to, computed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(strategy_id, scope) DO UPDATE SET
      symbol               = excluded.symbol,
      asset_class          = excluded.asset_class,
      win_rate             = excluded.win_rate,
      avg_win_pct          = excluded.avg_win_pct,
      avg_loss_pct         = excluded.avg_loss_pct,
      profit_factor        = excluded.profit_factor,
      num_trades           = excluded.num_trades,
      median_win_hold_bars = excluded.median_win_hold_bars,
      tested_from          = excluded.tested_from,
      tested_to            = excluded.tested_to,
      computed_at          = excluded.computed_at
  `);
  for (const r of rows) {
    stmt.run([
      r.strategyId, r.scope, r.symbol, r.assetClass, r.winRate, r.avgWinPct,
      r.avgLossPct, r.profitFactor, r.numTrades, r.medianWinHoldBars,
      r.testedFrom, r.testedTo, r.computedAt,
    ]);
  }
}

export interface GetEdgeStatsOpts {
  strategyId?: string;
  scope?:      string;
  /** Convenience filter: symbol-scoped rows for this symbol. */
  symbol?:     string;
}

export function getEdgeStats(opts: GetEdgeStatsOpts = {}): EdgeStats[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (opts.strategyId) {
    conditions.push('strategy_id = @strategyId');
    params.strategyId = opts.strategyId;
  }
  if (opts.scope) {
    conditions.push('scope = @scope');
    params.scope = opts.scope;
  }
  if (opts.symbol) {
    conditions.push('symbol = @symbol');
    params.symbol = opts.symbol;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM strategy_edge ${where} ORDER BY strategy_id, scope`)
    .all(params) as EdgeRow[];
  return rows.map(rowToStats);
}
