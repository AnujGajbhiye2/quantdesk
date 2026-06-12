import { describe, it, expect } from 'vitest';
import { addBusinessDays, medianWinHoldBars, projectExitRange } from './projection';
import type { SlimTrade } from './aggregate';

function trade(pnl: number, holdingBars: number): SlimTrade {
  return { pnl, pnlPct: pnl, holdingBars };
}

describe('medianWinHoldBars', () => {
  it('takes the median of winning trades only', () => {
    const trades = [
      trade(10, 5),
      trade(20, 7),
      trade(5, 9),
      trade(-10, 100), // loser ignored
    ];
    expect(medianWinHoldBars(trades)).toBe(7);
  });

  it('averages the middle pair for an even count', () => {
    const trades = [trade(1, 4), trade(1, 6), trade(1, 10), trade(1, 20)];
    expect(medianWinHoldBars(trades)).toBe(8);
  });

  it('returns null when there are no winners', () => {
    expect(medianWinHoldBars([trade(-5, 3)])).toBeNull();
    expect(medianWinHoldBars([])).toBeNull();
  });
});

describe('addBusinessDays', () => {
  it('skips weekends', () => {
    // 2024-06-07 is a Friday; +1 business day -> Monday 2024-06-10
    expect(addBusinessDays('2024-06-07', 1)).toBe('2024-06-10');
    // +5 business days from Friday -> next Friday
    expect(addBusinessDays('2024-06-07', 5)).toBe('2024-06-14');
  });

  it('walks within a week normally', () => {
    // 2024-06-03 is a Monday
    expect(addBusinessDays('2024-06-03', 3)).toBe('2024-06-06');
  });
});

describe('projectExitRange', () => {
  it('builds a 75%-125% business-day window for daily bars', () => {
    // median 8 bars -> lo=6, hi=10; from Monday 2024-06-03
    const r = projectExitRange('2024-06-03', 8, '1d')!;
    expect(r.medianHoldBars).toBe(8);
    expect(r.earliest).toBe(addBusinessDays('2024-06-03', 6));
    expect(r.latest).toBe(addBusinessDays('2024-06-03', 10));
    expect(r.earliest <= r.latest).toBe(true);
  });

  it('keeps a minimum window of 1 bar', () => {
    const r = projectExitRange('2024-06-03', 1, '1d')!;
    expect(r.earliest).toBe('2024-06-04');
    expect(r.latest >= r.earliest).toBe(true);
  });

  it('returns null for non-positive medians', () => {
    expect(projectExitRange('2024-06-03', 0, '1d')).toBeNull();
    expect(projectExitRange('2024-06-03', -3, '1d')).toBeNull();
  });

  it('uses 7 calendar days per bar for weekly timeframe', () => {
    const r = projectExitRange('2024-06-03', 4, '1wk')!;
    // lo=3, hi=5 -> +21 and +35 calendar days
    expect(r.earliest).toBe('2024-06-24');
    expect(r.latest).toBe('2024-07-08');
  });
});
