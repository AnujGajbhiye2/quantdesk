import 'server-only';
import { randomUUID } from 'node:crypto';
import { getDb } from './client';
import type { BacktestMetrics } from '@/core/backtest/engine';

/**
 * Saved backtest runs - params + metrics snapshot per run (WS4.5). Writes use
 * positional params per the embedded-replica-era convention in core/db.
 */

export interface BacktestRunRow {
  id:         string;
  createdAt:  string;
  strategyId: string;
  symbol:     string;
  timeframe:  string;
  params:     Record<string, unknown>;
  metrics:    BacktestMetrics;
}

export function insertBacktestRun(input: {
  strategyId: string;
  symbol:     string;
  timeframe:  string;
  params:     Record<string, unknown>;
  metrics:    BacktestMetrics;
}): string {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO backtest_runs (id, created_at, strategy_id, symbol, timeframe, params, metrics)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run([
    id,
    new Date().toISOString(),
    input.strategyId,
    input.symbol,
    input.timeframe,
    JSON.stringify(input.params),
    JSON.stringify(input.metrics),
  ]);
  return id;
}

export function getBacktestRuns(limit = 50): BacktestRunRow[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, created_at, strategy_id, symbol, timeframe, params, metrics
     FROM backtest_runs ORDER BY created_at DESC LIMIT ?`,
  ).all(limit) as Array<{
    id: string; created_at: string; strategy_id: string; symbol: string;
    timeframe: string; params: string; metrics: string;
  }>;
  return rows.map((r) => ({
    id:         r.id,
    createdAt:  r.created_at,
    strategyId: r.strategy_id,
    symbol:     r.symbol,
    timeframe:  r.timeframe,
    params:     JSON.parse(r.params) as Record<string, unknown>,
    metrics:    JSON.parse(r.metrics) as BacktestMetrics,
  }));
}
