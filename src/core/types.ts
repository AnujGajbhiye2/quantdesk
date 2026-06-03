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
}

export type TradeStatus = 'open' | 'closed';

export interface PaperTrade {
  id: string;
  strategyId: string;
  symbol: string;
  side: 'long' | 'short';
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
}
