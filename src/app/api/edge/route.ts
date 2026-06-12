import { NextResponse } from 'next/server';
import { getEdgeStats } from '@/core/db/edge';
import { computeEdgeForUniverse } from '@/core/edge/compute';

/**
 * GET /api/edge?strategyId=&symbol=&scope=
 * Read stored edge rows. No filters = all rows.
 *
 * POST /api/edge  { "action": "compute", "symbols": ["AAPL"] }
 * Recompute edge stats (full universe if symbols omitted). Heavy - runs
 * full backtests over the trailing 2y window per strategy x symbol.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rows = getEdgeStats({
      strategyId: url.searchParams.get('strategyId') ?? undefined,
      symbol:     url.searchParams.get('symbol') ?? undefined,
      scope:      url.searchParams.get('scope') ?? undefined,
    });
    return NextResponse.json({ rows });
  } catch (err) {
    console.error('[GET /api/edge]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?:  string;
      symbols?: string[];
    };
    if (body.action !== 'compute') {
      return NextResponse.json({ error: 'unknown action' }, { status: 400 });
    }
    const result = computeEdgeForUniverse({ symbols: body.symbols });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[POST /api/edge]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
