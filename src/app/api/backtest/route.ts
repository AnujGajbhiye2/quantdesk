import { NextResponse } from 'next/server';
import { getBars } from '@/core/db/bars';
import { get as getStrategy } from '@/core/strategy/registry';
import { runBacktest } from '@/core/backtest/engine';
import type { Timeframe } from '@/core/types';

/**
 * POST /api/backtest
 *
 * Body:
 * {
 *   "strategyId":  "rsi-reversion",
 *   "symbol":      "AAPL",
 *   "timeframe":   "1d",          // optional; default "1d"
 *   "rawParams":   {},            // optional strategy params
 *   "commission":  5,             // optional; $ per fill
 *   "slippagePct": 0.0005,        // optional; fraction (0.0005 = 0.05%)
 *   "fillOn":      "next_open"    // optional; "next_open" | "close"
 * }
 *
 * Returns: BacktestResult
 */
export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      strategyId:   string;
      symbol:       string;
      timeframe?:   string;
      rawParams?:   unknown;
      commission?:  number;
      slippagePct?: number;
      fillOn?:      'next_open' | 'close';
    };

    if (!body.strategyId) {
      return NextResponse.json({ error: 'strategyId required' }, { status: 400 });
    }
    if (!body.symbol) {
      return NextResponse.json({ error: 'symbol required' }, { status: 400 });
    }

    const timeframe = (body.timeframe ?? '1d') as Timeframe;
    const bars      = getBars(body.symbol, timeframe);

    if (bars.length < 2) {
      return NextResponse.json(
        { error: `No bars found for ${body.symbol} / ${timeframe}. Ingest data first.` },
        { status: 422 },
      );
    }

    const strategy = getStrategy(body.strategyId);
    const result   = runBacktest({
      strategy,
      bars,
      symbol:      body.symbol,
      timeframe,
      rawParams:   body.rawParams ?? {},
      commission:  body.commission,
      slippagePct: body.slippagePct,
      fillOn:      body.fillOn,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[POST /api/backtest]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
