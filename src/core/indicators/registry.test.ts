/**
 * Phase 3 indicator registry tests.
 *
 * Three concerns:
 *  1. Alignment - every output array is bars.length, NaN-padded for warm-up.
 *  2. Fixtures  - spot-checked SMA, RSI, MACD values against hand-verified data.
 *  3. Registry  - listIndicators(), get(), compute() surface.
 *  4. Crosses   - crossover/crossunder + golden/death cross helpers.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { compute, get, listIndicators, register } from './registry';
import { crossover, crossunder, goldenCross, deathCross } from './crosses';
import { padLeft } from './helpers';
import type { Bar } from '@/core/types';

// ---------------------------------------------------------------------------
// Helpers for test fixtures
// ---------------------------------------------------------------------------

/** Build a minimal Bar array from a close-price series (open=close, h/l=close, vol=1). */
function barsFromClose(closes: number[]): Bar[] {
  return closes.map((c, i) => ({
    time: `2024-01-${String(i + 1).padStart(2, '0')}`,
    open: c, high: c, low: c, close: c, volume: 1,
  }));
}

/** Build bars from separate OHLCV arrays (all same length). */
function barsFromOHLCV(
  opens: number[], highs: number[], lows: number[], closes: number[], volumes: number[],
): Bar[] {
  return closes.map((c, i) => ({
    time: `2024-01-${String(i + 1).padStart(2, '0')}`,
    open: opens[i], high: highs[i], low: lows[i], close: c, volume: volumes[i],
  }));
}

/** Count leading NaN values in an array. */
function leadingNaNs(arr: number[]): number {
  let n = 0;
  while (n < arr.length && !isFinite(arr[n])) n++;
  return n;
}

// ---------------------------------------------------------------------------
// padLeft helper unit tests
// ---------------------------------------------------------------------------

describe('padLeft()', () => {
  it('prepends NaN to reach target length', () => {
    const out = padLeft([1, 2, 3], 5);
    expect(out.length).toBe(5);
    expect(isNaN(out[0])).toBe(true);
    expect(isNaN(out[1])).toBe(true);
    expect(out[2]).toBe(1);
    expect(out[3]).toBe(2);
    expect(out[4]).toBe(3);
  });

  it('returns unchanged when out.length === targetLen', () => {
    const arr = [1, 2, 3];
    expect(padLeft(arr, 3)).toEqual(arr);
  });

  it('returns unchanged when out.length > targetLen', () => {
    const arr = [1, 2, 3, 4];
    expect(padLeft(arr, 3)).toEqual(arr);
  });
});

// ---------------------------------------------------------------------------
// SMA fixture
// ---------------------------------------------------------------------------

describe('SMA fixture', () => {
  /**
   * close = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], period = 3
   *
   * Hand-verified expected output after NaN padding:
   *   index: 0    1    2  3  4  5  6  7  8   9
   *   value: NaN  NaN  2  3  4  5  6  7  8   9
   *
   * Each SMA(3) value = average of 3 consecutive closes:
   *   sma[2] = (1+2+3)/3 = 2
   *   sma[3] = (2+3+4)/3 = 3
   *   ...
   *   sma[9] = (8+9+10)/3 = 9
   */
  const closes10 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const bars = barsFromClose(closes10);

  it('output length === bars.length', () => {
    const out = compute('sma', bars, { period: 3 }) as number[];
    expect(out.length).toBe(bars.length);
  });

  it('leading NaN count = period - 1 = 2', () => {
    const out = compute('sma', bars, { period: 3 }) as number[];
    expect(leadingNaNs(out)).toBe(2);
  });

  it('hand-verified spot values', () => {
    const out = compute('sma', bars, { period: 3 }) as number[];
    // sma[2] = (1+2+3)/3 = 2
    expect(out[2]).toBeCloseTo(2, 8);
    // sma[3] = (2+3+4)/3 = 3
    expect(out[3]).toBeCloseTo(3, 8);
    // sma[9] = (8+9+10)/3 = 9
    expect(out[9]).toBeCloseTo(9, 8);
  });

  it('uses default period=20 when no params passed', () => {
    const bigBars = barsFromClose(Array.from({ length: 30 }, (_, i) => i + 1));
    const out = compute('sma', bigBars, {}) as number[];
    expect(out.length).toBe(30);
    // warm-up = 20-1 = 19 NaNs
    expect(leadingNaNs(out)).toBe(19);
  });
});

// ---------------------------------------------------------------------------
// RSI fixture
// ---------------------------------------------------------------------------

describe('RSI fixture', () => {
  /**
   * close = [10,11,12,11,10,11,12,13,12,11,12,13,14,13,12], period = 5
   *
   * Wilder smoothing RSI computation (hand-verified for first value):
   *   Changes over first 5 periods: +1,+1,-1,-1,+1
   *   avg_gain = (1+1+0+0+1)/5 = 0.6
   *   avg_loss = (0+0+1+1+0)/5 = 0.4
   *   RS = 0.6/0.4 = 1.5
   *   RSI[5] = 100 - 100/(1+1.5) = 60.0000 (exactly)
   *
   * Subsequent values confirmed against @ixjb94/indicators output
   * (package is TradingView-validated per its README):
   *   RSI[6]  = 68.0000
   *   RSI[7]  = 74.4000
   *   RSI[14] = 46.8348 (rounded to 4 dp)
   */
  const rsiClose = [10, 11, 12, 11, 10, 11, 12, 13, 12, 11, 12, 13, 14, 13, 12];
  const bars = barsFromClose(rsiClose);

  it('output length === bars.length', () => {
    const out = compute('rsi', bars, { period: 5 }) as number[];
    expect(out.length).toBe(bars.length);
  });

  it('leading NaN count = period', () => {
    const out = compute('rsi', bars, { period: 5 }) as number[];
    expect(leadingNaNs(out)).toBe(5);
  });

  it('all non-NaN values in [0, 100]', () => {
    const out = compute('rsi', bars, { period: 5 }) as number[];
    const finite = out.filter(isFinite);
    expect(finite.length).toBeGreaterThan(0);
    finite.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    });
  });

  it('hand-verified: RSI[5] = 60.0 (first non-NaN)', () => {
    const out = compute('rsi', bars, { period: 5 }) as number[];
    expect(out[5]).toBeCloseTo(60.0, 4);
  });

  it('hand-verified: RSI[6] = 68.0', () => {
    const out = compute('rsi', bars, { period: 5 }) as number[];
    expect(out[6]).toBeCloseTo(68.0, 4);
  });

  it('hand-verified: RSI[7] = 74.4', () => {
    const out = compute('rsi', bars, { period: 5 }) as number[];
    expect(out[7]).toBeCloseTo(74.4, 3);
  });
});

// ---------------------------------------------------------------------------
// MACD fixture
// ---------------------------------------------------------------------------

describe('MACD fixture', () => {
  /**
   * 30-bar close series, params short=3 long=6 signal=4.
   * Expected warm-up = long - 1 = 5 NaN bars (library Tulip-style shortening).
   * Output verified against @ixjb94/indicators output (TradingView-validated):
   *   Tail values (bar index 29):
   *     macd      = 0.777483 (rounded to 6 dp)
   *     signal    = 0.394969
   *     histogram = 0.382514  (= macd - signal to 6 dp)
   */
  const macdClose = [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    9, 8, 7, 6, 5, 6, 7, 8, 9, 10,
    9, 8, 7, 6, 5, 6, 7, 8, 9, 10,
  ];
  const bars = barsFromClose(macdClose);

  it('output has three keys: macd, signal, histogram', () => {
    const out = compute('macd', bars, {}) as Record<string, number[]>;
    expect(Object.keys(out).sort()).toEqual(['histogram', 'macd', 'signal']);
  });

  it('all three sub-arrays are aligned to bars.length', () => {
    const out = compute('macd', bars, {}) as Record<string, number[]>;
    expect(out.macd.length).toBe(bars.length);
    expect(out.signal.length).toBe(bars.length);
    expect(out.histogram.length).toBe(bars.length);
  });

  it('leading NaN count for short=3 long=6 signal=4 = 5 (warm-up = long-1)', () => {
    const out = compute('macd', bars, { short: 3, long: 6, signal: 4 }) as Record<string, number[]>;
    expect(leadingNaNs(out.macd)).toBe(5);
    expect(leadingNaNs(out.signal)).toBe(5);
    expect(leadingNaNs(out.histogram)).toBe(5);
  });

  it('hand-verified tail values (bar 29)', () => {
    const out = compute('macd', bars, { short: 3, long: 6, signal: 4 }) as Record<string, number[]>;
    expect(out.macd[29]).toBeCloseTo(0.777483, 4);
    expect(out.signal[29]).toBeCloseTo(0.394969, 4);
    expect(out.histogram[29]).toBeCloseTo(0.382514, 4);
  });

  it('histogram = macd - signal at every non-NaN bar', () => {
    const out = compute('macd', bars, { short: 3, long: 6, signal: 4 }) as Record<string, number[]>;
    for (let i = 0; i < bars.length; i++) {
      if (!isFinite(out.macd[i])) continue;
      expect(out.histogram[i]).toBeCloseTo(out.macd[i] - out.signal[i], 8);
    }
  });
});

// ---------------------------------------------------------------------------
// Alignment test - all registered indicators
// ---------------------------------------------------------------------------

describe('Alignment - all registered indicators', () => {
  const N = 50;
  // Slightly varied OHLCV so ATR/ADX/stoch don't degenerate
  const opens   = Array.from({ length: N }, (_, i) => 100 + i * 0.5);
  const highs_  = opens.map((v) => v + 1);
  const lows_   = opens.map((v) => v - 1);
  const closes_ = opens.map((v) => v + 0.3);
  const vols    = Array.from({ length: N }, (_, i) => 1000 + i * 10);
  const bars = barsFromOHLCV(opens, highs_, lows_, closes_, vols);

  const SINGLE_OUTPUT_IDS = ['sma', 'ema', 'wma', 'rsi', 'atr', 'stochrsi', 'adx', 'obv', 'vwap', 'roc', 'willr'];
  const MULTI_OUTPUT_IDS  = ['macd', 'bbands', 'stoch'];

  for (const id of SINGLE_OUTPUT_IDS) {
    it(`${id}: output length === bars.length and is number[]`, () => {
      const out = compute(id, bars, {}) as number[];
      expect(Array.isArray(out)).toBe(true);
      expect(out.length).toBe(N);
    });

    it(`${id}: non-NaN values follow the NaN warm-up prefix`, () => {
      const out = compute(id, bars, {}) as number[];
      const firstFinite = out.findIndex(isFinite);
      if (firstFinite === -1) return; // all NaN on this tiny series - skip
      // Every bar after first finite must also be finite
      const tail = out.slice(firstFinite);
      expect(tail.every(isFinite)).toBe(true);
    });
  }

  for (const id of MULTI_OUTPUT_IDS) {
    it(`${id}: all sub-arrays aligned to bars.length`, () => {
      const out = compute(id, bars, {}) as Record<string, number[]>;
      expect(typeof out).toBe('object');
      for (const arr of Object.values(out)) {
        expect(arr.length).toBe(N);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Registry surface
// ---------------------------------------------------------------------------

describe('listIndicators()', () => {
  const REQUIRED_IDS = [
    'sma', 'ema', 'wma', 'rsi', 'macd', 'bbands', 'atr', 'stoch',
    'stochrsi', 'adx', 'obv', 'vwap', 'roc', 'willr',
  ];

  it('returns all 14 required indicator ids', () => {
    const ids = listIndicators().map((e) => e.id);
    for (const id of REQUIRED_IDS) {
      expect(ids).toContain(id);
    }
  });

  it('every entry has a non-empty label', () => {
    for (const { label } of listIndicators()) {
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe('get()', () => {
  it('throws for unregistered id', () => {
    expect(() => get('nonexistent_xyz')).toThrow("Indicator 'nonexistent_xyz' not registered.");
  });

  it('returns the registered def', () => {
    const def = get('sma');
    expect(def.id).toBe('sma');
    expect(typeof def.compute).toBe('function');
  });
});

describe('register()', () => {
  it('adding one new indicator requires only one register() call', () => {
    // Extensibility contract: adding an indicator = one new register() + one file.
    // Verify no changes to existing indicators are needed.
    const before = listIndicators().length;
    register({
      id: '_test_dummy',
      label: 'Dummy for test',
      params: z.object({}),
      compute(_bars, _p) { return []; },
    });
    const after = listIndicators().length;
    expect(after).toBe(before + 1);
    expect(get('_test_dummy').id).toBe('_test_dummy');
  });
});

// ---------------------------------------------------------------------------
// Crossover / crossunder
// ---------------------------------------------------------------------------

describe('crossover()', () => {
  it('fires when a rises above b', () => {
    // a goes from below to above b at index 3
    const a = [1, 2, 3, 5, 6];
    const b = [4, 4, 4, 4, 4];
    const result = crossover(a, b);
    expect(result[0]).toBe(false); // first bar always false
    expect(result[3]).toBe(true);  // a crosses over b here (a[2]=3 <= b[2]=4 AND a[3]=5 > b[3]=4)
    expect(result[4]).toBe(false); // already above, not a crossover
  });

  it('returns false when a stays below b', () => {
    const a = [1, 1, 1, 1];
    const b = [5, 5, 5, 5];
    expect(crossover(a, b).every((v) => !v)).toBe(true);
  });

  it('NaN inputs yield false', () => {
    const a = [NaN, 5, 6];
    const b = [NaN, 4, 4];
    expect(crossover(a, b)[1]).toBe(false); // prev is NaN
  });
});

describe('crossunder()', () => {
  it('fires when a falls below b', () => {
    const a = [6, 5, 4, 2, 1];
    const b = [4, 4, 4, 4, 4];
    const result = crossunder(a, b);
    expect(result[3]).toBe(true);  // a[2]=4 >= b[2]=4 AND a[3]=2 < b[3]=4
    expect(result[4]).toBe(false); // still below, not a new cross
  });
});

// ---------------------------------------------------------------------------
// Golden / death cross
// ---------------------------------------------------------------------------

describe('goldenCross() / deathCross()', () => {
  /**
   * Construct 260-bar series that creates a real golden cross.
   * First 200 bars: close = 100 (flat, SMA50 == SMA200 == 100)
   * Bars 200-259: close ramps from 100 to 160 (+1 per bar).
   * After ~50 bars of ramp, SMA50 overtakes SMA200.
   */
  const closeValues: number[] = [
    ...Array(200).fill(100),
    ...Array.from({ length: 60 }, (_, i) => 100 + (i + 1)),
  ];

  const bars = barsFromClose(closeValues);

  it('goldenCross() output aligned to bars.length', () => {
    const result = goldenCross(bars);
    expect(result.length).toBe(bars.length);
  });

  it('deathCross() output aligned to bars.length', () => {
    const result = deathCross(bars);
    expect(result.length).toBe(bars.length);
  });

  it('goldenCross() fires at least once in the ramp phase', () => {
    const result = goldenCross(bars);
    expect(result.some((v) => v)).toBe(true);
  });

  it('deathCross() does not fire in an upward ramp', () => {
    const result = deathCross(bars);
    expect(result.every((v) => !v)).toBe(true);
  });
});
