import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getWatchlist, addToWatchlist, removeFromWatchlist } from '@/core/db/watchlist';
import { getLatestSignals } from '@/core/db/signals';
import { getAllSymbols } from '@/core/db/bars';
import { requireUser, requireAdmin, AuthError } from '@/core/auth/guard';

export interface WatchlistStatus {
  strategyId: string;
  side:       'long' | 'short' | 'flat';
  time:       string;
}

export interface WatchlistItem {
  symbol:   string;
  pinnedAt: string;
  /** Latest stored signal per strategy; strategies never scanned are absent. */
  statuses: WatchlistStatus[];
}

function buildItems(): WatchlistItem[] {
  const entries = getWatchlist();
  if (entries.length === 0) return [];

  const latest = getLatestSignals(entries.map((e) => e.symbol));
  const bySymbol = new Map<string, WatchlistStatus[]>();
  for (const s of latest) {
    const list = bySymbol.get(s.symbol) ?? [];
    list.push({ strategyId: s.strategyId, side: s.side, time: s.time });
    bySymbol.set(s.symbol, list);
  }

  return entries.map((e) => ({
    symbol:   e.symbol,
    pinnedAt: e.pinnedAt,
    statuses: bySymbol.get(e.symbol) ?? [],
  }));
}

/**
 * GET /api/watchlist - pinned symbols with latest per-strategy signal status.
 * Non-admins get the pinned symbol list (research view) but not the signal
 * statuses - those reveal what the live system is actually picking.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const items = buildItems();
    return NextResponse.json({
      items: user.isAdmin ? items : items.map((i) => ({ ...i, statuses: [] })),
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[GET /api/watchlist]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

const BodySchema = z.object({
  action: z.enum(['add', 'remove']),
  symbol: z.string().min(1).max(20).transform((s) => s.toUpperCase()),
});

/** POST /api/watchlist - add or remove a pinned symbol; returns the fresh list. */
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    }
    const { action, symbol } = parsed.data;

    if (action === 'add') {
      const known = getAllSymbols().some((m) => m.symbol === symbol);
      if (!known) {
        return NextResponse.json(
          { error: `unknown symbol: ${symbol} - ingest it first` },
          { status: 400 },
        );
      }
      addToWatchlist(symbol);
    } else {
      removeFromWatchlist(symbol);
    }

    return NextResponse.json({ items: buildItems() });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[POST /api/watchlist]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
