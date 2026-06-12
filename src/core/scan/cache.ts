import type { Bar, Timeframe } from '@/core/types';
import type { IndicatorCache } from '@/core/strategy/context';

/**
 * Scan-path series cache.
 *
 * Entries are keyed (symbol, timeframe) and validated against lastBarTime:
 * a cheap MAX(time) probe decides freshness, so bars and indicator outputs
 * are only reloaded/recomputed when new bars arrive. Replacing a stale entry
 * evicts it, so memory stays bounded at one entry per symbol + timeframe.
 *
 * The IndicatorCache inside each entry is shared across ALL strategies that
 * scan the symbol - sma/atr/rsi etc. are computed once per symbol per bar
 * update, not once per strategy.
 *
 * Loader is injected so the cache core stays pure and testable without a DB.
 */

export interface CachedSeries {
  bars:        Bar[];
  lastBarTime: string;
  indicators:  IndicatorCache;
}

export interface SeriesLoader {
  getLatestBarTime(symbol: string, timeframe: Timeframe): string | null;
  loadBars(symbol: string, timeframe: Timeframe): Bar[];
}

export class ScanCache {
  private entries = new Map<string, CachedSeries>();

  constructor(private readonly loader: SeriesLoader) {}

  /** Return fresh cached series for the symbol, or null if no bars exist. */
  get(symbol: string, timeframe: Timeframe): CachedSeries | null {
    const lastBarTime = this.loader.getLatestBarTime(symbol, timeframe);
    if (!lastBarTime) return null;

    const key = `${symbol}|${timeframe}`;
    const hit = this.entries.get(key);
    if (hit && hit.lastBarTime === lastBarTime) return hit;

    const bars = this.loader.loadBars(symbol, timeframe);
    if (bars.length === 0) return null;

    const entry: CachedSeries = { bars, lastBarTime, indicators: new Map() };
    this.entries.set(key, entry);
    return entry;
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
