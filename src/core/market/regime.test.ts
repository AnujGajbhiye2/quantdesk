import { describe, it, expect } from 'vitest';
import { buildRegimeMap, checkRegime, lookupRegime } from './regime';
import type { Bar } from '@/core/types';

function bar(time: string, close: number): Bar {
  return { time, open: close, high: close, low: close, close, volume: 1000 };
}

describe('market-trend regime', () => {
  it('is aligned when close is above the SMA', () => {
    // Flat-then-rising series so the final close clears its own trailing SMA
    const bars: Bar[] = [
      ...Array.from({ length: 5 }, (_, i) => bar(`2024-01-0${i + 1}`, 100)),
      bar('2024-01-06', 110),
    ];
    const map = buildRegimeMap({ kind: 'market-trend', index: '^GSPC', over: 'sma', period: 5 }, bars);
    expect(map.get('2024-01-06')).toBe(true);
  });

  it('is not aligned when close is below the SMA', () => {
    const bars: Bar[] = [
      ...Array.from({ length: 5 }, (_, i) => bar(`2024-01-0${i + 1}`, 100)),
      bar('2024-01-06', 90),
    ];
    const map = buildRegimeMap({ kind: 'market-trend', index: '^GSPC', over: 'sma', period: 5 }, bars);
    expect(map.get('2024-01-06')).toBe(false);
  });

  it('returns neutral (true) during SMA warm-up', () => {
    const bars: Bar[] = [bar('2024-01-01', 100), bar('2024-01-02', 90)];
    const map = buildRegimeMap({ kind: 'market-trend', index: '^GSPC', over: 'sma', period: 200 }, bars);
    expect(map.get('2024-01-02')).toBe(true);
  });
});

describe('volatility regime (raw index level, e.g. a VIX series)', () => {
  it('is aligned when the index level is within [min, max]', () => {
    const bars: Bar[] = [bar('2024-01-01', 18)];
    const map = buildRegimeMap({ kind: 'volatility', index: '^VIX', max: 30 }, bars);
    expect(map.get('2024-01-01')).toBe(true);
  });

  it('is not aligned above max', () => {
    const bars: Bar[] = [bar('2024-01-01', 35)];
    const map = buildRegimeMap({ kind: 'volatility', index: '^VIX', max: 30 }, bars);
    expect(map.get('2024-01-01')).toBe(false);
  });
});

describe('realized-vol regime (free VIX proxy from any index series)', () => {
  it('is aligned (calm) when trailing realized vol is below maxAnnualizedPct', () => {
    // Flat series - zero realized volatility
    const bars: Bar[] = Array.from({ length: 30 }, (_, i) =>
      bar(`2024-01-${String(i + 1).padStart(2, '0')}`, 100),
    );
    const map = buildRegimeMap({ kind: 'realized-vol', index: '^GSPC', period: 21, maxAnnualizedPct: 25 }, bars);
    expect(map.get('2024-01-30')).toBe(true);
  });

  it('is not aligned (crisis) when trailing realized vol exceeds maxAnnualizedPct', () => {
    // Alternating +/-8% daily moves - clearly high annualized vol
    const bars: Bar[] = [];
    let price = 100;
    for (let i = 0; i < 25; i++) {
      price *= i % 2 === 0 ? 1.08 : 1 / 1.08;
      bars.push(bar(`2024-01-${String(i + 1).padStart(2, '0')}`, price));
    }
    const map = buildRegimeMap({ kind: 'realized-vol', index: '^GSPC', period: 21, maxAnnualizedPct: 25 }, bars);
    expect(map.get(bars[bars.length - 1].time)).toBe(false);
  });

  it('respects minAnnualizedPct (block dead-flat, no-opportunity regimes)', () => {
    const bars: Bar[] = Array.from({ length: 30 }, (_, i) =>
      bar(`2024-01-${String(i + 1).padStart(2, '0')}`, 100),
    );
    const map = buildRegimeMap({ kind: 'realized-vol', index: '^GSPC', period: 21, minAnnualizedPct: 5 }, bars);
    expect(map.get('2024-01-30')).toBe(false); // zero realized vol < 5% minimum
  });

  it('returns neutral (true) during the initial warm-up window', () => {
    const bars: Bar[] = [bar('2024-01-01', 100), bar('2024-01-02', 105), bar('2024-01-03', 95)];
    const map = buildRegimeMap({ kind: 'realized-vol', index: '^GSPC', period: 21, maxAnnualizedPct: 10 }, bars);
    // Only 3 bars available against a 21-day window and < 5-bar floor - neutral
    expect(map.get('2024-01-03')).toBe(true);
  });

  it('handles an empty bars array without throwing', () => {
    expect(() => buildRegimeMap({ kind: 'realized-vol', index: '^GSPC', period: 21, maxAnnualizedPct: 25 }, [])).not.toThrow();
  });
});

describe('checkRegime - latest bar only', () => {
  it('evaluates only the final bar in the series', () => {
    const bars: Bar[] = [
      ...Array.from({ length: 5 }, (_, i) => bar(`2024-01-0${i + 1}`, 100)),
      bar('2024-01-06', 110), // final bar above SMA
    ];
    expect(checkRegime({ kind: 'market-trend', index: '^GSPC', over: 'sma', period: 5 }, bars)).toBe(true);
  });

  it('returns neutral (true) for an empty bar array', () => {
    expect(checkRegime({ kind: 'market-trend', index: '^GSPC', over: 'sma', period: 5 }, [])).toBe(true);
  });
});

describe('lookupRegime - date fallback', () => {
  it('finds an exact date match', () => {
    const map = new Map([['2024-01-01', true], ['2024-01-02', false]]);
    expect(lookupRegime(map, '2024-01-02')).toBe(false);
  });

  it('falls back to the nearest prior date when the exact date is missing (e.g. a holiday)', () => {
    const map = new Map([['2024-01-01', true], ['2024-01-03', false]]);
    // 2024-01-02 missing (e.g. index holiday) - falls back to 2024-01-01
    expect(lookupRegime(map, '2024-01-02')).toBe(true);
  });

  it('returns neutral (true) when no prior date exists', () => {
    const map = new Map([['2024-01-05', false]]);
    expect(lookupRegime(map, '2024-01-01')).toBe(true);
  });
});
