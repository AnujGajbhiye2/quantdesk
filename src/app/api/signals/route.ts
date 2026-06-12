import { NextResponse } from 'next/server';
import { getSignals } from '@/core/db/signals';
import { getBars } from '@/core/db/bars';

/**
 * GET /api/signals?symbol=<sym>&limit=<n>
 *
 * Stored signal history for one symbol, every strategy, oldest first - plus
 * the realized forward return after each signal (+5 and +10 bars,
 * close-to-close). Forward returns are retrospective display only: they answer
 * "did this signal work?" and must never feed signal generation or edge stats.
 */

export interface SignalHistoryItem {
  time:       string;
  side:       'long' | 'short' | 'flat';
  reason:     string;
  strategyId: string;
  /** Close-to-close % move 5 bars after the signal bar; null when too recent. */
  fwd5Pct:  number | null;
  /** Close-to-close % move 10 bars after the signal bar; null when too recent. */
  fwd10Pct: number | null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = (searchParams.get('symbol') ?? '').trim().toUpperCase();
    const limit  = Math.min(Number(searchParams.get('limit') ?? '300'), 1000);

    if (!symbol) {
      return NextResponse.json({ error: 'symbol required' }, { status: 400 });
    }

    const signals = getSignals({ symbol, limit });
    const bars    = getBars(symbol, '1d');

    // Index bar position by date so each signal maps to its bar
    const barIndex = new Map<string, number>();
    bars.forEach((b, i) => barIndex.set(b.time.slice(0, 10), i));

    const fwdPct = (signalDate: string, ahead: number): number | null => {
      const i = barIndex.get(signalDate);
      if (i === undefined) return null;
      const future = bars[i + ahead];
      if (!future || bars[i].close === 0) return null;
      return ((future.close - bars[i].close) / bars[i].close) * 100;
    };

    const items: SignalHistoryItem[] = signals
      .map((s) => {
        const date = s.time.slice(0, 10);
        return {
          time:       date,
          side:       s.side,
          reason:     s.reason,
          strategyId: s.strategyId,
          fwd5Pct:    fwdPct(date, 5),
          fwd10Pct:   fwdPct(date, 10),
        };
      })
      // oldest first for left-to-right timeline rendering
      .reverse();

    return NextResponse.json({ symbol, items });
  } catch (err) {
    console.error('[GET /api/signals]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
