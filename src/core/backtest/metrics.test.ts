import { describe, it, expect } from 'vitest';
import { computeMetrics, BARS_PER_YEAR } from './metrics';
import type { TradeRecord, EquityPoint } from './engine';

function trade(overrides: Partial<TradeRecord> = {}): TradeRecord {
  return {
    id: 't1',
    symbol: 'TEST',
    side: 'long',
    entryTime: '2024-01-01',
    entryBar: 0,
    entryPrice: 100,
    exitTime: '2024-01-02',
    exitBar: 1,
    exitPrice: 110,
    qty: 1,
    pnl: 10,
    pnlPct: 10,
    costs: 0,
    holdingBars: 1,
    exitReason: 'signal',
    entryReason: 'test',
    ...overrides,
  };
}

function equity(points: number[], startDate = '2024-01-01'): EquityPoint[] {
  const start = new Date(startDate).getTime();
  const dayMs = 24 * 3600 * 1000;
  return points.map((e, i) => ({
    time: new Date(start + i * dayMs).toISOString().slice(0, 10),
    equity: e,
  }));
}

describe('computeMetrics', () => {
  it('computes win rate, avg win/loss, and profit factor from mixed trades', () => {
    const trades = [
      trade({ id: 'w1', pnl: 100, pnlPct: 10 }),
      trade({ id: 'w2', pnl: 50, pnlPct: 5 }),
      trade({ id: 'l1', pnl: -40, pnlPct: -4 }),
    ];
    const m = computeMetrics(trades, equity([10_000, 10_100, 10_150, 10_110]), 4, 10_000);

    expect(m.numTrades).toBe(3);
    expect(m.winRate).toBeCloseTo(2 / 3, 10);
    expect(m.avgWinPct).toBeCloseTo((10 + 5) / 2, 10);
    expect(m.avgLossPct).toBeCloseTo(-4, 10);
    // profit factor = gross wins / gross losses = 150 / 40
    expect(m.profitFactor).toBeCloseTo(150 / 40, 10);
  });

  it('reports profitFactor = Infinity when there are wins and zero losses', () => {
    const trades = [trade({ pnl: 50, pnlPct: 5 })];
    const m = computeMetrics(trades, equity([10_000, 10_500]), 2, 10_000);
    expect(m.profitFactor).toBe(Infinity);
  });

  it('reports profitFactor = 0 with no trades', () => {
    const m = computeMetrics([], equity([10_000]), 1, 10_000);
    expect(m.profitFactor).toBe(0);
    expect(m.numTrades).toBe(0);
    expect(m.winRate).toBe(0);
  });

  it('computes total return and CAGR from the equity curve endpoints', () => {
    // Exactly one year apart (365.25 days), equity doubles -> CAGR = 100%
    const curve: EquityPoint[] = [
      { time: '2023-01-01', equity: 10_000 },
      { time: '2024-01-01T06:00:00.000Z', equity: 20_000 }, // ~365.25 days later
    ];
    const m = computeMetrics([], curve, 2, 10_000);
    expect(m.totalReturnPct).toBeCloseTo(100, 10);
    expect(m.cagr).toBeCloseTo(100, 0);
  });

  it('computes max drawdown as the largest peak-to-trough decline', () => {
    // Peak 12,000 -> trough 9,000 -> dd = (9000-12000)/12000 = -25%
    const curve = equity([10_000, 12_000, 11_000, 9_000, 9_500]);
    const m = computeMetrics([], curve, curve.length, 10_000);
    expect(m.maxDrawdownPct).toBeCloseTo(25, 10);
  });

  it('computes annualised Sharpe matching a manual calculation', () => {
    // Deterministic equity curve: alternating +1%/-0.5% bar returns
    const values = [10_000];
    const rets = [0.01, -0.005, 0.01, -0.005, 0.01, -0.005];
    for (const r of rets) values.push(values[values.length - 1] * (1 + r));
    const curve = equity(values);
    const barsPerYear = 252;
    const m = computeMetrics([], curve, curve.length, 10_000, barsPerYear);

    const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
    const variance =
      rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
    const std = Math.sqrt(variance);
    const expected = (mean / std) * Math.sqrt(barsPerYear);

    expect(m.sharpe).toBeCloseTo(expected, 6);
  });

  it('uses BARS_PER_YEAR to avoid the daily-default annualisation bug', () => {
    // Same return series annualised at 15m vs 1d bar counts must differ by
    // sqrt(barsPerYear) - this is the /api/backtest hardcoded-252 bug this
    // test guards against regressing.
    const values = [10_000, 10_100, 10_050, 10_150];
    const curveDaily   = equity(values);
    const mDaily   = computeMetrics([], curveDaily, curveDaily.length, 10_000, BARS_PER_YEAR['1d']);
    const m15m     = computeMetrics([], curveDaily, curveDaily.length, 10_000, BARS_PER_YEAR['15m']);

    expect(BARS_PER_YEAR['15m']).toBeGreaterThan(BARS_PER_YEAR['1d']);
    const ratio = m15m.sharpe / mDaily.sharpe;
    const expectedRatio = Math.sqrt(BARS_PER_YEAR['15m'] / BARS_PER_YEAR['1d']);
    expect(ratio).toBeCloseTo(expectedRatio, 6);
  });

  it('exposurePct de-dupes overlapping bars from partial exits (never exceeds 100%)', () => {
    // Simulate a partial exit: the runner and the partial both cover bars 0..5,
    // which is what engine.ts produces when closePartialLong fires. A naive
    // sum of holdingBars would give (5+5)/6*100 = 166%.
    const trades = [
      trade({ id: 'partial', entryBar: 0, exitBar: 5, holdingBars: 5 }),
      trade({ id: 'runner',  entryBar: 0, exitBar: 5, holdingBars: 5 }),
    ];
    const m = computeMetrics(trades, equity([10_000, 10_100, 10_200, 10_150, 10_300, 10_400]), 6, 10_000);
    expect(m.exposurePct).toBeLessThanOrEqual(100);
    // bars 0..5 inclusive = 6 unique bars out of 6 total = 100%
    expect(m.exposurePct).toBeCloseTo(100, 10);
  });

  it('exposurePct reflects only bars actually in a position for non-overlapping trades', () => {
    const trades = [
      trade({ id: 'a', entryBar: 0, exitBar: 1, holdingBars: 1 }),
      trade({ id: 'b', entryBar: 4, exitBar: 5, holdingBars: 1 }),
    ];
    // bars {0,1} and {4,5} = 4 unique bars out of 10 total = 40%
    const m = computeMetrics(trades, equity(Array(10).fill(10_000)), 10, 10_000);
    expect(m.exposurePct).toBeCloseTo(40, 10);
  });

  it('exposureSharpe is NaN when no bars are in position', () => {
    const m = computeMetrics([], equity([10_000, 10_100, 10_050]), 3, 10_000);
    expect(Number.isNaN(m.exposureSharpe)).toBe(true);
  });
});
