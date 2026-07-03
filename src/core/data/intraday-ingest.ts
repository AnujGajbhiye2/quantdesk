/**
 * Intraday bar ingest for the auto-trade universe.
 *
 * Fetches recent intraday bars (enough for SMA200 warm-up) for every
 * symbol in autoTradeUniverse() and upserts them into the `bars` table.
 * Uses the batch endpoint when the provider supports it (Alpaca does).
 *
 * Idempotent: ON CONFLICT DO UPDATE in upsertBars handles re-runs.
 * Safe to call multiple times per session - no duplicate rows.
 */
import 'server-only';

import type { Timeframe } from '@/core/types';
import { autoTradeUniverse } from './universe';
import { get as getProvider, list as listProviders, defaultProviderId } from './registry';
import { upsertBars, upsertSymbol, getLatestBarTime } from '@/core/db/bars';

export interface IntradayIngestResult {
  symbol:    string;
  barsAdded: number;
  error?:    string;
}

export interface IntradayIngestSummary {
  timeframe:  Timeframe;
  symbols:    number;
  barsAdded:  number;
  errors:     number;
  durationMs: number;
  results:    IntradayIngestResult[];
}

/**
 * Number of calendar days to look back when seeding intraday bars.
 * 15 trading days ~= 21 calendar days. SMA200 needs 200 bars; at 26
 * bars/day (15m in 6.5h session) we need ~8 trading days minimum.
 * We over-fetch (21 days) so warm-up is comfortable.
 */
const LOOKBACK_DAYS = 21;

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Ingest intraday bars for the auto-trade universe.
 *
 * @param timeframe - The intraday timeframe to fetch (default '15m').
 * @param forceAll  - When true, re-fetch the full lookback even when bars exist.
 *                    Default false (incremental: start from last stored bar).
 */
export async function ingestIntraday(
  timeframe: Timeframe = '15m',
  forceAll  = false,
): Promise<IntradayIngestSummary> {
  const t0 = Date.now();
  const universe = autoTradeUniverse();
  const results: IntradayIngestResult[] = [];

  // Group symbols by providerId - only route to registered providers
  const registered = new Set(listProviders());
  const byProvider = new Map<string, typeof universe>();

  for (const entry of universe) {
    const pid = registered.has(entry.providerId) ? entry.providerId : defaultProviderId();
    if (!byProvider.has(pid)) byProvider.set(pid, []);
    byProvider.get(pid)!.push(entry);
  }

  for (const [providerId, entries] of byProvider) {
    const provider = getProvider(providerId);
    const from = daysAgo(LOOKBACK_DAYS);
    const to   = todayUtc();

    // Ensure symbols are registered in DB
    for (const entry of entries) {
      upsertSymbol({
        symbol:         entry.symbol,
        providerSymbol: provider.toProviderSymbol(entry.symbol),
        name:           entry.name,
        assetClass:     entry.assetClass,
        currency:       entry.currency,
        exchange:       entry.exchange,
        providerId:     entry.providerId,
      });
    }

    const symbols = entries.map((e) => e.symbol);

    // Prefer batch fetch when available (Alpaca)
    if (typeof provider.getHistoryBatch === 'function') {
      try {
        const batched = await provider.getHistoryBatch(symbols, timeframe, from, to);
        for (const entry of entries) {
          const bars = batched[entry.symbol] ?? [];
          // Incremental: skip bars already in DB unless forceAll
          const latestStored = forceAll ? null : getLatestBarTime(entry.symbol, timeframe);
          const newBars = latestStored
            ? bars.filter((b) => b.time > latestStored)
            : bars;
          if (newBars.length > 0) upsertBars(entry.symbol, timeframe, newBars);
          results.push({ symbol: entry.symbol, barsAdded: newBars.length });
        }
      } catch (err) {
        // If the batch fails, fall through to per-symbol below
        for (const entry of entries) {
          results.push({ symbol: entry.symbol, barsAdded: 0, error: err instanceof Error ? err.message : String(err) });
        }
      }
    } else {
      // Per-symbol fallback (Yahoo path)
      for (const entry of entries) {
        try {
          const latestStored = forceAll ? null : getLatestBarTime(entry.symbol, timeframe);
          const effectiveFrom = latestStored ? latestStored.slice(0, 10) : from;
          const bars = await provider.getHistory(entry.symbol, timeframe, effectiveFrom, to);
          const newBars = latestStored ? bars.filter((b) => b.time > latestStored) : bars;
          if (newBars.length > 0) upsertBars(entry.symbol, timeframe, newBars);
          results.push({ symbol: entry.symbol, barsAdded: newBars.length });
        } catch (err) {
          results.push({ symbol: entry.symbol, barsAdded: 0, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
  }

  const barsAdded = results.reduce((s, r) => s + r.barsAdded, 0);
  const errors    = results.filter((r) => r.error).length;

  return {
    timeframe,
    symbols:    universe.length,
    barsAdded,
    errors,
    durationMs: Date.now() - t0,
    results,
  };
}
