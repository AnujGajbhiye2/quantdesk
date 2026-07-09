/**
 * Backtest engine tests (Phase 4 mandatory).
 *
 * Covers:
 * - Hand-calculable P&L: deterministic series, known commission, assert to the cent.
 * - Look-ahead trap (read): ctx.bars[ctx.i+1] === undefined.
 * - Look-ahead trap (write): writing to ctx.bars throws TypeError.
 * - Fill timing: entry signal on bar i fills at bar i+1 open (not bar i close).
 * - Worse-outcome: stop AND target both hit same bar -> stop fills first.
 * - Final-bar guard: entry signal on last bar opens no trade.
 * - Metrics: win rate, profit factor, max drawdown on a known two-trade series.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { runBacktest } from './engine';
import type { Strategy, StrategyContext, StrategyDecision } from '../strategy/Strategy';
import type { Bar } from '@/core/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBar(
  i: number,
  overrides: Partial<Bar> = {},
): Bar {
  return {
    time:   `2024-01-${String(i + 1).padStart(2, '0')}`,
    open:   100 + i,
    high:   105 + i,
    low:    95  + i,
    close:  102 + i,
    volume: 1_000,
    ...overrides,
  };
}

function makeBars(n: number, overridesFn?: (i: number) => Partial<Bar>): Bar[] {
  return Array.from({ length: n }, (_, i) =>
    makeBar(i, overridesFn ? overridesFn(i) : {}),
  );
}

/** Minimal Strategy that always returns the same decision. */
function constStrategy(decision: StrategyDecision): Strategy {
  return {
    id: 'const', name: 'const', description: '',
    params: z.object({}),
    onBar: () => decision,
  };
}

/** Strategy that returns specific decisions by bar index. */
function barMapStrategy(
  map: Record<number, StrategyDecision>,
  defaultDecision: StrategyDecision = { action: 'hold' },
): Strategy {
  return {
    id: 'barmap', name: 'barmap', description: '',
    params: z.object({}),
    onBar: (ctx) => map[ctx.i] ?? defaultDecision,
  };
}

// ---------------------------------------------------------------------------
// Test 1: Hand-calculable P&L
//
// Series (6 bars):
//   i=0  open=98   close=100   <- onBar: enter_long
//   i=1  open=100  close=106   <- fill entry at open=100; equity after = 1000-5=995 (commission)
//   i=2  open=106  close=112
//   i=3  open=112  close=115
//   i=4  open=115  close=118   <- onBar: exit
//   i=5  open=120  close=122   <- fill exit at open=120
//
// Config: initialEquity=1000, commission=5, slippagePct=0, fillOn='next_open'
//   qty = 1000 / 100 = 10 (exact - no slippage)
//   pnl = (120 - 100) * 10 - 2*5 = 200 - 10 = 190
//   final equity = 1190
// ---------------------------------------------------------------------------

describe('hand-calculable P&L', () => {
  const bars: Bar[] = [
    { time: '2024-01-01', open: 98,  high: 105, low: 95,  close: 100, volume: 1000 },
    { time: '2024-01-02', open: 100, high: 108, low: 97,  close: 106, volume: 1000 },
    { time: '2024-01-03', open: 106, high: 115, low: 104, close: 112, volume: 1000 },
    { time: '2024-01-04', open: 112, high: 118, low: 108, close: 115, volume: 1000 },
    { time: '2024-01-05', open: 115, high: 120, low: 112, close: 118, volume: 1000 },
    { time: '2024-01-06', open: 120, high: 125, low: 118, close: 122, volume: 1000 },
  ];

  const strategy = barMapStrategy({
    0: { action: 'enter_long' },
    4: { action: 'exit' },
  });

  const result = runBacktest({
    strategy,
    bars,
    symbol: 'TEST',
    rawParams: {},
    initialEquity: 1000,
    commission: 5,
    slippagePct: 0,
  });

  it('produces exactly one trade', () => {
    expect(result.trades).toHaveLength(1);
  });

  it('entry fills at bar 1 open (100)', () => {
    expect(result.trades[0].entryPrice).toBeCloseTo(100, 6);
  });

  it('exit fills at bar 5 open (120)', () => {
    expect(result.trades[0].exitPrice).toBeCloseTo(120, 6);
  });

  it('net P&L = 190 (200 gross - 10 commission)', () => {
    expect(result.trades[0].pnl).toBeCloseTo(190, 6);
  });

  it('final equity = 1190', () => {
    const last = result.equityCurve[result.equityCurve.length - 1];
    expect(last.equity).toBeCloseTo(1190, 5);
  });

  it('pnlPct = 19%', () => {
    // pnl / (entryPrice * qty) * 100 = 190 / 1000 * 100 = 19
    expect(result.trades[0].pnlPct).toBeCloseTo(19, 4);
  });

  it('costs = 10 (2 * commission)', () => {
    expect(result.trades[0].costs).toBeCloseTo(10, 6);
  });

  it('holdingBars = 4 (bars 1 through 5)', () => {
    expect(result.trades[0].holdingBars).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Look-ahead trap - reading future bars returns undefined
// ---------------------------------------------------------------------------

describe('look-ahead trap - read', () => {
  const bars = makeBars(5);
  const futureBarsSeen: unknown[] = [];

  const strategy: Strategy = {
    id: 'lookahead-read', name: '', description: '',
    params: z.object({}),
    onBar(ctx) {
      // Attempt to peek at the next bar - must return undefined
      futureBarsSeen.push(ctx.bars[ctx.i + 1]);
      return { action: 'hold' };
    },
  };

  runBacktest({ strategy, bars, rawParams: {} });

  it('ctx.bars[ctx.i+1] is always undefined', () => {
    expect(futureBarsSeen.length).toBeGreaterThan(0);
    expect(futureBarsSeen.every((v) => v === undefined)).toBe(true);
  });

  it('ctx.bars.length equals i+1 at each bar', () => {
    const lengths: number[] = [];
    const s: Strategy = {
      id: 'len-check', name: '', description: '',
      params: z.object({}),
      onBar(ctx) {
        lengths.push(ctx.bars.length);
        return { action: 'hold' };
      },
    };
    runBacktest({ strategy: s, bars, rawParams: {} });
    expect(lengths).toEqual([1, 2, 3, 4, 5]);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Look-ahead trap - writing to ctx.bars throws TypeError
// ---------------------------------------------------------------------------

describe('look-ahead trap - write', () => {
  it('assigning to ctx.bars throws TypeError (frozen array)', () => {
    const bars = makeBars(3);
    let caught: unknown;

    const strategy: Strategy = {
      id: 'write-trap', name: '', description: '',
      params: z.object({}),
      onBar(ctx) {
        try {
          // Cast to bypass TS readonly - the runtime must still reject it
          (ctx.bars as Bar[])[0] = bars[0];
        } catch (e) {
          caught ??= e; // capture first throw only
        }
        return { action: 'hold' };
      },
    };

    runBacktest({ strategy, bars, rawParams: {} });
    expect(caught).toBeInstanceOf(TypeError);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Fill timing - entry fills at bar i+1 open, not bar i close
// ---------------------------------------------------------------------------

describe('fill timing', () => {
  it('entry signal on bar 0 fills at bar 1 open (not bar 0 close)', () => {
    const bars: Bar[] = [
      { time: '2024-01-01', open: 100, high: 110, low: 90,  close: 105, volume: 1000 },
      { time: '2024-01-02', open: 108, high: 115, low: 105, close: 112, volume: 1000 },
      { time: '2024-01-03', open: 112, high: 120, low: 108, close: 115, volume: 1000 },
    ];

    // bar 0 close = 105, bar 1 open = 108
    const strategy = barMapStrategy({ 0: { action: 'enter_long' } });
    const result = runBacktest({ strategy, bars, rawParams: {}, slippagePct: 0 });

    // Entry must be at bar 1 open (108), not bar 0 close (105)
    expect(result.trades[0]?.entryPrice ?? result.trades).toBeCloseTo(108, 6);
  });

  it('exit signal on bar i fills at bar i+1 open', () => {
    const bars: Bar[] = [
      { time: '2024-01-01', open: 100, high: 105, low: 95,  close: 100, volume: 1000 },
      { time: '2024-01-02', open: 100, high: 108, low: 98,  close: 106, volume: 1000 },
      { time: '2024-01-03', open: 103, high: 110, low: 100, close: 108, volume: 1000 }, // exit fill here
      { time: '2024-01-04', open: 110, high: 115, low: 108, close: 112, volume: 1000 },
    ];
    // bar 2 close = 108, bar 3 open = 110
    const strategy = barMapStrategy({
      0: { action: 'enter_long' },
      2: { action: 'exit' },
    });
    const result = runBacktest({ strategy, bars, rawParams: {}, slippagePct: 0 });

    expect(result.trades[0]?.exitPrice).toBeCloseTo(110, 6);
  });
});

// ---------------------------------------------------------------------------
// Test 5: Worse-outcome intrabar - stop AND target both hit -> stop fills first
// ---------------------------------------------------------------------------

describe('worse-outcome intrabar stop vs target', () => {
  it('when both stop and target hit in one bar, stop fills first (worse for long)', () => {
    // Bar 0: enter_long with stop=5%, target=3%
    //   entryFillPrice at bar 1 open = 100 (slippage=0)
    //   stopPrice  = 100 * (1 - 0.05) = 95
    //   targetPrice = 100 * (1 + 0.03) = 103
    //
    // Bar 1: open=100, high=106 (>= 103 = target hit), low=94 (<= 95 = stop hit)
    //   Both hit -> stop fills at 95 (worst outcome)
    //   pnl = (95 - 100) * 10 - 0 = -50

    const bars: Bar[] = [
      { time: '2024-01-01', open: 100, high: 105, low: 95,  close: 100, volume: 1000 },
      { time: '2024-01-02', open: 100, high: 106, low: 94,  close: 100, volume: 1000 },
    ];

    const strategy = barMapStrategy({
      0: { action: 'enter_long', stopPct: 0.05, targetPct: 0.03 },
    });

    const result = runBacktest({
      strategy,
      bars,
      rawParams:     {},
      initialEquity: 1000,
      commission:    0,
      slippagePct:   0,
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitReason).toBe('stop');
    expect(result.trades[0].exitPrice).toBeCloseTo(95, 6);
    expect(result.trades[0].pnl).toBeCloseTo(-50, 4);
  });

  it('target fills when only target is hit (no stop)', () => {
    const bars: Bar[] = [
      { time: '2024-01-01', open: 100, high: 105, low: 95,  close: 100, volume: 1000 },
      { time: '2024-01-02', open: 100, high: 106, low: 98,  close: 102, volume: 1000 },
    ];

    const strategy = barMapStrategy({
      0: { action: 'enter_long', targetPct: 0.03 },
    });

    const result = runBacktest({
      strategy,
      bars,
      rawParams:     {},
      initialEquity: 1000,
      commission:    0,
      slippagePct:   0,
    });

    expect(result.trades[0].exitReason).toBe('target');
    expect(result.trades[0].exitPrice).toBeCloseTo(103, 6);
    expect(result.trades[0].pnl).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Test 6: Final-bar guard - entry signal on last bar opens no trade
// ---------------------------------------------------------------------------

describe('final-bar guard', () => {
  it('entry signal on bar n-1 opens no trade', () => {
    const bars = makeBars(4);
    // Signal enter_long on every bar including the last
    const strategy = constStrategy({ action: 'enter_long' });

    const result = runBacktest({ strategy, bars, rawParams: {} });

    // The entry signal on bar 0 fills at bar 1. But there is only one entry signal
    // queued at bar 0. Subsequent bars are 'enter_long' while position is long,
    // so they're ignored. The open position is closed at end-of-series.
    // Key: entry on bar 3 (last bar) -> NO fill queued.
    expect(result.trades[0]?.exitReason).toBe('end-of-series');
  });

  it('with a hold-then-enter-last strategy, no trade is opened', () => {
    const bars = makeBars(3);
    // Only signal on the last bar
    const strategy = barMapStrategy({ 2: { action: 'enter_long' } });

    const result = runBacktest({ strategy, bars, rawParams: {} });
    expect(result.trades).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 7: Metrics on a two-trade series
//
// Trade 1: enter 100, exit 110 -> pnl = +10 * qty (win)
// Trade 2: enter 100, exit  90 -> pnl = -10 * qty (loss)
// winRate = 0.5, profitFactor = 1 (symmetric), maxDrawdown > 0
// ---------------------------------------------------------------------------

describe('metrics', () => {
  // Build a 6-bar series for two trades with slippage=0, commission=0
  // Bar 0: signal enter (fill at bar 1 open=100)
  // Bar 1: fill entry at 100
  // Bar 2: signal exit (fill at bar 3 open=110) -> pnl = +10*qty
  // Bar 3: fill exit at 110; signal enter (fill at bar 4 open=100)
  // Bar 4: fill entry at 100
  // Bar 5 (last): end-of-series exit at close=90 -> pnl = -10*qty
  const bars: Bar[] = [
    { time: '2024-01-01', open: 98,  high: 105, low: 95,  close: 100, volume: 1000 }, // bar 0
    { time: '2024-01-02', open: 100, high: 108, low: 97,  close: 106, volume: 1000 }, // bar 1: entry fill 100
    { time: '2024-01-03', open: 108, high: 115, low: 106, close: 112, volume: 1000 }, // bar 2
    { time: '2024-01-04', open: 110, high: 118, low: 108, close: 108, volume: 1000 }, // bar 3: exit fill 110, re-enter
    { time: '2024-01-05', open: 100, high: 106, low: 97,  close: 103, volume: 1000 }, // bar 4: 2nd entry fill 100
    { time: '2024-01-06', open: 96,  high: 100, low: 88,  close: 90,  volume: 1000 }, // bar 5 (last): forced close at 90
  ];

  const strategy = barMapStrategy({
    0: { action: 'enter_long' },
    2: { action: 'exit' },
    3: { action: 'enter_long' },
  });

  const result = runBacktest({
    strategy,
    bars,
    rawParams:     {},
    initialEquity: 1000,
    commission:    0,
    slippagePct:   0,
  });

  it('produces 2 trades', () => {
    expect(result.trades).toHaveLength(2);
  });

  it('first trade is a win (exit at 110 > entry 100)', () => {
    expect(result.trades[0].pnl).toBeGreaterThan(0);
    expect(result.trades[0].exitPrice).toBeCloseTo(110, 6);
  });

  it('second trade is a loss (end-of-series at 90 < entry 100)', () => {
    expect(result.trades[1].pnl).toBeLessThan(0);
    expect(result.trades[1].exitReason).toBe('end-of-series');
  });

  it('winRate = 0.5', () => {
    expect(result.metrics.winRate).toBeCloseTo(0.5, 6);
  });

  it('numTrades = 2', () => {
    expect(result.metrics.numTrades).toBe(2);
  });

  it('maxDrawdownPct > 0 (equity declined on the losing trade)', () => {
    expect(result.metrics.maxDrawdownPct).toBeGreaterThan(0);
  });

  it('profitFactor > 0 (has both wins and losses)', () => {
    expect(result.metrics.profitFactor).toBeGreaterThan(0);
    expect(result.metrics.profitFactor).not.toBe(Infinity);
  });
});

// ---------------------------------------------------------------------------
// Test 8: Slippage applied adversely
// ---------------------------------------------------------------------------

describe('slippage', () => {
  it('long entry fill = open * (1 + slippagePct)', () => {
    const bars: Bar[] = [
      { time: '2024-01-01', open: 100, high: 105, low: 95,  close: 100, volume: 1000 },
      { time: '2024-01-02', open: 200, high: 208, low: 198, close: 204, volume: 1000 }, // entry fill here
    ];
    const result = runBacktest({
      strategy:    barMapStrategy({ 0: { action: 'enter_long' } }),
      bars,
      rawParams:   {},
      slippagePct: 0.01,
    });
    // entry fill = 200 * 1.01 = 202
    expect(result.trades[0]?.entryPrice ?? 0).toBeCloseTo(202, 4);
  });
});

// ---------------------------------------------------------------------------
// Test 9: Short position P&L
// ---------------------------------------------------------------------------

describe('short positions', () => {
  it('short trade: profit when price falls', () => {
    const bars: Bar[] = [
      { time: '2024-01-01', open: 100, high: 105, low: 95,  close: 100, volume: 1000 }, // enter_short
      { time: '2024-01-02', open: 100, high: 105, low: 95,  close: 100, volume: 1000 }, // fill at 100
      { time: '2024-01-03', open: 80,  high: 85,  low: 75,  close: 80,  volume: 1000 }, // exit fill at 80
      { time: '2024-01-04', open: 80,  high: 85,  low: 75,  close: 80,  volume: 1000 },
    ];

    const strategy = barMapStrategy({
      0: { action: 'enter_short' },
      1: { action: 'exit' },
    });

    const result = runBacktest({
      strategy,
      bars,
      rawParams:   {},
      slippagePct: 0,
      commission:  0,
    });

    expect(result.trades[0].side).toBe('short');
    expect(result.trades[0].pnl).toBeGreaterThan(0);
    // entryFillPrice = 100, exitFillPrice = 80 (bar 2 open)
    // qty = initialEquity / 100; pnl = (100-80) * qty
    expect(result.trades[0].exitPrice).toBeCloseTo(80, 6);
  });
});

// ---------------------------------------------------------------------------
// Regulatory cost model (SEC/TAF on sells) - opt-in via config.costModel
// ---------------------------------------------------------------------------

describe('costModel fees', () => {
  const bars: Bar[] = [
    { time: '2024-01-01', open: 98,  high: 105, low: 95,  close: 100, volume: 1000 },
    { time: '2024-01-02', open: 100, high: 108, low: 97,  close: 106, volume: 1000 },
    { time: '2024-01-03', open: 106, high: 115, low: 104, close: 112, volume: 1000 },
    { time: '2024-01-04', open: 112, high: 118, low: 108, close: 115, volume: 1000 },
    { time: '2024-01-05', open: 115, high: 120, low: 112, close: 118, volume: 1000 },
    { time: '2024-01-06', open: 120, high: 125, low: 118, close: 122, volume: 1000 },
  ];

  const strategy = barMapStrategy({
    0: { action: 'enter_long' },
    4: { action: 'exit' },
  });

  const costModel = {
    commissionPerFill: 0,
    secFeeRate: 0.0000278,
    tafPerShare: 0.000166,
    tafCap: 8.3,
  };

  it('long trade pnl is reduced by exactly the sell-leg fees', () => {
    const base = runBacktest({
      strategy, bars, rawParams: {}, initialEquity: 1000, commission: 0, slippagePct: 0,
    });
    const withFees = runBacktest({
      strategy, bars, rawParams: {}, initialEquity: 1000, commission: 0, slippagePct: 0,
      costModel,
    });
    // qty = 10, sell at 120: SEC = 10*120*0.0000278 = 0.03336;
    // TAF = 10*0.000166 = 0.00166 -> total 0.03502
    const expectedFees = 10 * 120 * costModel.secFeeRate + 10 * costModel.tafPerShare;
    expect(withFees.trades[0].pnl).toBeCloseTo(base.trades[0].pnl - expectedFees, 6);
    expect(withFees.trades[0].costs).toBeCloseTo(expectedFees, 6);
  });

  it('omitting costModel keeps existing behavior', () => {
    const a = runBacktest({ strategy, bars, rawParams: {}, initialEquity: 1000, commission: 5, slippagePct: 0 });
    expect(a.trades[0].pnl).toBeCloseTo(190, 6);
    expect(a.trades[0].costs).toBeCloseTo(10, 6);
  });
});
