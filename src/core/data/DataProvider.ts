import type { AssetClass, Bar, SymbolMeta, Timeframe } from '@/core/types';

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
}
