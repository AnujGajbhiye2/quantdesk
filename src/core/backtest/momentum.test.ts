import { describe, it, expect } from 'vitest';
import { momentumScore, indexAsOf } from './momentum';
import type { Bar } from '@/core/types';

function makeBars(closes: number[]): Bar[] {
  return closes.map((close, i) => ({
    time:   `2024-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
    open:   close,
    high:   close,
    low:    close,
    close,
    volume: 1_000,
  }));
}

describe('momentumScore', () => {
  it('computes 12-1 return: close[asOf-skip] / close[asOf-lookback] - 1', () => {
    // 300 bars, price ramps 100 -> 399 (close[i] = 100 + i)
    const bars = makeBars(Array.from({ length: 300 }, (_, i) => 100 + i));
    const asOf = 280;
    const lookback = 252;
    const skip = 21;
    const expected = bars[asOf - skip].close / bars[asOf - lookback].close - 1;
    expect(momentumScore(bars, asOf, lookback, skip)).toBeCloseTo(expected, 10);
  });

  it('returns NaN when there is insufficient history for the lookback', () => {
    const bars = makeBars(Array.from({ length: 100 }, (_, i) => 100 + i));
    expect(Number.isNaN(momentumScore(bars, 90, 252, 21))).toBe(true);
  });

  it('returns NaN when asOfIndex is out of range', () => {
    const bars = makeBars([100, 101, 102]);
    expect(Number.isNaN(momentumScore(bars, -1, 1, 0))).toBe(true);
    expect(Number.isNaN(momentumScore(bars, 10, 1, 0))).toBe(true);
  });

  it('returns NaN when skipBars >= lookbackBars', () => {
    const bars = makeBars(Array.from({ length: 300 }, (_, i) => 100 + i));
    expect(Number.isNaN(momentumScore(bars, 280, 21, 21))).toBe(true);
    expect(Number.isNaN(momentumScore(bars, 280, 21, 30))).toBe(true);
  });

  it('returns NaN when a referenced close is non-positive', () => {
    const closes = Array.from({ length: 300 }, (_, i) => 100 + i);
    closes[280 - 252] = 0; // poison the "past" close
    const bars = makeBars(closes);
    expect(Number.isNaN(momentumScore(bars, 280, 252, 21))).toBe(true);
  });

  it('positive score for an uptrend, negative for a downtrend', () => {
    const up   = makeBars(Array.from({ length: 300 }, (_, i) => 100 + i));
    const down = makeBars(Array.from({ length: 300 }, (_, i) => 400 - i));
    expect(momentumScore(up, 280, 252, 21)).toBeGreaterThan(0);
    expect(momentumScore(down, 280, 252, 21)).toBeLessThan(0);
  });
});

describe('indexAsOf', () => {
  const bars = makeBars([100, 101, 102, 103, 104]); // 2024-01-01..05

  it('finds the exact bar when the date matches', () => {
    expect(indexAsOf(bars, '2024-01-03')).toBe(2);
  });

  it('finds the last bar with time <= date when no exact match', () => {
    expect(indexAsOf(bars, '2024-01-03T12:00:00')).toBe(2);
  });

  it('returns -1 when every bar is after the date', () => {
    expect(indexAsOf(bars, '2023-12-31')).toBe(-1);
  });

  it('returns the last index when the date is after all bars', () => {
    expect(indexAsOf(bars, '2099-01-01')).toBe(4);
  });

  it('returns -1 for an empty array', () => {
    expect(indexAsOf([], '2024-01-01')).toBe(-1);
  });
});
