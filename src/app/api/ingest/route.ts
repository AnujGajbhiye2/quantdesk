import { NextResponse } from 'next/server';
import { refreshUniverse, ingestUniverse, type UniverseEntry } from '@/core/data/ingest';

/**
 * POST /api/ingest
 *
 * Manual trigger for data refresh. Called by the "Refresh now" button in the UI.
 *
 * Body (optional JSON):
 * {
 *   "mode": "refresh" | "full",   // default: "refresh"
 *   "universe": UniverseEntry[]   // optional; falls back to all stored symbols
 * }
 *
 * Returns:
 * { results: IngestResult[], totalBars: number, errors: number }
 */
export async function POST(request: Request) {
  try {
    let mode: 'refresh' | 'full' = 'refresh';
    let universe: UniverseEntry[] | undefined;

    // Body is optional - treat empty body as a plain refresh
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        const body = await request.json() as { mode?: string; universe?: unknown };
        if (body.mode === 'full') mode = 'full';
        if (Array.isArray(body.universe)) {
          universe = body.universe as UniverseEntry[];
        }
      } catch {
        // ignore malformed body; default to refresh
      }
    }

    const results =
      mode === 'full' && universe
        ? await ingestUniverse(universe)
        : await refreshUniverse(universe);

    const totalBars = results.reduce((sum, r) => sum + r.barsAdded, 0);
    const errors = results.filter((r) => r.error).length;

    return NextResponse.json({ results, totalBars, errors });
  } catch (err) {
    console.error('[POST /api/ingest]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
