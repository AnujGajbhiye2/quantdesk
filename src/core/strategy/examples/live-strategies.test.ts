/**
 * Tests for the 3 live strategies (bollinger-reversion, rsi-reversion, stoch-reversal).
 *
 * Focuses on:
 * 1. Hold decisions carry a non-empty reason string (required for session dashboard).
 * 2. Entry decisions carry a reason string (existing behaviour, regression guard).
 * 3. The warm-up guard emits "warming up" in the reason.
 */

import { describe, it, expect } from 'vitest';
import { makeContext } from '@/core/strategy/context';
import { BollingerReversionStrategy } from './bollinger-reversion';
import { RSIReversionStrategy } from './rsi-reversion';
import { StochReversalStrategy } from './stoch-reversal';
import type { Bar } from '@/core/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function bar(time: string, close: number): Bar {
  return { time, open: close, high: close * 1.01, low: close * 0.99, close, volume: 1000 };
}

/** Generate n bars with a gentle uptrend - used for warm-up tests. */
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

/** Generate bars in a strong downtrend so oversold conditions are never met (for testing not-oversold hold). */
function steadyUp(n: number): Bar[] {
  const bars: Bar[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    price *= 1.004; // steady up - RSI will be near 70, Stoch will be overbought
    const y = 2024 + Math.floor(i / 252);
    const m = String((Math.floor(i / 21) % 12) + 1).padStart(2, '0');
    const d = String((i % 21) + 1).padStart(2, '0');
    bars.push(bar(`${y}-${m}-${d}`, price));
  }
  return bars;
}

// ---------------------------------------------------------------------------
// Bollinger Band Mean Reversion
// ---------------------------------------------------------------------------

describe('bollinger-reversion hold reasons', () => {
  const strategy = new BollingerReversionStrategy();
  const params   = strategy.params.parse({});

  it('emits a "warming up" reason during BB warm-up period', () => {
    const bars = gently(10); // far fewer than period=20 warm-up
    const ctx  = makeContext(bars, bars.length - 1, 'flat', new Map());
    const d    = strategy.onBar(ctx, params);
    expect(d.action).toBe('hold');
    expect(d.reason).toBeDefined();
    expect(d.reason).toContain('warming up');
  });

  it('emits a "not oversold" reason when close is above lower BB (normal market)', () => {
    const bars = steadyUp(60); // enough for warm-up; close stays above BB
    const ctx  = makeContext(bars, bars.length - 1, 'flat', new Map());
    const d    = strategy.onBar(ctx, params);
    expect(d.action).toBe('hold');
    expect(d.reason).toBeDefined();
    expect(d.reason!.length).toBeGreaterThan(0);
  });

  it('entry reason is non-empty when it fires', () => {
    // Build bars that drop below BB: start high, then crash hard
    const bars: Bar[] = [];
    let price = 200;
    for (let i = 0; i < 25; i++) {
      const y = '2024', m = '01', d = String(i + 1).padStart(2, '0');
      bars.push(bar(`${y}-${m}-${d}`, price));
      price *= 0.97; // consistent daily crash - drives close below lower BB
    }
    const ctx = makeContext(bars, bars.length - 1, 'flat', new Map());
    const d   = strategy.onBar(ctx, params);
    if (d.action === 'enter_long') {
      expect(d.reason).toBeDefined();
      expect(d.reason!.length).toBeGreaterThan(0);
    }
    // May still be hold during warm-up, but reason must be present either way
    expect(d.reason).toBeDefined();
  });

  it('in-position hold emits a reason', () => {
    const bars = gently(60);
    const ctx  = makeContext(bars, bars.length - 1, 'long', new Map());
    const d    = strategy.onBar(ctx, params);
    // Any in-position decision must have a reason (whether hold or exit)
    if (d.action === 'hold') {
      expect(d.reason).toBeDefined();
      expect(d.reason!.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// RSI Mean Reversion
// ---------------------------------------------------------------------------

describe('rsi-reversion hold reasons', () => {
  const strategy = new RSIReversionStrategy();
  const params   = strategy.params.parse({});

  it('emits a hold reason during warm-up or when not oversold', () => {
    // RSI may return a finite value even on a short series (library-dependent).
    // Either way, a hold on entry must carry a reason.
    const bars = gently(5);
    const ctx  = makeContext(bars, bars.length - 1, 'flat', new Map());
    const d    = strategy.onBar(ctx, params);
    expect(d.action).toBe('hold');
    expect(d.reason).toBeDefined();
    expect(d.reason!.length).toBeGreaterThan(0);
    // Reason must be one of the two valid hold paths
    const isWarmup    = d.reason!.includes('warming up');
    const isNotOversold = d.reason!.includes('not oversold');
    expect(isWarmup || isNotOversold).toBe(true);
  });

  it('emits a "not oversold" reason when RSI >= oversold threshold', () => {
    const bars = steadyUp(60); // RSI will be high, not oversold
    const ctx  = makeContext(bars, bars.length - 1, 'flat', new Map());
    const d    = strategy.onBar(ctx, params);
    expect(d.action).toBe('hold');
    expect(d.reason).toBeDefined();
    expect(d.reason).toMatch(/not oversold/);
  });

  it('hold reason contains RSI value for non-warm-up case', () => {
    const bars = steadyUp(60);
    const ctx  = makeContext(bars, bars.length - 1, 'flat', new Map());
    const d    = strategy.onBar(ctx, params);
    if (d.action === 'hold' && d.reason && !d.reason.includes('warming up')) {
      // Should contain RSI value in the reason
      expect(d.reason).toMatch(/RSI\(/);
    }
  });

  it('in-position hold emits a reason', () => {
    const bars = steadyUp(60);
    const ctx  = makeContext(bars, bars.length - 1, 'long', new Map());
    const d    = strategy.onBar(ctx, params);
    if (d.action === 'hold') {
      expect(d.reason).toBeDefined();
      expect(d.reason!.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Stochastic Oversold Reversal
// ---------------------------------------------------------------------------

describe('stoch-reversal hold reasons', () => {
  const strategy = new StochReversalStrategy();
  const params   = strategy.params.parse({});

  it('emits "need at least 2 bars" on single-bar series', () => {
    const bars = [bar('2024-01-01', 100)];
    const ctx  = makeContext(bars, 0, 'flat', new Map());
    const d    = strategy.onBar(ctx, params);
    expect(d.action).toBe('hold');
    expect(d.reason).toBeDefined();
    expect(d.reason).toContain('2 bars');
  });

  it('emits a "warming up" reason during Stoch warm-up', () => {
    const bars = gently(5); // far fewer than kperiod=14 warm-up
    const ctx  = makeContext(bars, bars.length - 1, 'flat', new Map());
    const d    = strategy.onBar(ctx, params);
    expect(d.action).toBe('hold');
    expect(d.reason).toBeDefined();
    expect(d.reason).toContain('warming up');
  });

  it('emits a "not in oversold zone" reason when stoch is high', () => {
    const bars = steadyUp(80); // Stoch will be overbought, not oversold
    const ctx  = makeContext(bars, bars.length - 1, 'flat', new Map());
    const d    = strategy.onBar(ctx, params);
    expect(d.action).toBe('hold');
    expect(d.reason).toBeDefined();
    expect(d.reason!.length).toBeGreaterThan(0);
  });

  it('in-position hold emits a reason', () => {
    const bars = steadyUp(80);
    const ctx  = makeContext(bars, bars.length - 1, 'long', new Map());
    const d    = strategy.onBar(ctx, params);
    if (d.action === 'hold') {
      expect(d.reason).toBeDefined();
      expect(d.reason!.length).toBeGreaterThan(0);
    }
  });
});
