import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Bar, SymbolMeta } from '@/core/types';

// ---------------------------------------------------------------------------
// Mock DB modules (no real SQLite in tests)
// ---------------------------------------------------------------------------

const mockGetAllSymbols = vi.fn();
const mockGetBars       = vi.fn();

vi.mock('@/core/db/bars', () => ({
  getAllSymbols:   (...args: unknown[]) => mockGetAllSymbols(...args),
  getBars:         (...args: unknown[]) => mockGetBars(...args),
  getRecentBars:   (...args: unknown[]) => mockGetBars(...args),
  getLatestClose:  vi.fn(),
}));

// Mock indicator compute so tests don't depend on @ixjb94/indicators internals.
// We control the output directly.
const mockCompute = vi.fn();

vi.mock('@/core/indicators/registry', () => ({
  compute:         (...args: unknown[]) => mockCompute(...args),
  listIndicators:  vi.fn(() => []),
}));

const { getMarketSnapshot, invalidateSnapshotCache } = await import('./snapshot');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const META: SymbolMeta = {
  symbol:        'AAPL',
  providerSymbol: 'AAPL',
  name:          'Apple Inc.',
  assetClass:    'equity',
  currency:      'USD',
  providerId:    'yahoo',
};

function makeBar(close: number, i: number): Bar {
  return {
    time:   `2024-01-${String(i + 1).padStart(2, '0')}`,
    open:   close - 1,
    high:   close + 2,
    low:    close - 2,
    close,
    volume: 1_000_000,
  };
}

function makeBars(closes: number[]): Bar[] {
  return closes.map((c, i) => makeBar(c, i));
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateSnapshotCache();
  mockGetAllSymbols.mockReturnValue([META]);
  // Default: compute returns NaN-padded arrays (simulates warm-up)
  mockCompute.mockReturnValue(Array(25).fill(NaN));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getMarketSnapshot', () => {
  it('skips symbols with fewer than 2 bars', () => {
    mockGetBars.mockReturnValue(makeBars([100]));
    const rows = getMarketSnapshot();
    expect(rows).toHaveLength(0);
  });

  it('computes changePct correctly', () => {
    // prev=100, last=105 -> changePct = 5
    mockGetBars.mockReturnValue(makeBars([100, 105]));
    const [row] = getMarketSnapshot();
    expect(row.last).toBeCloseTo(105, 6);
    expect(row.prevClose).toBeCloseTo(100, 6);
    expect(row.changePct).toBeCloseTo(5, 6);
  });

  it('changePct is negative for a down bar', () => {
    mockGetBars.mockReturnValue(makeBars([100, 90]));
    const [row] = getMarketSnapshot();
    expect(row.changePct).toBeCloseTo(-10, 6);
  });

  it('spark is last 20 closes (oldest first), length capped at 20', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    mockGetBars.mockReturnValue(makeBars(closes));
    const [row] = getMarketSnapshot();
    expect(row.spark).toHaveLength(20);
    // spark should contain the LAST 20 closes: closes[10..29]
    expect(row.spark[0]).toBeCloseTo(closes[10], 6);
    expect(row.spark[19]).toBeCloseTo(closes[29], 6);
  });

  it('spark length <= bars count when bars < 20', () => {
    mockGetBars.mockReturnValue(makeBars([100, 105, 102]));
    const [row] = getMarketSnapshot();
    expect(row.spark).toHaveLength(3);
  });

  it('macdState is bullish when macd line > signal line at last bar', () => {
    mockGetBars.mockReturnValue(makeBars([100, 105]));
    // compute returns different values per call: first call = RSI, second = MACD
    let callCount = 0;
    mockCompute.mockImplementation((id: string) => {
      callCount++;
      if (id === 'rsi') return [NaN, 55];
      if (id === 'macd') return { macd: [NaN, 5], signal: [NaN, 3], histogram: [NaN, 2] };
      return [];
    });
    const [row] = getMarketSnapshot();
    expect(row.macdState).toBe('bullish');
    void callCount;
  });

  it('macdState is bearish when macd line < signal line', () => {
    mockGetBars.mockReturnValue(makeBars([100, 105]));
    mockCompute.mockImplementation((id: string) => {
      if (id === 'rsi')  return [NaN, 45];
      if (id === 'macd') return { macd: [NaN, 2], signal: [NaN, 5], histogram: [NaN, -3] };
      return [];
    });
    const [row] = getMarketSnapshot();
    expect(row.macdState).toBe('bearish');
  });

  it('maCross is unknown when fewer than 200 bars', () => {
    // Only 2 bars - can't compute 200-period MA
    mockGetBars.mockReturnValue(makeBars([100, 105]));
    const [row] = getMarketSnapshot();
    expect(row.maCross).toBe('unknown');
  });

  it('maCross is golden when ma50 > ma200', () => {
    const bars = makeBars(Array.from({ length: 210 }, (_, i) => 100 + i));
    mockGetBars.mockReturnValue(bars);
    mockCompute.mockImplementation((id: string, _bars: Bar[], params: { period?: number }) => {
      const out = Array(210).fill(NaN);
      if (id === 'rsi') { out[209] = 60; return out; }
      if (id === 'macd') return { macd: out, signal: out, histogram: out };
      if (id === 'sma') {
        if (params.period === 50)  { const a = [...out]; a[209] = 200; return a; }
        if (params.period === 200) { const a = [...out]; a[209] = 150; return a; }
      }
      return out;
    });
    const [row] = getMarketSnapshot();
    expect(row.maCross).toBe('golden');
  });

  it('maCross is death when ma50 < ma200', () => {
    const bars = makeBars(Array.from({ length: 210 }, (_, i) => 100 + i));
    mockGetBars.mockReturnValue(bars);
    mockCompute.mockImplementation((id: string, _bars: Bar[], params: { period?: number }) => {
      const out = Array(210).fill(NaN);
      if (id === 'rsi') { out[209] = 40; return out; }
      if (id === 'macd') return { macd: out, signal: out, histogram: out };
      if (id === 'sma') {
        if (params.period === 50)  { const a = [...out]; a[209] = 100; return a; }
        if (params.period === 200) { const a = [...out]; a[209] = 150; return a; }
      }
      return out;
    });
    const [row] = getMarketSnapshot();
    expect(row.maCross).toBe('death');
  });

  it('rsi14 is NaN when compute returns all NaN', () => {
    mockGetBars.mockReturnValue(makeBars([100, 105]));
    mockCompute.mockReturnValue([NaN, NaN]);
    const [row] = getMarketSnapshot();
    expect(isNaN(row.rsi14)).toBe(true);
  });

  it('filters by symbols option', () => {
    mockGetAllSymbols.mockReturnValue([
      META,
      { ...META, symbol: 'MSFT', name: 'Microsoft' },
    ]);
    mockGetBars.mockReturnValue(makeBars([100, 105]));

    const rows = getMarketSnapshot({ symbols: ['AAPL'] });
    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe('AAPL');
  });
});
