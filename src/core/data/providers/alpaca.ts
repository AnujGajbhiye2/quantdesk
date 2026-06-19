/**
 * Alpaca Markets data provider.
 *
 * Serves intraday and daily OHLCV bars + live quotes for US equities.
 * Uses the Alpaca Data API v2 (IEX feed on the free tier).
 *
 * Free tier limits:
 *   - 200 req/min across all endpoints
 *   - Multi-symbol bar endpoint: up to 1 000 symbols per request
 *   - Quote/snapshot: also multi-symbol, same rate limit
 *   - No access to options or futures (gold = ETFs/miners, not GC=F)
 *
 * Required env vars:
 *   ALPACA_KEY_ID     - Alpaca API key ID
 *   ALPACA_SECRET_KEY - Alpaca API secret key
 *
 * Free account: https://alpaca.markets (no credit card, no PDT rule for paper)
 */

import type { DataProvider } from '../DataProvider';
import { validateBars, validateSymbolMetas } from '../schemas';
import type { AssetClass, Bar, SymbolMeta, Timeframe } from '@/core/types';
import { z } from 'zod';

// -------------------------------------------------------------------------
// Alpaca REST base URLs
// -------------------------------------------------------------------------
const DATA_BASE = 'https://data.alpaca.markets/v2';

// -------------------------------------------------------------------------
// Timeframe mapping: QuantDesk -> Alpaca notation
// -------------------------------------------------------------------------
const TIMEFRAME_MAP: Partial<Record<Timeframe, string>> = {
  '1m':  '1Min',
  '5m':  '5Min',
  '15m': '15Min',
  '1h':  '1Hour',
  '1d':  '1Day',
  '1wk': '1Week',
};

// -------------------------------------------------------------------------
// Zod schemas for raw Alpaca responses
// -------------------------------------------------------------------------
const AlpacaBarSchema = z.object({
  t: z.string(), // ISO timestamp
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  v: z.number(),
});

const AlpacaBarsResponseSchema = z.object({
  bars:        z.array(AlpacaBarSchema),
  next_page_token: z.string().nullable().optional(),
});

const AlpacaMultiBarsResponseSchema = z.object({
  bars:        z.record(z.string(), z.array(AlpacaBarSchema)),
  next_page_token: z.string().nullable().optional(),
});

const AlpacaSnapshotSchema = z.object({
  latestTrade: z.object({ p: z.number(), t: z.string() }).optional(),
  latestQuote: z.object({ ap: z.number().optional(), bp: z.number().optional(), t: z.string() }).optional(),
});

const AlpacaMultiSnapshotResponseSchema = z.record(z.string(), AlpacaSnapshotSchema);

// -------------------------------------------------------------------------
// Provider options
// -------------------------------------------------------------------------
interface AlpacaProviderOptions {
  keyId:     string;
  secretKey: string;
  /** Max consecutive retries on 429/5xx. Default 3. */
  maxRetries?: number;
}

// -------------------------------------------------------------------------
// Helper: map a raw Alpaca bar to a canonical Bar
// -------------------------------------------------------------------------
function toBar(raw: z.infer<typeof AlpacaBarSchema>): Bar {
  // Alpaca intraday timestamps are ISO with offset; normalise to UTC 'Z' form.
  const time = raw.t.endsWith('Z') ? raw.t : new Date(raw.t).toISOString();
  return {
    time:   time,
    open:   raw.o,
    high:   raw.h,
    low:    raw.l,
    close:  raw.c,
    volume: raw.v,
  };
}

// -------------------------------------------------------------------------
// AlpacaProvider
// -------------------------------------------------------------------------
export class AlpacaProvider implements DataProvider {
  readonly id = 'alpaca';
  readonly assetClasses: AssetClass[] = ['equity', 'commodity'];

  private readonly keyId:     string;
  private readonly secretKey: string;
  private readonly maxRetries: number;

  constructor(opts: AlpacaProviderOptions) {
    this.keyId      = opts.keyId;
    this.secretKey  = opts.secretKey;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  /** Alpaca uses standard US equity tickers; no translation needed. */
  toProviderSymbol(symbol: string): string {
    return symbol;
  }

  // -----------------------------------------------------------------------
  // Internal fetch helper with retry + auth
  // -----------------------------------------------------------------------
  private async apiFetch(url: string, attempt = 0): Promise<unknown> {
    const resp = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID':     this.keyId,
        'APCA-API-SECRET-KEY': this.secretKey,
      },
    });

    if (resp.status === 429 || resp.status >= 500) {
      if (attempt < this.maxRetries) {
        const delay = Math.min(1000 * 2 ** attempt, 10_000);
        await new Promise((r) => setTimeout(r, delay));
        return this.apiFetch(url, attempt + 1);
      }
    }

    if (!resp.ok) {
      let body = '';
      try { body = await resp.text(); } catch { /* ignore */ }
      throw new Error(`Alpaca API error ${resp.status}: ${body.slice(0, 200)}`);
    }

    return resp.json() as unknown;
  }

  // -----------------------------------------------------------------------
  // getHistory - single symbol, all pages
  // -----------------------------------------------------------------------
  async getHistory(
    symbol:    string,
    timeframe: Timeframe,
    from:      string,
    to:        string,
  ): Promise<Bar[]> {
    const tf = TIMEFRAME_MAP[timeframe];
    if (!tf) throw new Error(`Alpaca: unsupported timeframe '${timeframe}'`);

    const sym  = this.toProviderSymbol(symbol);
    const bars: Bar[] = [];
    let   pageToken: string | null | undefined = undefined;

    do {
      const params = new URLSearchParams({
        timeframe: tf,
        start:     from,
        end:       to,
        feed:      'iex',
        adjustment: 'all',
        limit:     '10000',
      });
      if (pageToken) params.set('page_token', pageToken);

      const url  = `${DATA_BASE}/stocks/${encodeURIComponent(sym)}/bars?${params}`;
      const raw  = await this.apiFetch(url);
      const data = AlpacaBarsResponseSchema.parse(raw);

      for (const b of data.bars) bars.push(toBar(b));
      pageToken = data.next_page_token ?? null;
    } while (pageToken);

    bars.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
    return validateBars(bars);
  }

  // -----------------------------------------------------------------------
  // getHistoryBatch - multiple symbols in one request (pagination-aware)
  // -----------------------------------------------------------------------
  async getHistoryBatch(
    symbols:   string[],
    timeframe: Timeframe,
    from:      string,
    to:        string,
  ): Promise<Record<string, Bar[]>> {
    const tf = TIMEFRAME_MAP[timeframe];
    if (!tf) throw new Error(`Alpaca: unsupported timeframe '${timeframe}'`);

    const result: Record<string, Bar[]> = {};
    for (const s of symbols) result[s] = [];

    // Alpaca multi-bar endpoint accepts symbols as comma-separated query param.
    // We chunk into groups of 1 000 to stay within documented limits.
    const CHUNK = 1_000;
    for (let i = 0; i < symbols.length; i += CHUNK) {
      const chunk = symbols.slice(i, i + CHUNK);
      let pageToken: string | null | undefined = undefined;

      do {
        const params = new URLSearchParams({
          symbols:    chunk.join(','),
          timeframe:  tf,
          start:      from,
          end:        to,
          feed:       'iex',
          adjustment: 'all',
          limit:      '10000',
        });
        if (pageToken) params.set('page_token', pageToken);

        const url  = `${DATA_BASE}/stocks/bars?${params}`;
        const raw  = await this.apiFetch(url);
        const data = AlpacaMultiBarsResponseSchema.parse(raw);

        for (const [sym, rawBars] of Object.entries(data.bars)) {
          if (!result[sym]) result[sym] = [];
          for (const b of rawBars) result[sym].push(toBar(b));
        }
        pageToken = data.next_page_token ?? null;
      } while (pageToken);
    }

    // Sort and validate each symbol's bars
    for (const sym of Object.keys(result)) {
      result[sym].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
      result[sym] = validateBars(result[sym]);
    }

    return result;
  }

  // -----------------------------------------------------------------------
  // getQuote - latest trade price via multi-snapshot endpoint
  // -----------------------------------------------------------------------
  async getQuote(symbol: string): Promise<{ price: number; time: string } | null> {
    const sym = this.toProviderSymbol(symbol);
    try {
      const url = `${DATA_BASE}/stocks/snapshots?symbols=${encodeURIComponent(sym)}&feed=iex`;
      const raw = await this.apiFetch(url);
      const data = AlpacaMultiSnapshotResponseSchema.safeParse(raw);
      if (!data.success) return null;

      const snap = data.data[sym];
      if (!snap) return null;

      // Prefer latestTrade price; fall back to mid-quote
      if (snap.latestTrade && snap.latestTrade.p > 0) {
        return { price: snap.latestTrade.p, time: snap.latestTrade.t };
      }
      if (snap.latestQuote) {
        const mid = ((snap.latestQuote.ap ?? 0) + (snap.latestQuote.bp ?? 0)) / 2;
        if (mid > 0) return { price: mid, time: snap.latestQuote.t };
      }
    } catch {
      // network/parse error - return null so upstream handles gracefully
    }
    return null;
  }

  // -----------------------------------------------------------------------
  // search - basic symbol lookup (equity only on free tier)
  // -----------------------------------------------------------------------
  async search(query: string): Promise<SymbolMeta[]> {
    // Alpaca does not have a dedicated search endpoint on the free tier;
    // they expose assets list. For now we skip to keep the adapter simple.
    void query;
    return validateSymbolMetas([]);
  }
}
