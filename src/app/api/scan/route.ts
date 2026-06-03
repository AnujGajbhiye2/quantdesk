import { NextResponse } from 'next/server';
import { scan } from '@/core/scan/scanner';
import { recommendTrade } from '@/core/signals/recommend';
import type { TradeIdea } from '@/core/types';

/**
 * POST /api/scan
 *
 * Run a strategy across the watchlist and return matching signals + trade ideas.
 *
 * Body:
 * {
 *   "strategyId": "rsi-reversion",
 *   "symbols":    ["AAPL", "MSFT"],   // optional; default = all stored symbols
 *   "timeframe":  "1d",               // optional; default = "1d"
 *   "rawParams":  {}                  // optional strategy params
 *   "equity":     10000,              // optional; for risk-based sizing
 *   "riskPct":    0.01,               // optional; fraction of equity to risk per trade
 * }
 *
 * Returns:
 * { signals: Signal[], ideas: TradeIdea[], scanned: number, durationMs: number }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      strategyId: string;
      symbols?:   string[];
      timeframe?: string;
      rawParams?: unknown;
      equity?:    number;
      riskPct?:   number;
    };

    if (!body.strategyId) {
      return NextResponse.json({ error: 'strategyId required' }, { status: 400 });
    }

    const start  = Date.now();
    const result = scan({
      strategyId: body.strategyId,
      symbols:    body.symbols,
      timeframe:  body.timeframe as import('@/core/types').Timeframe | undefined,
      rawParams:  body.rawParams,
    });

    // Build trade ideas for non-exit signals (enter_long / enter_short only)
    const ideas: TradeIdea[] = [];
    for (const raw of result.rawResults) {
      if (raw.signal.side === 'flat') continue; // exit signal - no idea
      const idea = recommendTrade(
        raw.signal,
        raw.bars,
        raw.decision,
        { equity: body.equity, riskPct: body.riskPct },
      );
      if (idea) ideas.push(idea);
    }

    const scanned = body.symbols?.length
      ?? (await import('@/core/db/bars').then((m) => m.getAllSymbols())).length;

    return NextResponse.json({
      signals:    result.signals,
      ideas,
      scanned,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    console.error('[POST /api/scan]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
