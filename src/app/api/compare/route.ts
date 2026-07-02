import { NextResponse } from 'next/server';
import { getBars } from '@/core/db/bars';
import { list as listStrategies, get as getStrategy } from '@/core/strategy/registry';
import { runBacktest } from '@/core/backtest/engine';
import { maxHoldBars } from '@/core/config';
import { dropPartialToday } from '@/core/scan/scanner';
import { BARS_PER_YEAR } from '@/core/backtest/metrics';
import type { Timeframe } from '@/core/types';

/**
 * POST /api/compare
 *
 * Run EVERY registered strategy as a backtest on one symbol and return a
 * comparison row per strategy. Answers "which strategy works best on NVDA?"
 * in one view. Same engine and cost model as /api/backtest - fills at next
 * open, commission + slippage applied, no look-ahead.
 *
 * Body: { "symbol": "NVDA", "timeframe": "1d" }  (timeframe optional)
 */

export interface CompareRow {
  strategyId:     string;
  name:           string;
  totalReturnPct: number;
  winRate:        number;   // 0..1
  sharpe:         number;
  maxDrawdownPct: number;
  numTrades:      number;
  profitFactor:   number;   // Infinity serialized as 9999
  error?:         string;
}

/** Benchmark symbol for market-context comparison. Non-tradeable regime index (see universe.ts reference.json). */
const BENCHMARK_SYMBOL = '^GSPC';

/**
 * Buy-and-hold return of the benchmark over the SAME date range as the
 * strategies being compared - a strategy that underperforms flat market
 * exposure, with more drawdown, has no business being traded regardless of
 * its own absolute return (SYSTEM_AUDIT_AND_ROADMAP.md Phase 5).
 */
function benchmarkReturnPct(fromTime: string, toTime: string): number | null {
  const benchBars = getBars(BENCHMARK_SYMBOL, '1d').filter((b) => b.time >= fromTime && b.time <= toTime);
  if (benchBars.length < 2) return null;
  const first = benchBars[0].close;
  const last  = benchBars[benchBars.length - 1].close;
  if (first <= 0) return null;
  return ((last - first) / first) * 100;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { symbol?: string; timeframe?: string };
    const symbol = (body.symbol ?? '').trim().toUpperCase();
    if (!symbol) {
      return NextResponse.json({ error: 'symbol required' }, { status: 400 });
    }

    const timeframe = (body.timeframe ?? '1d') as Timeframe;
    const barsPerYear = BARS_PER_YEAR[timeframe] ?? BARS_PER_YEAR['1d'];
    // Same partial-bar rule as /api/backtest: today's forming bar never feeds the engine
    const bars = dropPartialToday(getBars(symbol, timeframe));
    if (bars.length < 2) {
      return NextResponse.json(
        { error: `No bars found for ${symbol} / ${timeframe}. Ingest data first.` },
        { status: 422 },
      );
    }

    const started = Date.now();
    const rows: CompareRow[] = listStrategies().map(({ id, name }) => {
      try {
        const result = runBacktest({
          strategy: getStrategy(id),
          bars,
          symbol,
          timeframe,
          rawParams: {},
          maxHoldBars: maxHoldBars(),
          barsPerYear,
        });
        const m = result.metrics;
        return {
          strategyId:     id,
          name,
          totalReturnPct: m.totalReturnPct,
          winRate:        m.winRate,
          sharpe:         m.sharpe,
          maxDrawdownPct: m.maxDrawdownPct,
          numTrades:      m.numTrades,
          // Infinity is not valid JSON - cap like the edge stats do
          profitFactor:   isFinite(m.profitFactor) ? m.profitFactor : 9999,
        };
      } catch (err) {
        return {
          strategyId: id,
          name,
          totalReturnPct: NaN, winRate: NaN, sharpe: NaN,
          maxDrawdownPct: NaN, numTrades: 0, profitFactor: NaN,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    });

    const range = { from: bars[0].time, to: bars[bars.length - 1].time };

    return NextResponse.json({
      symbol,
      range,
      rows: JSON.parse(JSON.stringify(rows, (_, v) => (typeof v === 'number' && !isFinite(v) ? null : v))),
      benchmark: {
        symbol: BENCHMARK_SYMBOL,
        totalReturnPct: benchmarkReturnPct(range.from, range.to),
      },
      durationMs: Date.now() - started,
    });
  } catch (err) {
    console.error('[POST /api/compare]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
