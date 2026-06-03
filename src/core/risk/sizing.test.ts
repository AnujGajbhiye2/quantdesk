import { describe, it, expect } from 'vitest';
import { riskBasedQty } from './sizing';

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
});
