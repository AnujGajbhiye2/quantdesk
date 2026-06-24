import { describe, it, expect } from 'vitest';
import { riskBasedQty } from './sizing';
import { recommendTrade } from '@/core/signals/recommend';
import type { Signal, Bar } from '@/core/types';

describe('riskBasedQty', () => {
  it('computes qty correctly', () => {
    // equity=10000, risk 1%, entry=100, stop=97 (3pt stop) => qty = 100/3 = 33.33
    const r = riskBasedQty({ equity: 10_000, riskPct: 0.01, entryPrice: 100, stopPrice: 97 });
    expect(r.qty).toBeCloseTo(100 / 3, 5);
    expect(r.riskAmount).toBeCloseTo(100, 5);
    expect(r.stopDistance).toBeCloseTo(3, 5);
  });

  it('works for short positions (stop above entry)', () => {
    // short: entry=50, stop=52 (2pt stop), risk 2% of 5000
    const r = riskBasedQty({ equity: 5_000, riskPct: 0.02, entryPrice: 50, stopPrice: 52 });
    expect(r.qty).toBeCloseTo(100 / 2, 5);  // 50 units
    expect(r.riskAmount).toBeCloseTo(100, 5);
  });

  it('returns fractional qty for tight stops', () => {
    const r = riskBasedQty({ equity: 10_000, riskPct: 0.005, entryPrice: 500, stopPrice: 499 });
    expect(r.qty).toBeCloseTo(50, 5);
  });

  it('throws when stop equals entry', () => {
    expect(() => riskBasedQty({ equity: 10_000, riskPct: 0.01, entryPrice: 100, stopPrice: 100 }))
      .toThrow('stop distance is effectively zero');
  });

  it('throws on invalid equity', () => {
    expect(() => riskBasedQty({ equity: 0, riskPct: 0.01, entryPrice: 100, stopPrice: 95 }))
      .toThrow('equity must be positive');
  });

  it('throws on invalid riskPct', () => {
    expect(() => riskBasedQty({ equity: 10_000, riskPct: 1.5, entryPrice: 100, stopPrice: 95 }))
      .toThrow('riskPct');
  });

  // Regression: risk-based sizing formula - matches user spec expected outputs
  // (spec says riskPct=0.01 but expected qty=8/risk=$200 requires riskPct=0.02)
  it('risk-based sizing: equity=$10k, entry=$500, stop=$475, riskPct=2%', () => {
    const r = riskBasedQty({ equity: 10_000, riskPct: 0.02, entryPrice: 500, stopPrice: 475 });
    expect(r.qty).toBeCloseTo(8, 5);
    expect(r.riskAmount).toBeCloseTo(200, 5);
    expect(r.qty * 500).toBeCloseTo(4_000, 5); // position value
  });
});

describe('recommendTrade - 25% position size cap', () => {
  // Build minimal bars: 2 bars at $200 close; stop supplied via decision so ATR not needed
  const makeBar = (close: number): Bar => ({
    time: '2024-01-01', open: close, high: close, low: close, close, volume: 1_000,
  });
  const bars: Bar[] = [makeBar(200), makeBar(200)];
  const signal: Signal = {
    symbol: 'TEST', strategyId: 'test', side: 'long', time: '2024-01-01', reason: 'test',
  };

  it('caps position value to 25% of equity when raw qty would exceed it', () => {
    // entry=$200, stop=$198 => stopDist=$2 => raw qty=50 => position=$10,000 (100% - broken)
    // After 25% cap: maxPosition=$2,500 => qty=12.5 => risk=$25
    const idea = recommendTrade(signal, bars, { stopPct: 0.01 /* $2 on $200 */ }, {
      equity: 10_000,
      riskPct: 0.01,
    });
    expect(idea).not.toBeNull();
    const positionValue = idea!.qty * idea!.entryPrice;
    expect(positionValue).toBeLessThanOrEqual(10_000 * 0.25 + 0.01); // <= 25% equity
    expect(idea!.qty).toBeCloseTo(12.5, 3); // $2,500 / $200
  });

  it('does not cap when position is already within 25% of equity', () => {
    // entry=$200, stop=$150 => stopDist=$50 => raw qty=2 => position=$400 (4% - fine)
    const idea = recommendTrade(signal, bars, { stopPct: 0.25 /* $50 on $200 */ }, {
      equity: 10_000,
      riskPct: 0.01,
    });
    expect(idea).not.toBeNull();
    expect(idea!.qty).toBeCloseTo(2, 3);
    expect(idea!.riskAmount).toBeCloseTo(100, 3);
  });
});
