/**
 * Real-time market data streaming interface - RESERVED, not yet implemented.
 *
 * On the Algo Trader Plus plan Alpaca offers websocket streaming with
 * unlimited symbols (free tier: 30 symbols, IEX only). This interface fixes
 * the contract now so the future implementation slots in without touching
 * callers. Gate the eventual implementation behind ALPACA_STREAM_ENABLED=1.
 */

import type { Bar } from '@/core/types';

export interface MarketStream {
  /** Subscribe to bar updates (e.g. 1-minute aggregates) for the given symbols. */
  subscribeBars(symbols: string[], onBar: (symbol: string, bar: Bar) => void): void;
  /** Subscribe to quote/trade price ticks for the given symbols. */
  subscribeQuotes(
    symbols: string[],
    onQuote: (symbol: string, price: number, time: string) => void,
  ): void;
  /** Close the underlying connection and drop all subscriptions. */
  close(): Promise<void>;
}
