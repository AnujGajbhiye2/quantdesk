/**
 * Yahoo Finance data adapter.
 *
 * Uses the unofficial `yahoo-finance2` npm package.
 * - No API key required.
 * - No formal SLA; Yahoo may rate-limit or break endpoints without notice.
 * - Free for personal/non-commercial use; respect Yahoo's terms of service.
 *
 * Rate limits: unofficial; best-effort. Built-in exponential back-off on 429/5xx.
 * Recommended: keep daily bulk ingests to a few hundred symbols; use refresh for incremental.
 */

import YahooFinance from 'yahoo-finance2';

// yahoo-finance2 v3 changed the default export to the class constructor.
// Must instantiate before calling any methods.
const yahooFinance = new YahooFinance();
import type { DataProvider, Fundamentals, NewsItem } from '../DataProvider';
import { validateBars, validateSymbolMetas, validateNewsItems, FundamentalsSchema } from '../schemas';
import type { AssetClass, Bar, SymbolMeta, Timeframe } from '@/core/types';

// Local type aliases for yahoo-finance2 chart internals.
// The full union is taken from yahoo-finance2's ChartOptions.interval type definition.
type YFInterval =
  | '1m' | '2m' | '5m' | '15m' | '30m' | '60m' | '90m' | '1h'
  | '1d' | '5d' | '1wk' | '1mo' | '3mo';

interface YFChartQuote {
  date: Date | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  /**
   * Split/dividend-adjusted close. Used to scale OHLC to an adjusted series so
   * Yahoo-sourced bars match Alpaca's `adjustment: 'all'` series - without this,
   * a split on a Yahoo-sourced symbol injects a raw price gap that looks like a
   * real move to every strategy and backtest.
   */
  adjclose: number | null;
}

interface YFChartResult {
  quotes: YFChartQuote[];
}

interface YFQuote {
  regularMarketPrice?: number | null;
  regularMarketTime?: Date | number | null;
}

interface YFSearchQuote {
  symbol?: string | null;
  shortname?: string | null;
  longname?: string | null;
  quoteType?: string | null;
  currency?: string | null;
  exchange?: string | null;
}

interface YFSearchResult {
  quotes?: YFSearchQuote[];
}

// Map our Timeframe enum to yahoo-finance2 interval strings.
const INTERVAL_MAP: Record<Timeframe, YFInterval> = {
  '1m':  '1m',
  '5m':  '5m',
  '15m': '15m',
  '1h':  '60m',
  '1d':  '1d',
  '1wk': '1wk',
};

interface YahooProviderOptions {
  /** Max number of retries on transient errors. Default 3. */
  maxRetries?: number;
  /** Base delay ms for exponential back-off. Default 500. */
  retryBaseMs?: number;
}

/** Pause for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Format a JS Date as 'YYYY-MM-DD' (UTC). */
function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export class YahooProvider implements DataProvider {
  readonly id = 'yahoo';
  readonly assetClasses: AssetClass[] = [
    'equity',
    'index',
    'forex',
    'crypto',
    'commodity',
  ];

  private readonly maxRetries: number;
  private readonly retryBaseMs: number;

  constructor(opts: YahooProviderOptions = {}) {
    this.maxRetries = opts.maxRetries ?? 3;
    this.retryBaseMs = opts.retryBaseMs ?? 500;
  }

  /**
   * Yahoo uses the same symbol notation for most US equities.
   * For ADRs, forex, or indices the caller should pass the Yahoo-style symbol directly
   * (e.g. 'EURUSD=X', '^GSPC'). Override here when canonical != Yahoo symbol.
   *
   * Class-share tickers use dot notation in the canonical universe (e.g. BRK.B, BF.B)
   * but Yahoo expects a hyphen (BRK-B, BF-B). Map trailing .<UPPER> to -<UPPER>.
   */
  toProviderSymbol(symbol: string): string {
    // BRK.B -> BRK-B, BF.B -> BF-B  (only trailing single-letter class suffix)
    return symbol.replace(/\.([A-Z])$/, '-$1');
  }

  async getHistory(
    symbol: string,
    timeframe: Timeframe,
    from: string,
    to: string,
  ): Promise<Bar[]> {
    const interval = INTERVAL_MAP[timeframe];
    const providerSym = this.toProviderSymbol(symbol);

    // Cast through unknown - yahoo-finance2 chart() is heavily overloaded and
    // the return type can't be inferred without importing internal module paths.
    // The local YFChartResult interface mirrors the ChartResultArray shape we use.
    const raw = await this._withRetry(() =>
      yahooFinance.chart(providerSym, {
        period1: from,
        period2: to,
        interval,
        return: 'array',
      } as Parameters<typeof yahooFinance.chart>[1]),
    ) as unknown as YFChartResult;

    // chart() with return:'array' has result.quotes
    const quotes = raw?.quotes ?? [];

    const bars: Bar[] = [];
    for (const q of quotes) {
      // Skip bars with null/undefined OHLCV (Yahoo sometimes returns sparse data)
      if (
        q.open == null ||
        q.high == null ||
        q.low == null ||
        q.close == null ||
        q.volume == null ||
        q.date == null
      ) {
        continue;
      }

      const dateStr =
        timeframe === '1d' || timeframe === '1wk'
          ? toDateString(q.date)
          : q.date.toISOString(); // full ISO for intraday

      // Split/dividend adjustment: scale raw OHLC by adjclose/close so the stored
      // series matches Alpaca's `adjustment: 'all'` series. Without this, a split
      // on a Yahoo-sourced symbol shows up as a raw price gap in the stored bars -
      // false stop-outs, false breakout signals, distorted backtests. Indices/forex/
      // crypto have no adjclose (or adjclose === close); the ratio is then 1 (no-op).
      const adjRatio =
        q.adjclose != null && q.close > 0 ? q.adjclose / q.close : 1;

      // Clamp high/low to enforce OHLC integrity.
      // Yahoo forex data occasionally returns bars where low > open or low > close
      // by small floating-point amounts (bid/ask rounding). Conservative fix:
      // treat max(open, high, close) as high and min(open, low, close) as low.
      const rawOpen  = q.open;
      const rawClose = q.close;
      const rawHigh  = Math.max(q.high, rawOpen, rawClose);
      const rawLow   = Math.min(q.low,  rawOpen, rawClose);

      const open  = rawOpen  * adjRatio;
      const high  = rawHigh  * adjRatio;
      const low   = rawLow   * adjRatio;
      const close = rawClose * adjRatio;

      bars.push({
        time: dateStr,
        open,
        high,
        low,
        close,
        volume: q.volume,
      });
    }

    // Ensure ascending order (Yahoo normally does this, but sort defensively)
    bars.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));

    // Validate every bar with our shared schema before returning
    return validateBars(bars, `${symbol}/${timeframe}`);
  }

  async getQuote(
    symbol: string,
  ): Promise<{ price: number; time: string } | null> {
    const providerSym = this.toProviderSymbol(symbol);

    try {
      const q = await this._withRetry(() =>
        yahooFinance.quote(providerSym),
      ) as unknown as YFQuote | null;
      if (!q || q.regularMarketPrice == null) return null;
      const time =
        q.regularMarketTime != null
          ? q.regularMarketTime instanceof Date
            ? q.regularMarketTime.toISOString()
            : new Date(q.regularMarketTime * 1000).toISOString()
          : new Date().toISOString();
      return { price: q.regularMarketPrice, time };
    } catch {
      return null;
    }
  }

  async search(query: string): Promise<SymbolMeta[]> {
    const results = await this._withRetry(() =>
      yahooFinance.search(query),
    ) as unknown as YFSearchResult;

    const quotes = results?.quotes ?? [];
    const metas: SymbolMeta[] = [];

    for (const r of quotes) {
      if (!r.symbol) continue;
      metas.push({
        symbol: r.symbol,
        providerSymbol: r.symbol,
        name: r.shortname ?? r.longname ?? r.symbol,
        assetClass: mapQuoteType(r.quoteType ?? undefined),
        currency: r.currency ?? 'USD',
        exchange: r.exchange ?? undefined,
        providerId: this.id,
      });
    }

    return validateSymbolMetas(metas);
  }

  async getFundamentals(symbol: string): Promise<Fundamentals | null> {
    const providerSym = this.toProviderSymbol(symbol);
    let qs: Record<string, Record<string, unknown> | undefined>;
    try {
      qs = await this._withRetry(() =>
        yahooFinance.quoteSummary(providerSym, {
          modules: ['summaryDetail', 'defaultKeyStatistics', 'financialData'],
        }),
      ) as Record<string, Record<string, unknown> | undefined>;
    } catch {
      return null; // unknown symbol or module unavailable - dossier degrades gracefully
    }

    const sd = qs.summaryDetail ?? {};
    const ks = qs.defaultKeyStatistics ?? {};
    const fd = qs.financialData ?? {};
    const num = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? v : null;

    const raw: Fundamentals = {
      symbol,
      trailingPE:       num(sd.trailingPE),
      forwardPE:        num(sd.forwardPE),
      marketCap:        num(sd.marketCap),
      epsGrowth:        num(ks.earningsQuarterlyGrowth),
      profitMargin:     num(fd.profitMargins),
      revenueGrowth:    num(fd.revenueGrowth),
      fiftyTwoWeekLow:  num(sd.fiftyTwoWeekLow),
      fiftyTwoWeekHigh: num(sd.fiftyTwoWeekHigh),
      recommendation:   typeof fd.recommendationKey === 'string' ? fd.recommendationKey : null,
      targetMeanPrice:  num(fd.targetMeanPrice),
    };
    const parsed = FundamentalsSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  async getNews(symbol: string, count = 8): Promise<NewsItem[]> {
    const providerSym = this.toProviderSymbol(symbol);
    let result: { news?: Array<Record<string, unknown>> };
    try {
      result = await this._withRetry(() =>
        yahooFinance.search(providerSym, { newsCount: count }),
      ) as { news?: Array<Record<string, unknown>> };
    } catch {
      return [];
    }

    const items = (result.news ?? []).map((n) => ({
      title:       typeof n.title === 'string' ? n.title : '',
      publisher:   typeof n.publisher === 'string' ? n.publisher : '',
      publishedAt: n.providerPublishTime instanceof Date
        ? n.providerPublishTime.toISOString()
        : typeof n.providerPublishTime === 'number'
          ? new Date(n.providerPublishTime * 1000).toISOString()
          : '',
      link:        typeof n.link === 'string' ? n.link : '',
    }));
    return validateNewsItems(items).slice(0, count);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async _withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (attempt < this.maxRetries) {
          const delay = this.retryBaseMs * 2 ** attempt;
          await sleep(delay);
        }
      }
    }
    throw lastErr;
  }
}

function mapQuoteType(
  quoteType: string | undefined,
): AssetClass {
  switch (quoteType) {
    case 'EQUITY':       return 'equity';
    case 'ETF':          return 'equity';  // treat ETFs as equity for now
    case 'INDEX':        return 'index';
    case 'CURRENCY':     return 'forex';
    case 'CRYPTOCURRENCY': return 'crypto';
    case 'FUTURE':       return 'commodity';
    default:             return 'equity';
  }
}
