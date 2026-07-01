import { describe, it, expect } from 'vitest';
import { recommendTrade } from './recommend';
import type { Bar, Signal } from '@/core/types';

function makeBars(n: number): Bar[] {
  return Array.from({ length: n }, (_, i) => ({
    time:   `2024-01-${String((i % 28) + 1).padStart(2, '0')}`,
    open:   100,
    high:   102,
    low:    98,
    close:  100,
    volume: 1_000,
  }));
}

const signal: Signal = {
  symbol:     'TEST',
  time:       '2024-02-01',
  side:       'long',
  strategyId: 'rsi-reversion',
  reason:     'test fixture',
};

describe('recommendTrade riskPct pass-through', () => {
  it('sizes qty proportionally to the riskPct passed in cfg (explicit stopPct)', () => {
    // Wide stop (20%) keeps qty well under the 25%-of-equity concentration
    // cap at both risk levels, so the 1.5x scaling isn't clipped.
    const bars = makeBars(30);
    const idea1pct  = recommendTrade(signal, bars, { stopPct: 0.20, targetPct: 0.30 }, { equity: 10_000, riskPct: 0.01 });
    const idea15pct = recommendTrade(signal, bars, { stopPct: 0.20, targetPct: 0.30 }, { equity: 10_000, riskPct: 0.015 });

    expect(idea1pct).not.toBeNull();
    expect(idea15pct).not.toBeNull();
    // 1.5% risk should size to 1.5x the qty and risk amount of 1% risk,
    // all else (entry/stop/target/R:R) held equal.
    expect(idea15pct!.qty).toBeCloseTo(idea1pct!.qty * 1.5, 6);
    expect(idea15pct!.riskAmount).toBeCloseTo(idea1pct!.riskAmount * 1.5, 6);
    expect(idea15pct!.rr).toBeCloseTo(idea1pct!.rr, 6);
  });

  it('falls back to the 1% default when riskPct is omitted', () => {
    const bars = makeBars(30);
    const ideaDefault = recommendTrade(signal, bars, { stopPct: 0.05, targetPct: 0.075 }, { equity: 10_000 });
    const ideaExplicit1pct = recommendTrade(signal, bars, { stopPct: 0.05, targetPct: 0.075 }, { equity: 10_000, riskPct: 0.01 });
    expect(ideaDefault!.qty).toBeCloseTo(ideaExplicit1pct!.qty, 6);
  });
});
