import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlpacaProvider } from './alpaca';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const provider = new AlpacaProvider({ keyId: 'test-key', secretKey: 'test-secret' });

/** Build a minimal valid Alpaca bars API response. */
function barsResponse(bars: object[]) {
  return {
    ok: true,
    json: async () => ({ bars, next_page_token: null }),
  };
}

/** Build a minimal valid Alpaca multi-bars API response. */
function multiBarsResponse(barMap: Record<string, object[]>) {
  return {
    ok: true,
    json: async () => ({ bars: barMap, next_page_token: null }),
  };
}

/** Build a minimal valid Alpaca snapshot response. */
function snapshotResponse(symbol: string, price: number, time: string) {
  return {
    ok: true,
    json: async () => ({
      [symbol]: {
        latestTrade: { p: price, t: time },
      },
    }),
  };
}

const VALID_BAR = { t: '2025-06-18T14:30:00Z', o: 100, h: 105, l: 99, c: 103, v: 1000 };

beforeEach(() => {
  mockFetch.mockReset();
});

describe('AlpacaProvider.id and assetClasses', () => {
  it('has id "alpaca"', () => {
    expect(provider.id).toBe('alpaca');
  });

  it('includes equity and commodity', () => {
    expect(provider.assetClasses).toContain('equity');
    expect(provider.assetClasses).toContain('commodity');
  });
});

describe('toProviderSymbol', () => {
  it('returns symbol unchanged', () => {
    expect(provider.toProviderSymbol('AAPL')).toBe('AAPL');
    expect(provider.toProviderSymbol('GLD')).toBe('GLD');
  });
});

describe('getHistory', () => {
  it('maps 15m timeframe to "15Min" in the URL', async () => {
    mockFetch.mockResolvedValueOnce(barsResponse([VALID_BAR]));
    await provider.getHistory('AAPL', '15m', '2025-06-01', '2025-06-18');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('timeframe=15Min');
  });

  it('maps 1d timeframe to "1Day"', async () => {
    mockFetch.mockResolvedValueOnce(barsResponse([VALID_BAR]));
    await provider.getHistory('AAPL', '1d', '2025-06-01', '2025-06-18');
    expect(mockFetch.mock.calls[0][0]).toContain('timeframe=1Day');
  });

  it('throws on unsupported timeframe', async () => {
    // '1m' is in the Timeframe union but not mapped in TIMEFRAME_MAP
    // Use a cast to simulate a caller passing an unrecognised value
    await expect(
      provider.getHistory('AAPL', 'bad' as import('@/core/types').Timeframe, '2025-06-01', '2025-06-18'),
    ).rejects.toThrow(/unsupported timeframe/);
  });

  it('returns sorted bars with canonical fields', async () => {
    const bars = [
      { t: '2025-06-18T15:00:00Z', o: 101, h: 106, l: 100, c: 104, v: 500 },
      { t: '2025-06-18T14:30:00Z', o: 100, h: 105, l: 99,  c: 103, v: 1000 },
    ];
    mockFetch.mockResolvedValueOnce(barsResponse(bars));
    const result = await provider.getHistory('AAPL', '15m', '2025-06-18', '2025-06-18');
    expect(result).toHaveLength(2);
    // Alpaca returns 'Z' suffix; adapter preserves it (not re-parsed)
    expect(result[0].time).toBe('2025-06-18T14:30:00Z');
    expect(result[1].time).toBe('2025-06-18T15:00:00Z');
    expect(result[0].open).toBe(100);
    expect(result[0].close).toBe(103);
  });

  it('throws when API returns error status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'Forbidden' });
    await expect(provider.getHistory('AAPL', '15m', '2025-06-01', '2025-06-18')).rejects.toThrow(
      /Alpaca API error 403/,
    );
  });

  it('sends auth headers', async () => {
    mockFetch.mockResolvedValueOnce(barsResponse([VALID_BAR]));
    await provider.getHistory('AAPL', '15m', '2025-06-01', '2025-06-18');
    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['APCA-API-KEY-ID']).toBe('test-key');
    expect((init.headers as Record<string, string>)['APCA-API-SECRET-KEY']).toBe('test-secret');
  });

  it('defaults to the iex feed', async () => {
    mockFetch.mockResolvedValueOnce(barsResponse([VALID_BAR]));
    await provider.getHistory('AAPL', '1d', '2025-06-01', '2025-06-18');
    expect(mockFetch.mock.calls[0][0]).toContain('feed=iex');
  });

  it('uses the sip feed when constructed with feed: "sip" (paid plan)', async () => {
    const sipProvider = new AlpacaProvider({ keyId: 'k', secretKey: 's', feed: 'sip' });
    mockFetch.mockResolvedValueOnce(barsResponse([VALID_BAR]));
    await sipProvider.getHistory('AAPL', '1d', '2025-06-01', '2025-06-18');
    expect(mockFetch.mock.calls[0][0]).toContain('feed=sip');
  });

  it('validates bar OHLCV via zod - quarantines (drops) an invalid bar instead of failing the whole fetch', async () => {
    // A single malformed bar used to abort the entire symbol's ingest; now
    // it's dropped (logged) and valid bars in the same response still come
    // through. See core/data/schemas.ts validateBars.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetch.mockResolvedValueOnce(barsResponse([
      { t: '2025-06-18T14:30:00Z', o: 100, h: 90, l: 95, c: 98, v: 100 }, // invalid: high < open
      VALID_BAR,
    ]));
    const result = await provider.getHistory('AAPL', '15m', '2025-06-18', '2025-06-18');
    warnSpy.mockRestore();
    expect(result).toHaveLength(1);
  });
});

describe('getHistoryBatch', () => {
  it('fetches multiple symbols in one request', async () => {
    mockFetch.mockResolvedValueOnce(multiBarsResponse({
      AAPL: [VALID_BAR],
      MSFT: [{ ...VALID_BAR, o: 200, h: 210, l: 198, c: 205 }],
    }));
    const result = await provider.getHistoryBatch(['AAPL', 'MSFT'], '15m', '2025-06-18', '2025-06-18');
    expect(result['AAPL']).toHaveLength(1);
    expect(result['MSFT']).toHaveLength(1);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('symbols=AAPL%2CMSFT');
  });

  it('returns empty array for missing symbols', async () => {
    mockFetch.mockResolvedValueOnce(multiBarsResponse({ AAPL: [VALID_BAR] }));
    const result = await provider.getHistoryBatch(['AAPL', 'MISSING'], '15m', '2025-06-18', '2025-06-18');
    expect(result['MISSING']).toEqual([]);
    expect(result['AAPL']).toHaveLength(1);
  });
});

describe('getQuote', () => {
  it('returns latest trade price and time', async () => {
    mockFetch.mockResolvedValueOnce(snapshotResponse('AAPL', 175.50, '2025-06-18T19:59:00Z'));
    const quote = await provider.getQuote('AAPL');
    expect(quote).not.toBeNull();
    expect(quote!.price).toBe(175.50);
    expect(quote!.time).toBe('2025-06-18T19:59:00Z');
  });

  it('returns null when symbol not in response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const quote = await provider.getQuote('UNKNOWN');
    expect(quote).toBeNull();
  });

  it('returns null on fetch error (non-fatal)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const quote = await provider.getQuote('AAPL');
    expect(quote).toBeNull();
  });
});
