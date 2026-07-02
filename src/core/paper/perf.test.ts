import { describe, it, expect, vi } from 'vitest';
import type { PaperTrade } from '@/core/types';

const mockGetPaperTrades = vi.fn();

vi.mock('@/core/db/paper', () => ({
  getPaperTrades: (...args: unknown[]) => mockGetPaperTrades(...args),
}));

const { buildPerformanceMetrics } = await import('./perf');

function trade(overrides: Partial<PaperTrade> & { id: string }): PaperTrade {
  return {
    strategyId: 'rsi-reversion', symbol: overrides.id, side: 'long',
    qty: 10, entryTime: '2024-01-01T00:00:00Z', entryPrice: 100,
    status: 'closed', costs: 0,
    ...overrides,
  } as PaperTrade;
}

describe('buildPerformanceMetrics - equityCurve', () => {
  it('returns an empty equity curve with zero trades', () => {
    mockGetPaperTrades.mockReturnValue([]);
    const perf = buildPerformanceMetrics();
    expect(perf.equityCurve).toEqual([]);
  });

  it('produces one equity point per closed trade, dated at exitTime, compounding from $100', () => {
    mockGetPaperTrades.mockReturnValue([
      trade({ id: 'A', exitTime: '2024-01-02', pnlPct: 10 }),
      trade({ id: 'B', exitTime: '2024-01-05', pnlPct: -5 }),
    ]);
    const perf = buildPerformanceMetrics();
    expect(perf.equityCurve).toHaveLength(2);
    expect(perf.equityCurve[0].time).toBe('2024-01-02');
    expect(perf.equityCurve[0].equity).toBeCloseTo(110, 6);
    // second point: 110 * (1 - 0.05) = 104.5
    expect(perf.equityCurve[1].time).toBe('2024-01-05');
    expect(perf.equityCurve[1].equity).toBeCloseTo(104.5, 6);
  });

  it('sorts the curve chronologically regardless of DB row order', () => {
    mockGetPaperTrades.mockReturnValue([
      trade({ id: 'B', exitTime: '2024-01-05', pnlPct: -5 }),
      trade({ id: 'A', exitTime: '2024-01-02', pnlPct: 10 }),
    ]);
    const perf = buildPerformanceMetrics();
    expect(perf.equityCurve.map((p) => p.time)).toEqual(['2024-01-02', '2024-01-05']);
  });

  it('excludes trades with no exitTime from the curve', () => {
    mockGetPaperTrades.mockReturnValue([
      trade({ id: 'A', exitTime: '2024-01-02', pnlPct: 10 }),
      trade({ id: 'B', exitTime: undefined, pnlPct: 5 }),
    ]);
    const perf = buildPerformanceMetrics();
    expect(perf.equityCurve).toHaveLength(1);
  });
});
