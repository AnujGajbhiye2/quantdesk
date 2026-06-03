/**
 * Twelve Data adapter.
 *
 * https://twelvedata.com/docs
 *
 * Rate limits (free tier - requires a free API key at twelvedata.com):
 *   - 8 API credits/minute
 *   - 800 API credits/day
 *   - 1 credit per /time_series call
 *
 * Supported asset classes: equities (US + global), ETFs, forex, crypto, indices.
 * India: use symbol notation like "TCS:NSE" or just "TCS" with exchange="NSE".
 *
 * Set TWELVE_DATA_API_KEY in .env.local to enable this provider.
 */

import type { DataProvider } from '../DataProvider';
import { validateBars, validateSymbolMetas } from '../schemas';
import type { AssetClass, Bar, SymbolMeta, Timeframe } from '@/core/types';

// Twelve Data interval strings
type TDInterval = '1min' | '5min' | '15min' | '30min' | '1h' | '1day' | '1week';

const INTERVAL_MAP: Record<Timeframe, TDInterval> = {
  '1m':  '1min',
  '5m':  '5min',
  '15m': '15min',
  '1h':  '1h',
  '1d':  '1day',
  '1wk': '1week',
};

const BASE_URL = 'https://api.twelvedata.com';

interface TDBar {
  datetime: string;
  open:     string;
  high:     string;
  low:      string;
  close:    string;
  volume:   string;
}

interface TDTimeSeriesResponse {
  status?: string;
  code?:   number;
  message?: string;
  values?: TDBar[];
}

interface TDQuoteResponse {
  status?:  string;
  code?:    number;
  price?:   string;
  datetime?: string;
}

interface TDSearchItem {
  symbol:     string;
  instrument_name: string;
  exchange?:  string;
  currency?:  string;
  instrument_type?: string;
}

interface TDSearchResponse {
  status?: string;
  data?:   TDSearchItem[];
}

interface TwelveDataProviderOptions {
  apiKey:       string;
  /** Max retries on transient errors. Default 3. */
  maxRetries?:  number;
  /** Base delay ms for exponential back-off. Default 500. */
  retryBaseMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class TwelveDataProvider implements DataProvider {
  readonly id = 'twelve-data';
  readonly assetClasses: AssetClass[] = ['equity', 'forex', 'crypto', 'index', 'commodity'];

  private readonly apiKey:      string;
  private readonly maxRetries:  number;
  private readonly retryBaseMs: number;

  constructor(opts: TwelveDataProviderOptions) {
    this.apiKey      = opts.apiKey;
    this.maxRetries  = opts.maxRetries  ?? 3;
    this.retryBaseMs = opts.retryBaseMs ?? 500;
  }

  /**
   * Twelve Data uses the same symbol notation for most US stocks.
   * For Indian NSE stocks use the Yahoo .NS suffix convention; strip it here
   * and pass exchange=NSE separately via the URL.
   * e.g. "TCS.NS" -> symbol="TCS", we add &exchange=NSE
   */
  toProviderSymbol(symbol: string): string {
    // Strip Yahoo-style suffix for Twelve Data; the exchange is passed separately.
    if (symbol.endsWith('.NS')) return symbol.slice(0, -3);
    if (symbol.endsWith('.BO')) return symbol.slice(0, -3);
    return symbol;
  }

  private exchangeParam(symbol: string): string {
    if (symbol.endsWith('.NS')) return '&exchange=NSE';
    if (symbol.endsWith('.BO')) return '&exchange=BSE';
    return '';
  }

  async getHistory(
    symbol:    string,
    timeframe: Timeframe,
    from:      string,
    to:        string,
  ): Promise<Bar[]> {
    const providerSym = this.toProviderSymbol(symbol);
    const interval    = INTERVAL_MAP[timeframe];
    const exchange    = this.exchangeParam(symbol);

    // Twelve Data returns max 5000 rows per call. For a full history ingest,
    // the poller handles pagination by making multiple date-ranged calls.
    const url = `${BASE_URL}/time_series?symbol=${encodeURIComponent(providerSym)}&interval=${interval}&start_date=${from}&end_date=${to}&outputsize=5000&format=JSON&apikey=${this.apiKey}${exchange}`;

    const raw = await this._withRetry(() =>
      fetch(url).then((r) => r.json() as Promise<TDTimeSeriesResponse>),
    );

    if (raw.code && raw.code !== 200) {
      throw new Error(`Twelve Data error ${raw.code}: ${raw.message ?? 'unknown'}`);
    }

    const values = raw.values ?? [];

    const bars: Bar[] = [];
    for (const v of values) {
      const open   = parseFloat(v.open);
      const high   = parseFloat(v.high);
      const low    = parseFloat(v.low);
      const close  = parseFloat(v.close);
      const volume = parseFloat(v.volume) || 0;

      if (!isFinite(open) || !isFinite(high) || !isFinite(low) || !isFinite(close)) continue;

      // Twelve Data returns ISO date strings; daily = 'YYYY-MM-DD'
      bars.push({ time: v.datetime, open, high, low, close, volume });
    }

    // Twelve Data returns newest-first; reverse to ascending
    bars.reverse();

    return validateBars(bars);
  }

  async getQuote(symbol: string): Promise<{ price: number; time: string } | null> {
    const providerSym = this.toProviderSymbol(symbol);
    const exchange    = this.exchangeParam(symbol);
    const url = `${BASE_URL}/price?symbol=${encodeURIComponent(providerSym)}&apikey=${this.apiKey}${exchange}`;

    try {
      const raw = await this._withRetry(() =>
        fetch(url).then((r) => r.json() as Promise<TDQuoteResponse>),
      );
      if (!raw.price) return null;
      const price = parseFloat(raw.price);
      if (!isFinite(price)) return null;
      return { price, time: raw.datetime ?? new Date().toISOString() };
    } catch {
      return null;
    }
  }

  async search(query: string): Promise<SymbolMeta[]> {
    const url = `${BASE_URL}/symbol_search?symbol=${encodeURIComponent(query)}&outputsize=12&apikey=${this.apiKey}`;

    const raw = await this._withRetry(() =>
      fetch(url).then((r) => r.json() as Promise<TDSearchResponse>),
    );

    const data = raw.data ?? [];
    const metas: SymbolMeta[] = [];

    for (const item of data) {
      if (!item.symbol) continue;
      metas.push({
        symbol:         item.symbol,
        providerSymbol: item.symbol,
        name:           item.instrument_name ?? item.symbol,
        assetClass:     mapInstrumentType(item.instrument_type),
        currency:       item.currency ?? 'USD',
        exchange:       item.exchange,
        providerId:     this.id,
      });
    }

    return validateSymbolMetas(metas);
  }

  private async _withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (attempt < this.maxRetries) {
          await sleep(this.retryBaseMs * 2 ** attempt);
        }
      }
    }
    throw lastErr;
  }
}

function mapInstrumentType(type: string | undefined): AssetClass {
  switch ((type ?? '').toLowerCase()) {
    case 'common stock':
    case 'etf':
    case 'depositary receipt':
      return 'equity';
    case 'forex':
    case 'fx':
      return 'forex';
    case 'cryptocurrency':
    case 'digital currency':
      return 'crypto';
    case 'index':
      return 'index';
    case 'commodity':
      return 'commodity';
    default:
      return 'equity';
  }
}
