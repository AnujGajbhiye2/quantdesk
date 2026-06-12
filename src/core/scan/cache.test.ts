import { describe, it, expect } from 'vitest';
import { ScanCache, type SeriesLoader } from './cache';
import type { Bar, Timeframe } from '@/core/types';

function makeBars(n: number): Bar[] {
  return Array.from({ length: n }, (_, i) => ({
    time:   `2024-01-${String(i + 1).padStart(2, '0')}`,
    open:   100 + i,
    high:   105 + i,
    low:    95  + i,
    close:  102 + i,
    volume: 1_000,
  }));
}

/** Loader over a mutable in-memory store, counting loads. */
function makeLoader(store: Map<string, Bar[]>) {
  let loads = 0;
  const loader: SeriesLoader = {
    getLatestBarTime(symbol: string, timeframe: Timeframe) {
      const bars = store.get(`${symbol}|${timeframe}`);
      return bars && bars.length > 0 ? bars[bars.length - 1].time : null;
    },
    loadBars(symbol: string, timeframe: Timeframe) {
      loads += 1;
      return store.get(`${symbol}|${timeframe}`) ?? [];
    },
  };
  return { loader, getLoads: () => loads };
}

describe('ScanCache', () => {
  it('returns the same entry (bars + indicator Map identity) while lastBarTime is unchanged', () => {
    const store = new Map([['AAPL|1d', makeBars(5)]]);
    const { loader, getLoads } = makeLoader(store);
    const cache = new ScanCache(loader);

    const a = cache.get('AAPL', '1d')!;
    a.indicators.set('rsi::{}', [1, 2, 3]);
    const b = cache.get('AAPL', '1d')!;

    expect(b).toBe(a);
    expect(b.indicators).toBe(a.indicators);
    expect(b.indicators.get('rsi::{}')).toEqual([1, 2, 3]);
    expect(getLoads()).toBe(1);
  });

  it('reloads bars and resets indicators when a new bar arrives', () => {
    const store = new Map([['AAPL|1d', makeBars(5)]]);
    const { loader, getLoads } = makeLoader(store);
    const cache = new ScanCache(loader);

    const a = cache.get('AAPL', '1d')!;
    a.indicators.set('rsi::{}', [1, 2, 3]);

    store.set('AAPL|1d', makeBars(6)); // new bar arrives
    const b = cache.get('AAPL', '1d')!;

    expect(b).not.toBe(a);
    expect(b.bars).toHaveLength(6);
    expect(b.lastBarTime).toBe('2024-01-06');
    expect(b.indicators.size).toBe(0);
    expect(getLoads()).toBe(2);
    expect(cache.size).toBe(1); // stale entry replaced, not accumulated
  });

  it('isolates entries per symbol and timeframe', () => {
    const store = new Map([
      ['AAPL|1d', makeBars(5)],
      ['MSFT|1d', makeBars(3)],
    ]);
    const { loader } = makeLoader(store);
    const cache = new ScanCache(loader);

    const aapl = cache.get('AAPL', '1d')!;
    const msft = cache.get('MSFT', '1d')!;

    expect(aapl.indicators).not.toBe(msft.indicators);
    expect(aapl.bars).toHaveLength(5);
    expect(msft.bars).toHaveLength(3);
    expect(cache.size).toBe(2);
  });

  it('returns null for symbols with no bars', () => {
    const { loader } = makeLoader(new Map());
    const cache = new ScanCache(loader);
    expect(cache.get('NOPE', '1d')).toBeNull();
    expect(cache.size).toBe(0);
  });
});
