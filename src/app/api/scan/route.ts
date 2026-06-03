import { NextResponse } from 'next/server';
import { scan } from '@/core/scan/scanner';

/**
 * POST /api/scan
 *
 * Run a strategy across the watchlist and return matching signals.
 *
 * Body:
 * {
 *   "strategyId": "rsi-reversion",
 *   "symbols":    ["AAPL", "MSFT"],   // optional; default = all stored symbols
 *   "timeframe":  "1d",               // optional; default = "1d"
 *   "rawParams":  {}                  // optional strategy params
 * }
 *
 * Returns:
 * { signals: Signal[], scanned: number, durationMs: number }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      strategyId: string;
      symbols?:   string[];
      timeframe?: string;
      rawParams?: unknown;
    };

    if (!body.strategyId) {
      return NextResponse.json({ error: 'strategyId required' }, { status: 400 });
    }

    const start   = Date.now();
    const signals = scan({
      strategyId: body.strategyId,
      symbols:    body.symbols,
      timeframe:  body.timeframe as import('@/core/types').Timeframe | undefined,
      rawParams:  body.rawParams,
    });

    const scanned = body.symbols?.length
      ?? (await import('@/core/db/bars').then((m) => m.getAllSymbols())).length;

    return NextResponse.json({
      signals,
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
