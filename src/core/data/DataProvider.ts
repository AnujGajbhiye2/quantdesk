import type { AssetClass, Bar, SymbolMeta, Timeframe } from '@/core/types';

/**
 * Fundamentals snapshot for the decision dossier. All fields nullable -
 * indices, crypto and thin tickers simply lack them.
 */
export interface Fundamentals {
  symbol: string;
  trailingPE: number | null;
  forwardPE: number | null;
  marketCap: number | null;
  /** Year-over-year quarterly earnings growth, fraction (0.5 = +50%). */
  epsGrowth: number | null;
  /** Net profit margin, fraction. */
  profitMargin: number | null;
  /** Revenue growth, fraction. */
  revenueGrowth: number | null;
  fiftyTwoWeekLow: number | null;
  fiftyTwoWeekHigh: number | null;
  /** Provider analyst consensus, e.g. 'buy', 'strong_buy', 'hold'. */
  recommendation: string | null;
  /** Provider analyst mean price target. */
  targetMeanPrice: number | null;
}

export interface NewsItem {
  title: string;
  publisher: string;
  /** ISO timestamp. */
  publishedAt: string;
  link: string;
}

/**
 * The contract every data adapter must implement.
 *
 * Rules for adapter authors:
 * - Translate provider responses into Bar/SymbolMeta only. No business logic. No DB writes.
 * - Validate all outputs with BarSchema / SymbolMetaSchema (see schemas.ts) before returning.
 * - Handle rate-limiting and retries internally (configurable via constructor options).
 * - Document provider-specific limits and caveats in the file header.
 *
 * Adding a new provider:
 * 1. Copy providers/_template.ts -> providers/your-provider.ts
 * 2. Implement the required methods below.
 * 3. Add API key(s) to .env.local.example.
 * 4. Add one line to registry.ts. That is it.
 */
export interface DataProvider {
  /** Unique provider identifier, e.g. 'yahoo', 'dhan', 'oanda', 'metals-api'. */
  readonly id: string;

  /** Asset classes this provider can serve. */
  readonly assetClasses: AssetClass[];

  /**
   * Map a canonical internal symbol (e.g. 'NVDA', 'EURUSD') to the provider-specific
   * symbol string. Override in the adapter if the provider uses different notation.
   */
  toProviderSymbol(symbol: string): string;

  /**
   * Fetch historical OHLCV bars for a symbol.
   * - MUST return bars sorted ascending by time (oldest first).
   * - Times must be UTC. Daily bars use 'YYYY-MM-DD'; intraday bars use full ISO timestamp.
   * - Gaps (weekends, holidays) are allowed; do not fill synthetic bars.
   * - Validate output with BarSchema before returning.
   */
  getHistory(
    symbol: string,
    timeframe: Timeframe,
    from: string,
    to: string,
  ): Promise<Bar[]>;

  /**
   * Optional: latest quote / snapshot for live-ish price marks.
   * Returns null if the provider does not support quotes or the symbol is unknown.
   */
  getQuote?(symbol: string): Promise<{ price: number; time: string } | null>;

  /**
   * Optional: search / lookup symbols supported by this provider.
   * Used for the symbol-switcher UI and ingest helper.
   */
  search?(query: string): Promise<SymbolMeta[]>;

  /**
   * Optional: fundamentals snapshot for the decision dossier.
   * Returns null when the provider has no data for the symbol.
   * Validate with FundamentalsSchema before returning.
   */
  getFundamentals?(symbol: string): Promise<Fundamentals | null>;

  /**
   * Optional: recent news headlines for the decision dossier.
   * Returns [] when unavailable. Validate with NewsItemSchema before returning.
   */
  getNews?(symbol: string, count?: number): Promise<NewsItem[]>;

  /**
   * Optional: fetch bars for multiple symbols in a single API call.
   * Keyed by canonical symbol string. Providers that support batch should
   * implement this for efficiency (avoids per-symbol rate-limit overhead).
   * Falls back to individual getHistory calls when absent.
   */
  getHistoryBatch?(
    symbols: string[],
    timeframe: Timeframe,
    from: string,
    to: string,
  ): Promise<Record<string, Bar[]>>;
}
