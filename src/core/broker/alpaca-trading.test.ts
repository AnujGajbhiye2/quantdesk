import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AlpacaTradingClient, AlpacaApiError, getAlpacaTradingClient } from './alpaca-trading';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const client = new AlpacaTradingClient({
  keyId: 'test-key',
  secretKey: 'test-secret',
  baseUrl: 'https://paper-api.alpaca.markets',
});

const ORDER_RESPONSE = {
  id: 'ord-1',
  client_order_id: 'qd:trade-1:entry',
  symbol: 'AAPL',
  side: 'buy',
  qty: '10',
  notional: null,
  status: 'accepted',
  filled_qty: '0',
  filled_avg_price: null,
  submitted_at: '2026-07-08T14:30:00Z',
  filled_at: null,
};

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('submitOrder', () => {
  it('POSTs to /v2/orders with auth headers and snake_case body', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(ORDER_RESPONSE));
    const order = await client.submitOrder({
      symbol: 'AAPL',
      qty: 10,
      side: 'buy',
      type: 'market',
      timeInForce: 'day',
      clientOrderId: 'qd:trade-1:entry',
    });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://paper-api.alpaca.markets/v2/orders');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['APCA-API-KEY-ID']).toBe('test-key');
    expect(headers['APCA-API-SECRET-KEY']).toBe('test-secret');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      symbol: 'AAPL',
      qty: '10',
      side: 'buy',
      type: 'market',
      time_in_force: 'day',
      client_order_id: 'qd:trade-1:entry',
    });
    expect(order.id).toBe('ord-1');
    expect(order.clientOrderId).toBe('qd:trade-1:entry');
    expect(order.status).toBe('accepted');
  });

  it('retries on 429 then succeeds', async () => {
    vi.useFakeTimers();
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ message: 'rate limited' }, 429))
      .mockResolvedValueOnce(jsonResponse(ORDER_RESPONSE));
    const promise = client.submitOrder({
      symbol: 'AAPL', qty: 10, side: 'buy', type: 'market', timeInForce: 'day',
    });
    await vi.runAllTimersAsync();
    const order = await promise;
    expect(order.id).toBe('ord-1');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('throws AlpacaApiError with status on 422', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ message: 'duplicate client_order_id' }, 422));
    await expect(
      client.submitOrder({ symbol: 'AAPL', qty: 10, side: 'buy', type: 'market', timeInForce: 'day' }),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe('getOrderByClientOrderId', () => {
  it('returns the order when found', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ...ORDER_RESPONSE, status: 'filled', filled_qty: '10', filled_avg_price: '150.25', filled_at: '2026-07-08T14:31:00Z' }));
    const order = await client.getOrderByClientOrderId('qd:trade-1:entry');
    expect(order).not.toBeNull();
    expect(order!.status).toBe('filled');
    expect(order!.filledQty).toBe(10);
    expect(order!.filledAvgPrice).toBe(150.25);
  });

  it('returns null on 404', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ message: 'order not found' }, 404));
    const order = await client.getOrderByClientOrderId('qd:missing:entry');
    expect(order).toBeNull();
  });
});

describe('getPositions', () => {
  it('parses positions with numeric coercion', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([
      { symbol: 'AAPL', qty: '10', side: 'long', avg_entry_price: '150.5', market_value: '1505' },
    ]));
    const positions = await client.getPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0]).toEqual({
      symbol: 'AAPL', qty: 10, side: 'long', avgEntryPrice: 150.5, marketValue: 1505,
    });
  });
});

describe('cancelOrder', () => {
  it('DELETEs the order and tolerates a 204 response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204, json: async () => { throw new Error('no body'); }, text: async () => '' });
    await expect(client.cancelOrder('ord-1')).resolves.toBeUndefined();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://paper-api.alpaca.markets/v2/orders/ord-1');
    expect(init.method).toBe('DELETE');
  });
});

describe('getAlpacaTradingClient live-endpoint guard', () => {
  const ENV_KEYS = ['ALPACA_KEY_ID', 'ALPACA_SECRET_KEY', 'ALPACA_ENDPOINT', 'ALPACA_ALLOW_LIVE_TRADING'] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('returns null without keys', () => {
    expect(getAlpacaTradingClient()).toBeNull();
  });

  it('builds a client for the paper endpoint', () => {
    process.env.ALPACA_KEY_ID = 'k';
    process.env.ALPACA_SECRET_KEY = 's';
    process.env.ALPACA_ENDPOINT = 'https://paper-api.alpaca.markets/v2';
    expect(getAlpacaTradingClient()).toBeInstanceOf(AlpacaTradingClient);
  });

  it('throws on a live endpoint without ALPACA_ALLOW_LIVE_TRADING=1', () => {
    process.env.ALPACA_KEY_ID = 'k';
    process.env.ALPACA_SECRET_KEY = 's';
    process.env.ALPACA_ENDPOINT = 'https://api.alpaca.markets';
    expect(() => getAlpacaTradingClient()).toThrow(/not the paper endpoint/);
  });

  it('allows a live endpoint when explicitly enabled', () => {
    process.env.ALPACA_KEY_ID = 'k';
    process.env.ALPACA_SECRET_KEY = 's';
    process.env.ALPACA_ENDPOINT = 'https://api.alpaca.markets';
    process.env.ALPACA_ALLOW_LIVE_TRADING = '1';
    expect(getAlpacaTradingClient()).toBeInstanceOf(AlpacaTradingClient);
  });
});

describe('AlpacaApiError', () => {
  it('carries status and truncated body', () => {
    const err = new AlpacaApiError(403, 'forbidden');
    expect(err.status).toBe(403);
    expect(err.message).toContain('403');
  });
});
