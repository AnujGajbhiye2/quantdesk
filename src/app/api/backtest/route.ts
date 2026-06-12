import { NextResponse } from 'next/server';
import { getBars, getAllSymbols } from '@/core/db/bars';
import { get as getStrategy } from '@/core/strategy/registry';
import { runBacktest } from '@/core/backtest/engine';
import { maxHoldBars } from '@/core/config';
import { scanSymbol, dropPartialToday } from '@/core/scan/scanner';
import { recommendTrade } from '@/core/signals/recommend';
import { getEdgeStats } from '@/core/db/edge';
import { GLOBAL_SCOPE } from '@/core/edge/types';
import { medianWinHoldBars, projectExitRange } from '@/core/edge/projection';
import type { TradeIdea, Timeframe } from '@/core/types';

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
 * Returns: BacktestResult plus:
 *   currentIdea - TradeIdea if the strategy signals an entry on the latest bar
 *   projection  - historical-median exit date range for that idea (NOT a
 *                 forecast; source 'symbol' = this symbol's winning trades,
 *                 'universe' = strategy_edge global fallback when < 10)
 */

interface ExitProjectionPayload {
  earliest:       string;
  latest:         string;
  medianHoldBars: number;
  source:         'symbol' | 'universe';
  sampleSize:     number;
}
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
    // Today's still-forming bar is display-only (charts) - it must not feed
    // the engine or the current-signal evaluation below.
    const bars      = dropPartialToday(getBars(body.symbol, timeframe));

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
      maxHoldBars: maxHoldBars(),
    });

    // Current open signal: evaluate the strategy on the latest bar only.
    // Deliberately NOT quality-gated: the backtest page is a research view
    // where the user is explicitly inspecting this strategy on this symbol.
    let currentIdea: TradeIdea | null = null;
    let projection: ExitProjectionPayload | null = null;

    const parsedParams = strategy.params.parse(body.rawParams ?? {});
    const scanRes = scanSymbol(body.symbol, bars, strategy, parsedParams);
    if (scanRes && scanRes.signal.side !== 'flat') {
      currentIdea = recommendTrade(scanRes.signal, bars, scanRes.decision, {});
      if (currentIdea) {
        const meta = getAllSymbols().find((m) => m.symbol === body.symbol);
        currentIdea = { ...currentIdea, currency: meta?.currency ?? 'USD' };

        // Exit projection from winning-trade hold times; this symbol first,
        // universe edge fallback when fewer than 10 winners here
        const winners = result.trades.filter((t) => t.pnl > 0);
        let medianBars: number | null = null;
        let source: ExitProjectionPayload['source'] = 'symbol';
        let sampleSize = winners.length;

        if (winners.length >= 10) {
          medianBars = medianWinHoldBars(result.trades);
        } else {
          const globalEdge = getEdgeStats({
            strategyId: body.strategyId,
            scope:      GLOBAL_SCOPE,
          })[0];
          if (globalEdge && globalEdge.medianWinHoldBars > 0 && globalEdge.numTrades >= 10) {
            medianBars = globalEdge.medianWinHoldBars;
            source     = 'universe';
            sampleSize = globalEdge.numTrades;
          }
        }

        if (medianBars !== null) {
          const range = projectExitRange(scanRes.signal.time, medianBars, timeframe);
          if (range) {
            projection = {
              earliest:       range.earliest,
              latest:         range.latest,
              medianHoldBars: range.medianHoldBars,
              source,
              sampleSize,
            };
          }
        }
      }
    }

    return NextResponse.json({ ...result, currentIdea, projection });
  } catch (err) {
    console.error('[POST /api/backtest]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
