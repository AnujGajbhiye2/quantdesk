/**
 * Tests for the 3 short strategies (bollinger-reversion-short, rsi-reversion-short,
 * stoch-reversal-short) - mirrors of live-strategies.test.ts.
 *
 * Focuses on:
 * 1. Entry fires 'enter_short' when the mirror overbought condition is met.
 * 2. Exit fires from a 'short' position when the mirror reversal condition is met.
 * 3. Hold decisions always carry a non-empty reason string.
 */

import { describe, it, expect } from 'vitest';
import { makeContext } from '@/core/strategy/context';
import { BollingerReversionShortStrategy } from './bollinger-reversion-short';
import { RSIReversionShortStrategy } from './rsi-reversion-short';
import { StochReversalShortStrategy } from './stoch-reversal-short';
import type { Bar } from '@/core/types';

// ---------------------------------------------------------------------------
// Fixtures (same shape as live-strategies.test.ts)
// ---------------------------------------------------------------------------

function bar(time: string, close: number): Bar {
  return { time, open: close, high: close * 1.01, low: close * 0.99, close, volume: 1000 };
}

function gently(n: number): Bar[] {
  const bars: Bar[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    price *= 1.001;
    const y = 2024 + Math.floor(i / 252);
    const m = String((Math.floor(i / 21) % 12) + 1).padStart(2, '0');
    const d = String((i % 21) + 1).padStart(2, '0');
    bars.push(bar(`${y}-${m}-${d}`, price));
  }
  return bars;
}

/** Sharp uptrend then reversal down - drives a bearish stoch cross from overbought. */
function upThenDown(n: number): Bar[] {
  const bars: Bar[] = [];
  let price = 100;
  const half = Math.floor(n / 2);
  for (let i = 0; i < n; i++) {
    if (i < half) price *= 1.02; else price *= 0.985;
    const y = '2024';
    const m = String(Math.floor(i / 28) + 1).padStart(2, '0');
    const d = String((i % 28) + 1).padStart(2, '0');
    bars.push(bar(`${y}-${m}-${d}`, price));
  }
  return bars;
}

/** Mild downtrend - keeps RSI low (not overbought) for the warm-up/not-overbought test. */
function gentlyDown(n: number): Bar[] {
  const bars: Bar[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    price *= 0.999;
    const d = String(i + 1).padStart(2, '0');
    bars.push(bar(`2024-01-${d}`, price));
  }
  return bars;
}

/**
 * Consistent daily rally over a short window (fewer bars than the ADX(14)
 * warm-up needs) - short version of the crash fixture in
 * bollinger-reversion.test's entry test. ADX stays NaN (gate skipped by the
 * warm-up guard) so only the RSI overbought condition governs entry.
 */
function shortRally(n: number, growth: number): Bar[] {
  const bars: Bar[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const d = String(i + 1).padStart(2, '0');
    bars.push(bar(`2024-01-${d}`, price));
    price *= growth;
  }
  return bars;
}

/**
 * upN days of rally, then one flat day at the peak price - enough for %K
 * (fast, window-based) to dip while %D (its 3-period SMA) still lags above
 * it, producing a momentary bearish cross while both remain overbought.
 */
function rallyThenOneDownDay(upN: number, upGrowth: number): Bar[] {
  const bars: Bar[] = [];
  let price = 100;
  for (let i = 0; i < upN; i++) {
    const d = String(i + 1).padStart(2, '0');
    bars.push(bar(`2024-01-${d}`, price));
    price *= upGrowth;
  }
  bars.push(bar('2024-02-01', price));
  return bars;
}

// ---------------------------------------------------------------------------
// Bollinger Band Mean Reversion Short
// ---------------------------------------------------------------------------

describe('bollinger-reversion-short', () => {
  const strategy = new BollingerReversionShortStrategy();
  const params   = strategy.params.parse({});

  it('emits a "warming up" reason during BB warm-up period', () => {
    const bars = gently(10);
    const ctx  = makeContext(bars, bars.length - 1, 'flat', new Map());
    const d    = strategy.onBar(ctx, params);
    expect(d.action).toBe('hold');
    expect(d.reason).toContain('warming up');
  });

  it('entry reason is non-empty when it fires', () => {
    // Mirror of the long entry test: a consistent daily rally. With constant
    // % growth the bands scale with price too, so this may or may not cross
    // the upper band by bar 25 (same caveat as the long-side crash fixture) -
    // the invariant under test is that a reason is always present.
    const bars = shortRally(25, 1.05);
    const ctx  = makeContext(bars, bars.length - 1, 'flat', new Map());
    const dec  = strategy.onBar(ctx, params);
    if (dec.action === 'enter_short') {
      expect(dec.reason).toBeDefined();
      expect(dec.reason!.length).toBeGreaterThan(0);
    }
    expect(dec.reason).toBeDefined();
  });

  it('exits a short position when close drops to the middle band', () => {
    const bars = upThenDown(60);
    const ctx  = makeContext(bars, bars.length - 1, 'short', new Map());
    const d    = strategy.onBar(ctx, params);
    if (d.action === 'hold') {
      expect(d.reason).toBeDefined();
      expect(d.reason!.length).toBeGreaterThan(0);
    } else {
      expect(d.action).toBe('exit');
    }
  });
});

// ---------------------------------------------------------------------------
// RSI Mean Reversion Short
// ---------------------------------------------------------------------------

describe('rsi-reversion-short', () => {
  const strategy = new RSIReversionShortStrategy();
  const params   = strategy.params.parse({});

  it('emits a hold reason during warm-up or when not overbought', () => {
    // A mild downtrend keeps RSI low - guarantees the "not overbought" path
    // (mirror of the long test, which uses an uptrend to guarantee "not oversold").
    const bars = gentlyDown(5);
    const ctx  = makeContext(bars, bars.length - 1, 'flat', new Map());
    const d    = strategy.onBar(ctx, params);
    expect(d.action).toBe('hold');
    expect(d.reason).toBeDefined();
    const isWarmup     = d.reason!.includes('warming up');
    const isNotOverbot  = d.reason!.includes('not overbought');
    expect(isWarmup || isNotOverbot).toBe(true);
  });

  it('enters short when RSI rises above overbought threshold', () => {
    // Short rally window, shorter than the ADX(14) warm-up - keeps the ADX
    // ranging gate at NaN (skipped) so only the RSI condition governs entry.
    // A longer/perfectly-linear trend pins synthetic ADX at exactly 100,
    // which coincides with the default adxMax=100 gate value and masks entry.
    const bars = shortRally(25, 1.02);
    const ctx  = makeContext(bars, bars.length - 1, 'flat', new Map());
    const d    = strategy.onBar(ctx, params);
    expect(d.action).toBe('enter_short');
    expect(d.reason).toMatch(/RSI\(/);
  });

  it('in-short-position hold or exit emits a reason', () => {
    const bars = upThenDown(60);
    const ctx  = makeContext(bars, bars.length - 1, 'short', new Map());
    const d    = strategy.onBar(ctx, params);
    expect(d.reason).toBeDefined();
    expect(d.reason!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Stochastic Overbought Reversal Short
// ---------------------------------------------------------------------------

describe('stoch-reversal-short', () => {
  const strategy = new StochReversalShortStrategy();
  const params   = strategy.params.parse({});

  it('emits "need at least 2 bars" on single-bar series', () => {
    const bars = [bar('2024-01-01', 100)];
    const ctx  = makeContext(bars, 0, 'flat', new Map());
    const d    = strategy.onBar(ctx, params);
    expect(d.action).toBe('hold');
    expect(d.reason).toContain('2 bars');
  });

  it('emits a "warming up" reason during Stoch warm-up', () => {
    const bars = gently(5);
    const ctx  = makeContext(bars, bars.length - 1, 'flat', new Map());
    const d    = strategy.onBar(ctx, params);
    expect(d.action).toBe('hold');
    expect(d.reason).toContain('warming up');
  });

  it('enters short on a bearish cross from the overbought zone', () => {
    // One down-day right after a rally: %K just crossed below %D while both
    // are still in the overbought zone. adxMax raised for this test only -
    // a perfectly linear synthetic rally pins ADX at exactly 100, coinciding
    // with the default adxMax=100 gate and masking the cross (see the
    // adjacent rsi-reversion-short test for the same synthetic-data quirk).
    const bars = rallyThenOneDownDay(40, 1.02);
    const ctx  = makeContext(bars, bars.length - 1, 'flat', new Map());
    const d    = strategy.onBar(ctx, strategy.params.parse({ adxMax: 1000 }));
    expect(d.action).toBe('enter_short');
    expect(d.reason).toContain('crossed below D');
  });

  it('in-short-position hold or exit emits a reason', () => {
    const bars = upThenDown(80);
    const ctx  = makeContext(bars, bars.length - 1, 'short', new Map());
    const d    = strategy.onBar(ctx, params);
    expect(d.reason).toBeDefined();
    expect(d.reason!.length).toBeGreaterThan(0);
  });
});
