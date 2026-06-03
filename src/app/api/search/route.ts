import { NextResponse } from 'next/server';
import { list as listProviders, get as getProvider } from '@/core/data/registry';
import type { SymbolMeta } from '@/core/types';

/**
 * GET /api/search?q=<query>&limit=<n>
 *
 * Searches the first registered provider that supports search().
 * Falls back to an empty array if no provider supports search or the query is blank.
 * Used by the GoToSymbolOverlay typeahead to find symbols not yet in the local DB.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q     = (searchParams.get('q') ?? '').trim();
    const limit = Math.min(Number(searchParams.get('limit') ?? '12'), 30);

    if (q.length < 1) {
      return NextResponse.json({ results: [] });
    }

    // Try providers in registry order; use the first one that supports search().
    const ids      = listProviders();
    let   results: SymbolMeta[] = [];

    for (const id of ids) {
      const provider = getProvider(id);
      if (typeof provider.search !== 'function') continue;
      try {
        const raw = await provider.search(q);
        results   = raw.slice(0, limit);
        break;
      } catch {
        // try next provider
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    console.error('[GET /api/search]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
