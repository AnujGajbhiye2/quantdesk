/**
 * Alpaca Trading API client (paper account follower orders).
 *
 * Talks to the Trading API at ALPACA_ENDPOINT (default paper endpoint) -
 * separate from the Data API used by core/data/providers/alpaca.ts, but the
 * same account, keys, and request budget (shared rate limiter).
 *
 * SAFETY: getAlpacaTradingClient() refuses any non-paper endpoint unless
 * ALPACA_ALLOW_LIVE_TRADING=1 is explicitly set. Real-money routing is out
 * of scope; flipping to live must be a deliberate two-env change.
 */

import { z } from 'zod';
import { alpacaEnv, isPaperEndpoint } from './alpaca-env';
import { alpacaLimiter, type SlidingWindowLimiter } from './rate-limiter';

// ---------------------------------------------------------------------------
// Request/response types
// ---------------------------------------------------------------------------

export interface AlpacaOrderRequest {
  symbol: string;
  /** Fractional allowed for buys; Alpaca rejects fractional short sells. */
  qty: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  /** 'day' during RTH, 'opg' (market-on-open) after hours, 'gtc' for resting. */
  timeInForce: 'day' | 'gtc' | 'opg';
  limitPrice?: number;
  /** Idempotency key - Alpaca rejects duplicates with 422. */
  clientOrderId?: string;
}

const coerceNum = z.union([z.string(), z.number()]).transform((v) => Number(v));
const coerceNumNullable = z
  .union([z.string(), z.number()])
  .nullable()
  .optional()
  .transform((v) => (v === null || v === undefined ? null : Number(v)));

const AlpacaOrderSchema = z.object({
  id: z.string(),
  client_order_id: z.string(),
  symbol: z.string(),
  side: z.string(),
  qty: coerceNumNullable,
  notional: coerceNumNullable,
  status: z.string(),
  filled_qty: coerceNum.default(0),
  filled_avg_price: coerceNumNullable,
  submitted_at: z.string(),
  filled_at: z.string().nullable().optional(),
});

export interface AlpacaOrder {
  id: string;
  clientOrderId: string;
  symbol: string;
  side: string;
  qty: number | null;
  notional: number | null;
  status: string;
  filledQty: number;
  filledAvgPrice: number | null;
  submittedAt: string;
  filledAt: string | null;
}

function toOrder(raw: z.infer<typeof AlpacaOrderSchema>): AlpacaOrder {
  return {
    id: raw.id,
    clientOrderId: raw.client_order_id,
    symbol: raw.symbol,
    side: raw.side,
    qty: raw.qty ?? null,
    notional: raw.notional ?? null,
    status: raw.status,
    filledQty: raw.filled_qty,
    filledAvgPrice: raw.filled_avg_price ?? null,
    submittedAt: raw.submitted_at,
    filledAt: raw.filled_at ?? null,
  };
}

const AlpacaPositionSchema = z.object({
  symbol: z.string(),
  qty: coerceNum,
  side: z.enum(['long', 'short']),
  avg_entry_price: coerceNum,
  market_value: coerceNum,
});

export interface AlpacaPosition {
  symbol: string;
  qty: number;
  side: 'long' | 'short';
  avgEntryPrice: number;
  marketValue: number;
}

const AlpacaAccountSchema = z.object({
  id: z.string(),
  status: z.string(),
  equity: coerceNum,
  cash: coerceNum,
  buying_power: coerceNum,
  currency: z.string(),
});

export interface AlpacaAccount {
  id: string;
  status: string;
  equity: number;
  cash: number;
  buyingPower: number;
  currency: string;
}

/** Error carrying the HTTP status so callers can branch on 404/422/403. */
export class AlpacaApiError extends Error {
  constructor(
    public readonly status: number,
    body: string,
  ) {
    super(`Alpaca Trading API error ${status}: ${body.slice(0, 200)}`);
    this.name = 'AlpacaApiError';
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

interface AlpacaTradingClientOptions {
  keyId: string;
  secretKey: string;
  /** Base URL WITHOUT /v2 suffix, e.g. https://paper-api.alpaca.markets */
  baseUrl: string;
  maxRetries?: number;
  limiter?: SlidingWindowLimiter;
}

export class AlpacaTradingClient {
  private readonly keyId: string;
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly limiter?: SlidingWindowLimiter;

  constructor(opts: AlpacaTradingClientOptions) {
    this.keyId = opts.keyId;
    this.secretKey = opts.secretKey;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.maxRetries = opts.maxRetries ?? 3;
    this.limiter = opts.limiter;
  }

  private async apiFetch(
    path: string,
    init: { method?: string; body?: unknown } = {},
    attempt = 0,
  ): Promise<unknown> {
    await this.limiter?.acquire();
    const resp = await fetch(`${this.baseUrl}/v2${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'APCA-API-KEY-ID': this.keyId,
        'APCA-API-SECRET-KEY': this.secretKey,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });

    if (resp.status === 429 || resp.status >= 500) {
      if (attempt < this.maxRetries) {
        const delay = Math.min(1000 * 2 ** attempt, 10_000);
        await new Promise((r) => setTimeout(r, delay));
        return this.apiFetch(path, init, attempt + 1);
      }
    }

    if (resp.status === 204) return null;

    if (!resp.ok) {
      let body = '';
      try { body = await resp.text(); } catch { /* ignore */ }
      throw new AlpacaApiError(resp.status, body);
    }

    return resp.json() as unknown;
  }

  async getAccount(): Promise<AlpacaAccount> {
    const raw = AlpacaAccountSchema.parse(await this.apiFetch('/account'));
    return {
      id: raw.id,
      status: raw.status,
      equity: raw.equity,
      cash: raw.cash,
      buyingPower: raw.buying_power,
      currency: raw.currency,
    };
  }

  async submitOrder(req: AlpacaOrderRequest): Promise<AlpacaOrder> {
    const body: Record<string, unknown> = {
      symbol: req.symbol,
      qty: String(req.qty),
      side: req.side,
      type: req.type,
      time_in_force: req.timeInForce,
    };
    if (req.limitPrice !== undefined) body.limit_price = String(req.limitPrice);
    if (req.clientOrderId !== undefined) body.client_order_id = req.clientOrderId;
    const raw = await this.apiFetch('/orders', { method: 'POST', body });
    return toOrder(AlpacaOrderSchema.parse(raw));
  }

  async getOrder(orderId: string): Promise<AlpacaOrder> {
    const raw = await this.apiFetch(`/orders/${encodeURIComponent(orderId)}`);
    return toOrder(AlpacaOrderSchema.parse(raw));
  }

  /** Look up an order by our idempotency key. Returns null when not found. */
  async getOrderByClientOrderId(clientOrderId: string): Promise<AlpacaOrder | null> {
    try {
      const raw = await this.apiFetch(
        `/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`,
      );
      return toOrder(AlpacaOrderSchema.parse(raw));
    } catch (err) {
      if (err instanceof AlpacaApiError && err.status === 404) return null;
      throw err;
    }
  }

  /** Open (not yet filled/canceled) orders, optionally for one symbol. */
  async getOpenOrders(symbol?: string): Promise<AlpacaOrder[]> {
    const params = new URLSearchParams({ status: 'open', limit: '500' });
    if (symbol) params.set('symbols', symbol);
    const raw = await this.apiFetch(`/orders?${params}`);
    return z.array(AlpacaOrderSchema).parse(raw).map(toOrder);
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.apiFetch(`/orders/${encodeURIComponent(orderId)}`, { method: 'DELETE' });
  }

  async getPositions(): Promise<AlpacaPosition[]> {
    const raw = await this.apiFetch('/positions');
    return z.array(AlpacaPositionSchema).parse(raw).map((p) => ({
      symbol: p.symbol,
      qty: p.qty,
      side: p.side,
      avgEntryPrice: p.avg_entry_price,
      marketValue: p.market_value,
    }));
  }
}

// ---------------------------------------------------------------------------
// Factory with live-endpoint guard
// ---------------------------------------------------------------------------

/**
 * Build a trading client from env. Returns null when keys are missing.
 * Throws when the endpoint is not Alpaca's paper host and live trading has
 * not been explicitly allowed - a hard guard against accidental real-money
 * order routing.
 */
export function getAlpacaTradingClient(): AlpacaTradingClient | null {
  const cfg = alpacaEnv();
  if (!cfg.keyId || !cfg.secretKey) return null;

  if (!isPaperEndpoint(cfg.tradingBaseUrl) && !cfg.allowLiveTrading) {
    throw new Error(
      `Alpaca trading endpoint '${cfg.tradingBaseUrl}' is not the paper endpoint. ` +
      'Set ALPACA_ALLOW_LIVE_TRADING=1 only when deliberately enabling real-money trading.',
    );
  }

  return new AlpacaTradingClient({
    keyId: cfg.keyId,
    secretKey: cfg.secretKey,
    baseUrl: cfg.tradingBaseUrl,
    limiter: alpacaLimiter(),
  });
}
