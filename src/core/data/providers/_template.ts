/**
 * QuantDesk data provider template.
 *
 * HOW TO ADD A NEW PROVIDER (three steps):
 * ─────────────────────────────────────────
 * 1. Copy this file to providers/your-provider.ts and implement the methods below.
 * 2. Add any required API key to .env.local.example and document the free-tier limits.
 * 3. Add one line to registry.ts:  register(new YourProvider({ apiKey: process.env.YOUR_KEY! }));
 *
 * That is it. Nothing else in the codebase needs to change.
 *
 * RULES FOR ADAPTER AUTHORS:
 * - Only translate provider responses into Bar / SymbolMeta. No business logic. No DB writes.
 * - Call validateBars() / validateSymbolMetas() (schemas.ts) before returning data.
 * - Handle retries and rate-limiting inside this file.
 * - Document provider-specific rate limits in this header.
 * - Use toProviderSymbol() to translate canonical symbols if the provider uses different notation.
 * - Throw informative errors; they surface in the UI status bar.
 *
 * RATE LIMIT EXAMPLE (fill in for your provider):
 * - Free tier: X requests/minute, Y requests/day
 * - Paid tier: Z requests/minute
 */

import type { DataProvider } from '../DataProvider';
import { validateBars, validateSymbolMetas } from '../schemas';
import type { AssetClass, Bar, SymbolMeta, Timeframe } from '@/core/types';

interface TemplateProviderOptions {
  apiKey: string;
  /** Max retries on transient errors. Default 3. */
  maxRetries?: number;
}

export class TemplateProvider implements DataProvider {
  // Change this to your provider's unique id, e.g. 'dhan', 'polygon', 'oanda'.
  readonly id = 'template';

  // List the asset classes your provider can serve.
  readonly assetClasses: AssetClass[] = ['equity'];

  private readonly apiKey: string;
  private readonly maxRetries: number;

  constructor(opts: TemplateProviderOptions) {
    this.apiKey = opts.apiKey;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  /**
   * Translate a canonical symbol (e.g. 'NVDA') to your provider's notation.
   * If they match, just return the symbol unchanged.
   */
  toProviderSymbol(symbol: string): string {
    // TODO: add mappings if needed, e.g. 'EURUSD' -> 'EUR_USD'
    return symbol;
  }

  /**
   * Fetch historical OHLCV bars for a symbol.
   * - Must return bars sorted ascending by time (oldest first).
   * - Daily: time = 'YYYY-MM-DD'. Intraday: full ISO UTC timestamp.
   * - Skip bars with null/undefined OHLCV values.
   * - Call validateBars() before returning.
   */
  async getHistory(
    symbol: string,
    timeframe: Timeframe,
    from: string,
    to: string,
  ): Promise<Bar[]> {
    const providerSym = this.toProviderSymbol(symbol);

    // TODO: call your provider's API here
    // Example:
    // const raw = await fetch(`https://api.example.com/v1/bars?symbol=${providerSym}&from=${from}&to=${to}&interval=${timeframe}`, {
    //   headers: { 'Authorization': `Bearer ${this.apiKey}` },
    // }).then(r => r.json());

    const bars: Bar[] = [];

    // TODO: map raw response rows into Bar objects
    // for (const item of raw.bars) {
    //   bars.push({
    //     time: item.date,   // must be 'YYYY-MM-DD' for daily
    //     open: item.open,
    //     high: item.high,
    //     low: item.low,
    //     close: item.close,
    //     volume: item.volume,
    //   });
    // }

    bars.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));

    // Validate before returning - malformed bars are dropped (quarantined) and
    // logged, not thrown; pass a context string so quarantine logs are traceable.
    return validateBars(bars, `${symbol}/${timeframe}`);

    void providerSym; // remove this line once you use providerSym above
  }

  /**
   * Optional: latest quote / snapshot for live-ish marks.
   * Remove this method entirely if your provider does not support quotes.
   */
  async getQuote(
    symbol: string,
  ): Promise<{ price: number; time: string } | null> {
    const providerSym = this.toProviderSymbol(symbol);

    // TODO: call your provider's quote endpoint
    // const raw = await ...

    // Return null if unavailable
    void providerSym; // remove this line once you use providerSym above
    return null;
  }

  /**
   * Optional: search / lookup symbols supported by this provider.
   * Remove this method entirely if your provider does not support search.
   */
  async search(query: string): Promise<SymbolMeta[]> {
    // TODO: call your provider's search endpoint
    // const raw = await ...

    const metas: SymbolMeta[] = [];

    // TODO: map raw results into SymbolMeta objects
    // for (const item of raw.results) {
    //   metas.push({
    //     symbol: item.ticker,
    //     providerSymbol: item.ticker,
    //     name: item.name,
    //     assetClass: 'equity',
    //     currency: item.currency ?? 'USD',
    //     exchange: item.exchange,
    //     providerId: this.id,
    //   });
    // }

    void query; // remove this line once you use query above
    return validateSymbolMetas(metas);
  }
}
