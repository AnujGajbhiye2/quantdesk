import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { runBacktest } from './engine';
import type { Strategy, StrategyDecision } from '@/core/strategy/Strategy';
import type { Bar } from '@/core/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBar(i: number, overrides: Partial<Bar> = {}): Bar {
  return {
    time:   `2024-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
    open:   100,
    high:   101,
    low:    99,
    close:  100,
    volume: 1_000,
    ...overrides,
  };
}

function flatBars(n: number): Bar[] {
  return Array.from({ length: n }, (_, i) => makeBar(i));
}

/** Enters long on bar 0 and never exits on its own. */
function enterAndHold(decisionExtras: Partial<StrategyDecision> = {}): Strategy {
  return {
    id: 'hold-forever', name: '', description: '',
    params: z.object({}),
    onBar(ctx) {
      if (ctx.position === 'flat' && ctx.i === 0) {
        return { action: 'enter_long', ...decisionExtras };
      }
      return { action: 'hold' };
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('engine time stop (maxHoldBars)', () => {
  it('without a cap, position runs to end of series', () => {
    const result = runBacktest({ strategy: enterAndHold(), bars: flatBars(30) });
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitReason).toBe('end-of-series');
  });

  it('config cap forces exit with holdingBars == cap and reason time', () => {
    const result = runBacktest({
      strategy: enterAndHold(),
      bars: flatBars(30),
      maxHoldBars: 5,
    });
    expect(result.trades).toHaveLength(1);
    const t = result.trades[0];
    expect(t.exitReason).toBe('time');
    expect(t.holdingBars).toBe(5);
    // Fill at next bar's open, not same-bar close
    expect(t.exitPrice).toBeCloseTo(100 * (1 - 0.0005), 6); // open minus exit slippage
  });

  it('decision maxHoldBars works without a config cap', () => {
    const result = runBacktest({
      strategy: enterAndHold({ maxHoldBars: 3 }),
      bars: flatBars(30),
    });
    expect(result.trades[0].exitReason).toBe('time');
    expect(result.trades[0].holdingBars).toBe(3);
  });

  it('effective cap is min(decision, config)', () => {
    const tighterDecision = runBacktest({
      strategy: enterAndHold({ maxHoldBars: 4 }),
      bars: flatBars(30),
      maxHoldBars: 10,
    });
    expect(tighterDecision.trades[0].holdingBars).toBe(4);

    const tighterConfig = runBacktest({
      strategy: enterAndHold({ maxHoldBars: 10 }),
      bars: flatBars(30),
      maxHoldBars: 4,
    });
    expect(tighterConfig.trades[0].holdingBars).toBe(4);
  });

  it('stop hit on the same bar as the would-be time queue wins (conservative)', () => {
    // Stop 5% below entry; bar at the cap boundary crashes through it
    const bars = flatBars(30).map((b, i) =>
      i === 4 ? { ...b, low: 90, close: 92 } : b,
    );
    const result = runBacktest({
      strategy: enterAndHold({ stopPct: 0.05 }),
      bars,
      maxHoldBars: 5,
    });
    expect(result.trades[0].exitReason).toBe('stop');
    expect(result.trades[0].holdingBars).toBeLessThanOrEqual(5);
  });

  it('strategy exit on the queue bar overrides the time reason', () => {
    const strategy: Strategy = {
      id: 'exit-at-4', name: '', description: '',
      params: z.object({}),
      onBar(ctx) {
        if (ctx.position === 'flat' && ctx.i === 0) return { action: 'enter_long' };
        if (ctx.position === 'long' && ctx.i === 4)  return { action: 'exit', reason: 'planned' };
        return { action: 'hold' };
      },
    };
    const result = runBacktest({ strategy, bars: flatBars(30), maxHoldBars: 5 });
    expect(result.trades[0].exitReason).toBe('signal');
  });

  it('re-entry after a time exit gets a fresh hold window', () => {
    const strategy: Strategy = {
      id: 're-enter', name: '', description: '',
      params: z.object({}),
      onBar(ctx) {
        return ctx.position === 'flat' ? { action: 'enter_long' } : { action: 'hold' };
      },
    };
    const result = runBacktest({ strategy, bars: flatBars(30), maxHoldBars: 5 });
    expect(result.trades.length).toBeGreaterThan(1);
    for (const t of result.trades.filter((t) => t.exitReason === 'time')) {
      expect(t.holdingBars).toBe(5);
    }
  });
});
