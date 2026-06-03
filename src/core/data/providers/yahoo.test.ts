import { describe, it, expect, vi, beforeEach } from 'vitest';
import { YahooProvider } from './yahoo';

// vi.mock() is hoisted to the top of the file, so module-level const refs are
// not yet initialised when the factory runs. vi.hoisted() is the vitest pattern
// for creating mock fns that must be referenced inside vi.mock().
const { mockChart, mockQuote, mockSearch } = vi.hoisted(() => ({
  mockChart: vi.fn(),
  mockQuote: vi.fn(),
  mockSearch: vi.fn(),
}));

vi.mock('yahoo-finance2', () => ({
  // Use class syntax so `new YahooFinance()` works correctly as a constructor.
  default: class {
    chart = mockChart;
    quote = mockQuote;
    search = mockSearch;
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A minimal mock chart() response for 3 daily bars. */
const mockChartResponse = {
  quotes: [
    { date: new Date('2024-01-03T00:00:00Z'), open: 185.0, high: 187.5, low: 184.2, close: 186.3, volume: 75_000_000 },
    { date: new Date('2024-01-04T00:00:00Z'), open: 183.5, high: 185.0, low: 182.0, close: 182.9, volume: 82_000_000 },
    { date: new Date('2024-01-05T00:00:00Z'), open: 183.0, high: 184.5, low: 181.5, close: 184.1, volume: 70_000_000 },
  ],
};

/** A bar with a null close to test sparse-data filtering. */
const mockChartWithNulls = {
  quotes: [
    { date: new Date('2024-01-03T00:00:00Z'), open: 185.0, high: 187.5, low: 184.2, close: 186.3, volume: 75_000_000 },
    { date: null, open: null, high: null, low: null, close: null, volume: null }, // should be skipped
    { date: new Date('2024-01-05T00:00:00Z'), open: 183.0, high: 184.5, low: 181.5, close: 184.1, volume: 70_000_000 },
  ],
};

/** Out-of-order bars (Yahoo should sort, but test defensive sort). */
const mockChartOutOfOrder = {
  quotes: [
    { date: new Date('2024-01-05T00:00:00Z'), open: 183.0, high: 184.5, low: 181.5, close: 184.1, volume: 70_000_000 },
    { date: new Date('2024-01-03T00:00:00Z'), open: 185.0, high: 187.5, low: 184.2, close: 186.3, volume: 75_000_000 },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('YahooProvider', () => {
  let provider: YahooProvider;

  beforeEach(() => {
    provider = new YahooProvider();
    vi.clearAllMocks();
  });

  describe('getHistory()', () => {
    it('normalises a mock chart response into valid ascending Bar[]', async () => {
      mockChart.mockResolvedValue(mockChartResponse);

      const bars = await provider.getHistory('AAPL', '1d', '2024-01-03', '2024-01-05');

      expect(bars).toHaveLength(3);

      // Daily time must be 'YYYY-MM-DD'
      expect(bars[0].time).toBe('2024-01-03');
      expect(bars[1].time).toBe('2024-01-04');
      expect(bars[2].time).toBe('2024-01-05');

      // OHLCV values preserved
      expect(bars[0].open).toBe(185.0);
      expect(bars[0].high).toBe(187.5);
      expect(bars[0].low).toBe(184.2);
      expect(bars[0].close).toBe(186.3);
      expect(bars[0].volume).toBe(75_000_000);

      // Ascending order guaranteed
      expect(bars[0].time < bars[1].time).toBe(true);
      expect(bars[1].time < bars[2].time).toBe(true);
    });

    it('skips bars with null OHLCV values (sparse data)', async () => {
      mockChart.mockResolvedValue(mockChartWithNulls);

      const bars = await provider.getHistory('AAPL', '1d', '2024-01-03', '2024-01-05');

      // The null bar is filtered out
      expect(bars).toHaveLength(2);
      expect(bars.some((b) => b.time === '2024-01-04')).toBe(false);
    });

    it('sorts bars ascending even when provider returns out-of-order data', async () => {
      mockChart.mockResolvedValue(mockChartOutOfOrder);

      const bars = await provider.getHistory('AAPL', '1d', '2024-01-03', '2024-01-05');

      expect(bars[0].time).toBe('2024-01-03');
      expect(bars[1].time).toBe('2024-01-05');
    });

    it('passes the correct symbol and interval to yahoo-finance2.chart()', async () => {
      mockChart.mockResolvedValue({ quotes: [] });

      await provider.getHistory('MSFT', '1wk', '2024-01-01', '2024-06-01');

      expect(mockChart).toHaveBeenCalledWith(
        'MSFT',
        expect.objectContaining({ interval: '1wk', period1: '2024-01-01', period2: '2024-06-01' }),
      );
    });

    it('returns an empty array when chart() returns no quotes', async () => {
      mockChart.mockResolvedValue({ quotes: [] });

      const bars = await provider.getHistory('AAPL', '1d', '2024-01-01', '2024-01-05');
      expect(bars).toHaveLength(0);
    });

    it('clamps bad high/low values to enforce OHLC integrity', async () => {
      // Simulates Yahoo forex precision issue: high=90 is below open=100 and close=97.
      // The adapter clamps: high = max(90, 100, 97) = 100, low = min(95, 100, 97) = 95.
      const bad = {
        quotes: [
          { date: new Date('2024-01-03T00:00:00Z'), open: 100, high: 90, low: 95, close: 97, volume: 1000 },
        ],
      };
      mockChart.mockResolvedValue(bad);

      const bars = await provider.getHistory('AAPL', '1d', '2024-01-03', '2024-01-03');

      expect(bars).toHaveLength(1);
      // Clamped high = max(90, 100, 97) = 100; clamped low = min(95, 100, 97) = 95
      expect(bars[0].high).toBe(100);
      expect(bars[0].low).toBe(95);
      expect(bars[0].open).toBe(100);
      expect(bars[0].close).toBe(97);
    });
  });

  describe('toProviderSymbol()', () => {
    it('returns the canonical symbol unchanged by default', () => {
      expect(provider.toProviderSymbol('NVDA')).toBe('NVDA');
      expect(provider.toProviderSymbol('EURUSD=X')).toBe('EURUSD=X');
    });
  });

  describe('id and assetClasses', () => {
    it('has id "yahoo"', () => {
      expect(provider.id).toBe('yahoo');
    });

    it('declares at least equity and index asset classes', () => {
      expect(provider.assetClasses).toContain('equity');
      expect(provider.assetClasses).toContain('index');
    });
  });
});
