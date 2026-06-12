/**
 * Pure aggregation from closed-trade records to edge numbers.
 * No DB, no I/O - unit-testable with fixed trade lists.
 */

/** Minimal slice of a TradeRecord needed for edge aggregation. */
export interface SlimTrade {
  pnl: number;
  pnlPct: number;
  holdingBars: number;
}

export interface EdgeNumbers {
  winRate: number;
  avgWinPct: number;
  avgLossPct: number;
  profitFactor: number;
  numTrades: number;
  medianWinHoldBars: number;
}

/** Cap instead of Infinity so the value survives a REAL NOT NULL column. */
const PROFIT_FACTOR_CAP = 9999;

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function aggregateEdge(trades: readonly SlimTrade[]): EdgeNumbers {
  const wins   = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);

  const grossWin  = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  const avg = (xs: readonly SlimTrade[]) =>
    xs.length === 0 ? 0 : xs.reduce((s, t) => s + t.pnlPct, 0) / xs.length;

  let profitFactor: number;
  if (grossLoss === 0) {
    profitFactor = grossWin > 0 ? PROFIT_FACTOR_CAP : 0;
  } else {
    profitFactor = Math.min(grossWin / grossLoss, PROFIT_FACTOR_CAP);
  }

  return {
    winRate:           trades.length === 0 ? 0 : wins.length / trades.length,
    avgWinPct:         avg(wins),
    avgLossPct:        avg(losses),
    profitFactor,
    numTrades:         trades.length,
    medianWinHoldBars: median(wins.map((t) => t.holdingBars)),
  };
}
