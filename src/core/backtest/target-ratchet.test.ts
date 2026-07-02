/**
 * Imp 6: target ratchet tests.
 *
 * On hitting target, instead of closing, lock the stop at the old target
 * and push a new target out by targetRatchetExtensionR * R (R = original
 * entry-to-stop distance), up to targetRatchetMaxExtensions times.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { runBacktest } from './engine';
import type { Strategy, StrategyDecision } from '../strategy/Strategy';
import type { Bar } from '@/core/types';

function bar(time: string, open: number, high: number, low: number, close: number): Bar {
  return { time, open, high, low, close, volume: 1000 };
}

/** Enters long on bar 0, otherwise holds - lets the stop/target/ratchet logic drive exits. */
function enterOnceStrategy(decision: StrategyDecision): Strategy {
  return {
    id: 'const', name: 'const', description: '',
    params: z.object({}),
    onBar: (ctx) => (ctx.i === 0 ? decision : { action: 'hold' }),
  };
}

describe('target ratchet - long', () => {
  it('closes normally at target when ratchet is not configured (baseline, unchanged behaviour)', () => {
    // entry fill 100, stop 95 (R=5), target 110
    const bars: Bar[] = [
      bar('2024-01-01', 98, 100, 96, 99),   // signal bar
      bar('2024-01-02', 100, 101, 99, 100), // fill entry @ 100
      bar('2024-01-03', 100, 111, 100, 108), // target 110 hit intrabar
      bar('2024-01-04', 108, 109, 107, 108),
    ];
    const result = runBacktest({
      strategy: enterOnceStrategy({ action: 'enter_long', stopPct: 0.05, targetPct: 0.10 }),
      bars,
      commission: 0,
      slippagePct: 0,
    });
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitReason).toBe('target');
    expect(result.trades[0].exitPrice).toBeCloseTo(110, 6);
    expect(result.trades[0].ratchetExtensionsUsed).toBe(0);
  });

  it('ratchets instead of closing on the first target hit, and locks the stop at the old target', () => {
    // entry 100, stop 95 (R=5), target 110. Ratchet: extensionR=1 -> new target = 110 + 5 = 115.
    // Bar 2 hits 110 intrabar but closes below it (109) - trade stays open with target=115, stop=110.
    // Bar 3 pulls back and hits the new stop (110) - closes there, locking in the ratcheted gain.
    const bars: Bar[] = [
      bar('2024-01-01', 98, 100, 96, 99),
      bar('2024-01-02', 100, 101, 99, 100),  // fill entry @ 100
      bar('2024-01-03', 100, 111, 100, 109), // touches 110 intrabar, ratchets (target->115, stop->110)
      bar('2024-01-04', 109, 111, 108, 109), // pulls back through the new stop (110)
    ];
    const result = runBacktest({
      strategy: enterOnceStrategy({ action: 'enter_long', stopPct: 0.05, targetPct: 0.10 }),
      bars,
      commission: 0,
      slippagePct: 0,
      targetRatchetExtensionR: 1,
      targetRatchetMaxExtensions: 3,
    });
    expect(result.trades).toHaveLength(1);
    const t = result.trades[0];
    expect(t.exitReason).toBe('stop'); // exits at the ratcheted stop, not the original target
    expect(t.exitPrice).toBeCloseTo(110, 6);     // locked-in gain from the ratchet, not the original stop (95)
    expect(t.ratchetExtensionsUsed).toBe(1);
  });

  it('stops ratcheting after targetRatchetMaxExtensions and closes at the final target', () => {
    // entry 100, stop 95 (R=5), target 110, extensionR=1, maxExtensions=1.
    // First hit at 110 ratchets once (target -> 115). Second hit at 115 has no
    // extensions left, so it closes normally at 115.
    const bars: Bar[] = [
      bar('2024-01-01', 98, 100, 96, 99),
      bar('2024-01-02', 100, 101, 99, 100),   // fill entry @ 100
      bar('2024-01-03', 100, 111, 109, 110),  // hits 110, ratchets once (target->115, stop->110)
      bar('2024-01-04', 111, 116, 111, 115),  // stays above the new stop (110), hits new target 115
    ];
    const result = runBacktest({
      strategy: enterOnceStrategy({ action: 'enter_long', stopPct: 0.05, targetPct: 0.10 }),
      bars,
      commission: 0,
      slippagePct: 0,
      targetRatchetExtensionR: 1,
      targetRatchetMaxExtensions: 1,
    });
    expect(result.trades).toHaveLength(1);
    const t = result.trades[0];
    expect(t.exitReason).toBe('target');
    expect(t.exitPrice).toBeCloseTo(115, 6);
    expect(t.ratchetExtensionsUsed).toBe(1);
  });

  it('never fires when the trade has no stop (R is undefined)', () => {
    const bars: Bar[] = [
      bar('2024-01-01', 98, 100, 96, 99),
      bar('2024-01-02', 100, 101, 99, 100),
      bar('2024-01-03', 100, 111, 100, 108),
      bar('2024-01-04', 108, 109, 107, 108),
    ];
    const result = runBacktest({
      strategy: enterOnceStrategy({ action: 'enter_long', targetPct: 0.10 }), // no stopPct
      bars,
      commission: 0,
      slippagePct: 0,
      targetRatchetExtensionR: 1,
      targetRatchetMaxExtensions: 3,
    });
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitReason).toBe('target');
    expect(result.trades[0].exitPrice).toBeCloseTo(110, 6);
  });
});

describe('target ratchet - short', () => {
  it('ratchets on the mirror side: locks stop down at the old target, extends target further down', () => {
    // entry 100 (short), stop 105 (R=5), target 90. Ratchet extensionR=1 -> new target = 90 - 5 = 85.
    const bars: Bar[] = [
      bar('2024-01-01', 102, 103, 100, 101),
      bar('2024-01-02', 100, 101, 99,  100),  // fill entry @ 100
      bar('2024-01-03', 100, 100, 89,  91),   // touches 90 intrabar, ratchets (target->85, stop->90)
      bar('2024-01-04', 91,  92,  89,  91),   // rallies back through the new stop (90)
    ];
    const result = runBacktest({
      strategy: enterOnceStrategy({ action: 'enter_short', stopPct: 0.05, targetPct: 0.10 }),
      bars,
      commission: 0,
      slippagePct: 0,
      targetRatchetExtensionR: 1,
      targetRatchetMaxExtensions: 3,
    });
    expect(result.trades).toHaveLength(1);
    const t = result.trades[0];
    expect(t.exitReason).toBe('stop');
    expect(t.exitPrice).toBeCloseTo(90, 6);
    expect(t.ratchetExtensionsUsed).toBe(1);
  });
});
