import { NextResponse } from 'next/server';
import { getMarketSnapshot } from '@/core/market/snapshot';
import type { Timeframe } from '@/core/types';

/**
 * GET /api/market
 *
 * Query params:
 *   symbols   - comma-separated list (optional; default = all stored)
 *   timeframe - '1d' | '1wk' | ... (optional; default = '1d')
 *
 * Returns:
 *   { rows: MarketRow[] }
 */
export async function GET(request: Request) {
  try {
    const url       = new URL(request.url);
    const symParam  = url.searchParams.get('symbols');
    const tf        = url.searchParams.get('timeframe') as Timeframe | null;

    const symbols = symParam ? symParam.split(',').map((s) => s.trim()).filter(Boolean) : undefined;

    const rows = getMarketSnapshot({
      symbols,
      timeframe: tf ?? '1d',
    });

    return NextResponse.json({ rows });
  } catch (err) {
    console.error('[GET /api/market]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
