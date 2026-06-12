import { describe, it, expect } from 'vitest';
import { monthlyReturns } from './monthly';
import type { EquityPoint } from './engine';

function pt(time: string, equity: number): EquityPoint {
  return { time, equity };
}

describe('monthlyReturns', () => {
  it('computes month-over-month returns from month-end equity', () => {
    const curve = [
      pt('2024-01-15', 10000), // first month, starts mid-month
      pt('2024-01-31', 10500),
      pt('2024-02-15', 10200),
      pt('2024-02-29', 11550),
      pt('2024-03-08', 11000), // in-progress month
    ];
    const out = monthlyReturns(curve);

    expect(out).toHaveLength(3);
    // Jan: 10000 -> 10500 = +5%, partial (mid-month entry)
    expect(out[0]).toMatchObject({ year: 2024, month: 1, partial: true });
    expect(out[0].returnPct).toBeCloseTo(5, 10);
    // Feb: 10500 -> 11550 = +10%, full month
    expect(out[1]).toMatchObject({ year: 2024, month: 2, partial: false });
    expect(out[1].returnPct).toBeCloseTo(10, 10);
    // Mar: 11550 -> 11000 = -4.7619%, partial (in progress)
    expect(out[2]).toMatchObject({ year: 2024, month: 3, partial: true });
    expect(out[2].returnPct).toBeCloseTo((11000 / 11550 - 1) * 100, 10);
  });

  it('flags a single month as partial', () => {
    const out = monthlyReturns([pt('2024-05-01', 100), pt('2024-05-20', 110)]);
    expect(out).toHaveLength(1);
    expect(out[0].partial).toBe(true);
    expect(out[0].returnPct).toBeCloseTo(10, 10);
  });

  it('spans year boundaries', () => {
    const out = monthlyReturns([
      pt('2023-12-29', 100),
      pt('2024-01-31', 120),
      pt('2024-02-28', 60),
    ]);
    expect(out.map((r) => `${r.year}-${r.month}`)).toEqual(['2023-12', '2024-1', '2024-2']);
    expect(out[1].returnPct).toBeCloseTo(20, 10);
    expect(out[2].returnPct).toBeCloseTo(-50, 10);
  });

  it('returns empty for empty curve', () => {
    expect(monthlyReturns([])).toEqual([]);
  });
});
