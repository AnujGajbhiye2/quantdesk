import { NextResponse } from 'next/server';
import { getBars } from '@/core/db/bars';
import type { Timeframe } from '@/core/types';

/**
 * GET /api/bars?symbol=AAPL&timeframe=1d
 *
 * Returns the full OHLCV bar array for the given symbol + timeframe.
 */
export async function GET(request: Request) {
  try {
    const url       = new URL(request.url);
    const symbol    = url.searchParams.get('symbol');
    const timeframe = (url.searchParams.get('timeframe') ?? '1d') as Timeframe;

    if (!symbol) {
      return NextResponse.json({ error: 'symbol required' }, { status: 400 });
    }

    const bars = getBars(symbol, timeframe);
    return NextResponse.json({ bars });
  } catch (err) {
    console.error('[GET /api/bars]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
