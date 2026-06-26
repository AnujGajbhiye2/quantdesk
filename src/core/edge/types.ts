import type { AssetClass } from '@/core/types';

/**
 * Backtested edge of a strategy over a scope:
 *   scope 'sym:AAPL'     - one strategy on one symbol
 *   scope 'class:equity' - pooled trades across an asset class
 *   scope 'global'       - pooled trades across the whole universe
 *
 * scope is non-null so it can live in a PRIMARY KEY (SQLite treats NULLs
 * as distinct in unique constraints, which would break upserts).
 */
export interface EdgeStats {
  strategyId: string;
  scope: string;
  symbol: string | null;
  assetClass: AssetClass | null;
  /** 0..1, closed trades in the tested window. */
  winRate: number;
  avgWinPct: number;
  avgLossPct: number;
  /** Gross wins / gross losses, capped at 9999 when there are no losses. */
  profitFactor: number;
  numTrades: number;
  /** Median holdingBars of winning trades; 0 when there are no winners. */
  medianWinHoldBars: number;
  testedFrom: string;
  testedTo: string;
  computedAt: string;
}

export function symScope(symbol: string): string {
  return `sym:${symbol}`;
}

export function classScope(assetClass: AssetClass): string {
  return `class:${assetClass}`;
}

export const GLOBAL_SCOPE = 'global';

/**
 * Scope for a per-market aggregate (e.g. 'market:nse', 'market:eu', 'market:sp500').
 * Pools all trades from that market's universe for the strategy.
 */
export function marketScope(market: string): string {
  return `market:${market}`;
}
