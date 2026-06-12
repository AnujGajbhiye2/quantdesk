import { describe, it, expect } from 'vitest';
import { runBacktest } from '@/core/backtest/engine';
import { makeContext } from '@/core/strategy/context';
import { Rsi2PullbackStrategy } from './rsi2-pullback';
import { DownStreakStrategy } from './down-streak';
import { EmaPullbackStrategy } from './ema-pullback';
import type { Bar } from '@/core/types';
import type { Strategy } from '../Strategy';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function bar(i: number, close: number, overrides: Partial<Bar> = {}): Bar {
  const base = {
    time:   `20${String(24 + Math.floor(i / 250)).padStart(2, '0')}-${String((Math.floor(i / 28) % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
    open:   close,
    high:   close * 1.01,
    low:    close * 0.99,
    close,
    volume: 1_000,
  };
  return { ...base, ...overrides };
}

/** Long steady uptrend (drift up), then a sharp multi-bar dip, then recovery. */
function uptrendWithDip(n = 300, dipAt = 250, dipLen = 4): Bar[] {
  const bars: Bar[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    if (i >= dipAt && i < dipAt + dipLen) {
      price *= 0.97; // sharp pullback days
    } else if (i >= dipAt + dipLen && i < dipAt + dipLen + 6) {
      price *= 1.02; // recovery
    } else {
      price *= 1.003; // steady drift up
    }
    bars.push(bar(i, price));
  }
  return bars;
}

/** Steady downtrend - the SMA200 trend filter must block all entries. */
function downtrend(n = 300): Bar[] {
  const bars: Bar[] = [];
  let price = 500;
  for (let i = 0; i < n; i++) {
    price *= 0.997;
    if (i % 40 === 0) price *= 0.96; // periodic sharp drops (oversold spikes)
    bars.push(bar(i, price));
  }
  return bars;
}

function backtest(strategy: Strategy, bars: Bar[]) {
  return runBacktest({ strategy, bars, rawParams: {}, maxHoldBars: 21 });
}

// ---------------------------------------------------------------------------
// Shared behavioral contract for all three swing strategies
// ---------------------------------------------------------------------------

const strategies: Strategy[] = [
  new Rsi2PullbackStrategy(),
  new DownStreakStrategy(),
  new EmaPullbackStrategy(),
];

describe.each(strategies.map((s) => [s.id, s] as const))('%s', (_id, strategy) => {
  it('enters at least once on an uptrend with pullbacks', () => {
    const result = backtest(strategy, uptrendWithDip());
    expect(result.trades.length).toBeGreaterThan(0);
  });

  it('never enters in a downtrend (SMA200 trend filter)', () => {
    const result = backtest(strategy, downtrend());
    expect(result.trades).toHaveLength(0);
  });

  it('all holds bounded by the cap', () => {
    const result = backtest(strategy, uptrendWithDip());
    for (const t of result.trades) {
      expect(t.holdingBars).toBeLessThanOrEqual(21);
    }
  });

  it('onBar is pure - same context twice gives the same decision', () => {
    const bars = uptrendWithDip();
    const parsed = strategy.params.parse({});
    const ctx1 = makeContext(bars, 254, 'flat', new Map());
    const ctx2 = makeContext(bars, 254, 'flat', new Map());
    expect(strategy.onBar(ctx1, parsed)).toEqual(strategy.onBar(ctx2, parsed));
  });

  it('long-only - no short entries', () => {
    const result = backtest(strategy, uptrendWithDip());
    for (const t of result.trades) expect(t.side).toBe('long');
  });
});

// ---------------------------------------------------------------------------
// Strategy-specific behavior
// ---------------------------------------------------------------------------

describe('down-streak specifics', () => {
  it('hold caps at its own 7-bar default even with a looser engine cap', () => {
    const result = runBacktest({
      strategy: new DownStreakStrategy(),
      bars: uptrendWithDip(),
      rawParams: {},
      maxHoldBars: 21,
    });
    for (const t of result.trades) {
      expect(t.holdingBars).toBeLessThanOrEqual(7);
    }
  });
});

describe('rsi2-pullback specifics', () => {
  it('hold caps at its own 10-bar default', () => {
    const result = runBacktest({
      strategy: new Rsi2PullbackStrategy(),
      bars: uptrendWithDip(),
      rawParams: {},
      maxHoldBars: 21,
    });
    for (const t of result.trades) {
      expect(t.holdingBars).toBeLessThanOrEqual(10);
    }
  });
});

describe('ema-pullback specifics', () => {
  it('entries carry both stop and target (2R structure)', () => {
    const strategy = new EmaPullbackStrategy();
    const bars = uptrendWithDip();
    const parsed = strategy.params.parse({});
    // Find an entry decision and check its shape
    for (let i = 220; i < bars.length; i++) {
      const ctx = makeContext(bars, i, 'flat', new Map());
      const d = strategy.onBar(ctx, parsed);
      if (d.action === 'enter_long') {
        expect(d.stopPct).toBeGreaterThan(0);
        expect(d.targetPct).toBeGreaterThan(0);
        expect(d.targetPct! / d.stopPct!).toBeCloseTo(2, 5);
        expect(d.maxHoldBars).toBe(21);
        return;
      }
    }
    throw new Error('no entry decision found on fixture');
  });
});
