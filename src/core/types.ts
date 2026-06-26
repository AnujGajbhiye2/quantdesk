// A single OHLCV bar. time is a UTC ISO date string 'YYYY-MM-DD' for daily,
// or full ISO timestamp for intraday. Always store/compute in UTC; only format
// to the user's timezone (Europe/Dublin) at the view layer.
export interface Bar {
  time: string; // ISO; daily = 'YYYY-MM-DD'
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type AssetClass = 'equity' | 'forex' | 'crypto' | 'commodity' | 'index';
export type Timeframe = '1m' | '5m' | '15m' | '1h' | '1d' | '1wk';

export interface SymbolMeta {
  symbol: string; // canonical internal id, e.g. 'NVDA', 'EURUSD', 'XAUUSD'
  providerSymbol: string; // what the provider calls it (mapping lives in the adapter)
  name: string;
  assetClass: AssetClass;
  currency: string;
  exchange?: string;
  providerId: string; // which adapter owns this symbol
}

export interface Signal {
  symbol: string;
  time: string;
  side: 'long' | 'short' | 'flat';
  strength?: number; // optional 0..1 conviction
  reason: string; // human-readable, e.g. 'RSI(14)=28 < 30 oversold'
  strategyId: string;
  /** Source market bucket (e.g. 'nse', 'eu', 'sp500', 'commodity'). Populated by per-market scans. */
  market?: string;
}

export type TradeStatus = 'open' | 'closed' | 'pending';

/** A concrete, actionable trade idea produced by the recommendation engine. */
export interface TradeIdea {
  symbol:       string;
  strategyId:   string;
  side:         'long' | 'short';
  /** ISO 4217 currency code for this symbol (e.g. 'USD', 'INR'). */
  currency:     string;
  /** Expected entry price = last close; actual fill happens at next bar open. */
  entryPrice:   number;
  stopPrice:    number;
  targetPrice:  number;
  /** Risk-based quantity: risks ~riskPct of equity to the stop. */
  qty:          number;
  /** Amount at risk to the stop (entry - stop) * qty, in the symbol's currency. */
  riskAmount:   number;
  /** Reward to target (target - entry) * qty, in the symbol's currency. */
  rewardAmount: number;
  /** Risk/reward ratio (rewardAmount / riskAmount). */
  rr:           number;
  reason:       string;
  time:         string;
}

export interface PaperTrade {
  id: string;
  strategyId: string;
  symbol: string;
  side: 'long' | 'short';
  /** ISO 4217 currency code, joined from the symbols table (e.g. 'USD', 'INR'). */
  currency?: string;
  qty: number;
  entryTime: string;
  entryPrice: number;
  exitTime?: string;
  exitPrice?: number;
  stopPrice?: number;
  targetPrice?: number;
  status: TradeStatus;
  pnl?: number;
  pnlPct?: number;
  costs: number; // commission + slippage applied
  notes?: string;
  /** Source market bucket (e.g. 'nse', 'eu', 'sp500', 'commodity'). Populated by per-market scans. */
  market?: string;
}
