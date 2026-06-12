import { describe, it, expect } from 'vitest';
import { aggregateEdge, median, type SlimTrade } from './aggregate';

function trade(pnl: number, pnlPct: number, holdingBars: number): SlimTrade {
  return { pnl, pnlPct, holdingBars };
}

describe('median', () => {
  it('odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
    expect(median([7])).toBe(7);
  });
});

describe('aggregateEdge', () => {
  it('computes win rate, averages, profit factor from a fixed trade list', () => {
    const trades = [
      trade(100, 4.0, 5),   // win
      trade(50, 2.0, 9),    // win
      trade(-75, -3.0, 4),  // loss
      trade(-25, -1.0, 2),  // loss
    ];
    const e = aggregateEdge(trades);

    expect(e.numTrades).toBe(4);
    expect(e.winRate).toBeCloseTo(0.5, 10);
    expect(e.avgWinPct).toBeCloseTo(3.0, 10);   // (4 + 2) / 2
    expect(e.avgLossPct).toBeCloseTo(-2.0, 10); // (-3 + -1) / 2
    expect(e.profitFactor).toBeCloseTo(150 / 100, 10);
    expect(e.medianWinHoldBars).toBe(7);        // median of [5, 9]
  });

  it('caps profit factor when there are no losses', () => {
    const e = aggregateEdge([trade(100, 5, 3)]);
    expect(e.profitFactor).toBe(9999);
    expect(e.winRate).toBe(1);
  });

  it('zero profit factor when there are no wins', () => {
    const e = aggregateEdge([trade(-100, -5, 3)]);
    expect(e.profitFactor).toBe(0);
    expect(e.winRate).toBe(0);
    expect(e.medianWinHoldBars).toBe(0);
  });

  it('treats breakeven trades as losses (pnl <= 0)', () => {
    const e = aggregateEdge([trade(0, 0, 1), trade(10, 1, 2)]);
    expect(e.winRate).toBeCloseTo(0.5, 10);
  });

  it('empty input gives zeroed stats', () => {
    const e = aggregateEdge([]);
    expect(e).toEqual({
      winRate: 0,
      avgWinPct: 0,
      avgLossPct: 0,
      profitFactor: 0,
      numTrades: 0,
      medianWinHoldBars: 0,
    });
  });
});
