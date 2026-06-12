import { NextResponse } from 'next/server';
import { list as listProviders, get as getProvider } from '@/core/data/registry';
import { getAllSymbols } from '@/core/db/bars';
import type { SymbolMeta } from '@/core/types';

/**
 * GET /api/search?q=<query>&limit=<n>
 *
 * Two-tier symbol search:
 * 1. Local DB symbols first - instant, and the symbols the user can actually
 *    backtest right now without ingesting.
 * 2. Provider search (Yahoo etc.) for symbols not yet ingested, with a hard
 *    timeout so a slow provider can never stall the typeahead.
 *
 * Results are deduped by symbol, local first. Each result carries
 * inDb: boolean so the UI can distinguish ready vs needs-ingest.
 */

const PROVIDER_TIMEOUT_MS = 1500;

type SearchResult = SymbolMeta & { inDb: boolean };

function searchLocal(q: string, limit: number): SearchResult[] {
  const needle = q.toUpperCase();
  const all = getAllSymbols();

  // Rank: symbol prefix match first, then symbol substring, then name substring
  const prefix:    SearchResult[] = [];
  const substring: SearchResult[] = [];
  const byName:    SearchResult[] = [];

  for (const m of all) {
    const sym  = m.symbol.toUpperCase();
    const name = m.name.toUpperCase();
    if (sym.startsWith(needle))       prefix.push({ ...m, inDb: true });
    else if (sym.includes(needle))    substring.push({ ...m, inDb: true });
    else if (name.includes(needle))   byName.push({ ...m, inDb: true });
  }

  return [...prefix, ...substring, ...byName].slice(0, limit);
}

async function searchProviders(q: string, limit: number): Promise<SymbolMeta[]> {
  const ids = listProviders();
  for (const id of ids) {
    const provider = getProvider(id);
    if (typeof provider.search !== 'function') continue;
    try {
      const timeout = new Promise<SymbolMeta[]>((resolve) =>
        setTimeout(() => resolve([]), PROVIDER_TIMEOUT_MS),
      );
      const raw = await Promise.race([provider.search(q), timeout]);
      if (raw.length > 0) return raw.slice(0, limit);
    } catch {
      // try next provider
    }
  }
  return [];
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q     = (searchParams.get('q') ?? '').trim();
    const limit = Math.min(Number(searchParams.get('limit') ?? '12'), 30);

    if (q.length < 1) {
      return NextResponse.json({ results: [] });
    }

    const local = searchLocal(q, limit);

    // Local hits filled the budget - skip the slow provider round-trip
    if (local.length >= limit) {
      return NextResponse.json({ results: local });
    }

    const remote = await searchProviders(q, limit);
    const seen   = new Set(local.map((r) => r.symbol));
    const merged: SearchResult[] = [...local];
    for (const r of remote) {
      if (seen.has(r.symbol)) continue;
      seen.add(r.symbol);
      merged.push({ ...r, inDb: false });
      if (merged.length >= limit) break;
    }

    return NextResponse.json({ results: merged });
  } catch (err) {
    console.error('[GET /api/search]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
