/**
 * Tests for the five transcript strategies (docs/transcription/strat-1..5).
 *
 * Each strategy gets a tailored synthetic fixture that walks through its setup.
 * Look-ahead is already probed automatically at register() time - not re-tested.
 */

import { describe, it, expect } from 'vitest';
import { runBacktest } from '@/core/backtest/engine';
import { makeContext } from '@/core/strategy/context';
import { Ema8MomentumBreakoutStrategy } from './ema8-momentum-breakout';
import { CapitulationReversalStrategy } from './capitulation-reversal';
import { Sma44PullbackStrategy } from './sma44-pullback';
import { Ema50FibPullbackStrategy } from './ema50-fib-pullback';
import { SupertrendPivotStrategy } from './supertrend-pivot';
import type { Bar } from '@/core/types';
import type { Strategy, StrategyDecision } from '../Strategy';

// ---------------------------------------------------------------------------
// Fixture builder: open = prior close, so rising bars are green candles and
// falling bars are red - candle color follows the close series naturally.
// Time uses 28-day synthetic months (needed by supertrend-pivot's pivots).
// ---------------------------------------------------------------------------

function build(closes: number[], volumes?: Record<number, number>): Bar[] {
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    return {
      time:   `20${String(24 + Math.floor(i / 250)).padStart(2, '0')}-${String((Math.floor(i / 28) % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
      open,
      high:   Math.max(open, close) * 1.005,
      low:    Math.min(open, close) * 0.995,
      close,
      volume: volumes?.[i] ?? 1_000,
    };
  });
}

/** Steady drift up with periodic multi-bar dips and recoveries. */
function uptrendWithDips(n = 300): number[] {
  const closes: number[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const phase = i % 60;
    if (i > 100 && phase >= 40 && phase < 44) price *= 0.97;      // dip
    else if (i > 100 && phase >= 44 && phase < 50) price *= 1.02; // recovery
    else price *= 1.003;                                          // drift
    closes.push(price);
  }
  return closes;
}

/** Flat, then a 5-bar crash with a volume spike, then a V recovery. */
function capitulationFixture(): { closes: number[]; volumes: Record<number, number> } {
  const closes: number[] = [];
  let price = 100;
  for (let i = 0; i < 40; i++) closes.push(price);
  for (let i = 0; i < 5; i++) { price *= 0.97; closes.push(price); }
  for (let i = 0; i < 15; i++) { price *= 1.05; closes.push(price); }
  return { closes, volumes: { 44: 5_000 } }; // spike on the last crash bar
}

/** Flat base, strong run-up, deep red pullback into the discount zone, green confirmation. */
function fibPullbackFixture(): number[] {
  const closes: number[] = [];
  let price = 100;
  for (let i = 0; i < 60; i++) closes.push(price);
  for (let i = 0; i < 10; i++) { price *= 1.03; closes.push(price); }
  for (let i = 0; i < 4; i++) { price *= 0.96; closes.push(price); }
  for (let i = 0; i < 12; i++) { price *= 1.01; closes.push(price); }
  return closes;
}

/** One flat synthetic month, then a rising month that crosses the pivot R1. */
function pivotCrossFixture(): number[] {
  const closes: number[] = [];
  let price = 100;
  for (let i = 0; i < 28; i++) closes.push(price);
  for (let i = 0; i < 70; i++) { price *= 1.005; closes.push(price); }
  return closes;
}

// ---------------------------------------------------------------------------
// Shared behavioral contract
// ---------------------------------------------------------------------------

const cases: Array<[string, Strategy, Bar[]]> = [
  ['ema8-momentum-breakout', new Ema8MomentumBreakoutStrategy(), build(uptrendWithDips())],
  ['capitulation-reversal',  new CapitulationReversalStrategy(),
    build(capitulationFixture().closes, capitulationFixture().volumes)],
  ['sma44-pullback',         new Sma44PullbackStrategy(),        build(uptrendWithDips())],
  ['ema50-fib-pullback',     new Ema50FibPullbackStrategy(),     build(fibPullbackFixture())],
  ['supertrend-pivot',       new SupertrendPivotStrategy(),      build(pivotCrossFixture())],
];

function findEntry(strategy: Strategy, bars: Bar[]): StrategyDecision {
  const parsed = strategy.params.parse({});
  for (let i = 1; i < bars.length; i++) {
    const ctx = makeContext(bars, i, 'flat', new Map());
    const d = strategy.onBar(ctx, parsed);
    if (d.action === 'enter_long') return d;
    expect(d.action).not.toBe('enter_short');
  }
  throw new Error(`${strategy.id}: no entry decision found on its fixture`);
}

describe.each(cases)('%s', (_id, strategy, bars) => {
  it('enters at least once on its fixture (backtest produces trades)', () => {
    const result = runBacktest({ strategy, bars, rawParams: {}, maxHoldBars: 60 });
    expect(result.trades.length).toBeGreaterThan(0);
    for (const t of result.trades) expect(t.side).toBe('long');
  });

  it('entry decision carries a positive stop and its own hold cap', () => {
    const d = findEntry(strategy, bars);
    expect(d.stopPct).toBeGreaterThan(0);
    expect(d.maxHoldBars).toBeGreaterThan(0);
    expect(d.reason).toBeTruthy();
  });

  it('onBar is pure - same context twice gives the same decision', () => {
    const parsed = strategy.params.parse({});
    const i = bars.length - 1;
    const ctx1 = makeContext(bars, i, 'flat', new Map());
    const ctx2 = makeContext(bars, i, 'flat', new Map());
    expect(strategy.onBar(ctx1, parsed)).toEqual(strategy.onBar(ctx2, parsed));
  });
});

// ---------------------------------------------------------------------------
// Strategy-specific decision shapes
// ---------------------------------------------------------------------------

describe('sma44-pullback specifics', () => {
  it('3R target with half off at 2R', () => {
    const d = findEntry(new Sma44PullbackStrategy(), build(uptrendWithDips()));
    expect(d.targetPct! / d.stopPct!).toBeCloseTo(3, 5);
    expect(d.partialExitFraction).toBe(0.5);
    expect(d.partialExitAtTargetPct).toBeCloseTo(2 / 3, 5);
  });
});

describe('supertrend-pivot specifics', () => {
  it('fixed -5% stop and +10% target', () => {
    const d = findEntry(new SupertrendPivotStrategy(), build(pivotCrossFixture()));
    expect(d.stopPct).toBeCloseTo(0.05, 5);
    expect(d.targetPct).toBeCloseTo(0.10, 5);
  });
});

describe('capitulation-reversal specifics', () => {
  it('no profit target - rides the V with a trailing signal exit', () => {
    const d = findEntry(new CapitulationReversalStrategy(),
      build(capitulationFixture().closes, capitulationFixture().volumes));
    expect(d.targetPct).toBeUndefined();
  });

  it('exits when long and close breaks the prior bar low', () => {
    const strategy = new CapitulationReversalStrategy();
    const parsed = strategy.params.parse({});
    const closes = [100, 100, 100, 90]; // last bar closes below prior bar's low
    const ctx = makeContext(build(closes), 3, 'long', new Map());
    expect(strategy.onBar(ctx, parsed).action).toBe('exit');
  });
});

describe('ema8-momentum-breakout specifics', () => {
  it('exits when long and close drops below the 8 EMA', () => {
    const strategy = new Ema8MomentumBreakoutStrategy();
    const parsed = strategy.params.parse({});
    const closes = [...uptrendWithDips(100).slice(0, 60), 100]; // hard drop below EMA8
    const ctx = makeContext(build(closes), closes.length - 1, 'long', new Map());
    expect(strategy.onBar(ctx, parsed).action).toBe('exit');
  });
});

describe('ema50-fib-pullback specifics', () => {
  it('3R structure from the swing low', () => {
    const d = findEntry(new Ema50FibPullbackStrategy(), build(fibPullbackFixture()));
    expect(d.targetPct! / d.stopPct!).toBeCloseTo(3, 5);
  });
});
