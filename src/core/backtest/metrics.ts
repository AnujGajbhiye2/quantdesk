/**
 * Backtest metrics computation.
 *
 * All inputs are pure data - no DB, no I/O. Called by the engine after the run.
 *
 * Sharpe annualisation: pass barsPerYear (252 for daily, 52 for weekly).
 * CAGR: computed from equity curve start/end dates.
 * Max drawdown: running peak on the equity curve.
 */

import type { TradeRecord, EquityPoint, BacktestMetrics } from './engine';
import type { Timeframe } from '@/core/types';

/**
 * Bars per year for Sharpe annualisation, by timeframe. 252 trading days/year,
 * 6.5h regular trading hours/day (390 minutes).
 *
 * Getting this wrong silently mis-scales every non-daily Sharpe: using the
 * daily default (252) on a 15m backtest understates Sharpe by ~sqrt(6552/252)
 * ≈ 5x; on a weekly backtest it overstates Sharpe by ~sqrt(252/52) ≈ 2.2x.
 */
export const BARS_PER_YEAR: Record<Timeframe, number> = {
  '1m':  390 * 252,
  '5m':  78  * 252,
  '15m': 26  * 252,
  '1h':  Math.round(6.5 * 252),
  '1d':  252,
  '1wk': 52,
};

/**
 * Compute all metrics from closed trades and the equity curve.
 *
 * @param trades       Closed trade records (from engine).
 * @param equityCurve  Per-bar mark-to-market equity (from engine).
 * @param totalBars    Total number of bars in the backtest series.
 * @param initialEquity Starting equity.
 * @param barsPerYear  Bars per year for annualisation (default 252 = daily).
 */
export function computeMetrics(
  trades: TradeRecord[],
  equityCurve: EquityPoint[],
  totalBars: number,
  initialEquity: number,
  barsPerYear = 252,
): BacktestMetrics {
  // Build a set of bar indices where a position was open (inclusive on both ends).
  // Used to filter the equity curve for the exposure-adjusted Sharpe.
  const inPositionBars = new Set<number>();
  for (const t of trades) {
    for (let b = t.entryBar; b <= t.exitBar; b++) {
      inPositionBars.add(b);
    }
  }
  const n = equityCurve.length;
  const finalEquity = n > 0 ? equityCurve[n - 1].equity : initialEquity;

  // --- Total return ---
  const totalReturnPct = ((finalEquity - initialEquity) / initialEquity) * 100;

  // --- CAGR ---
  let cagr = 0;
  if (n >= 2) {
    // Use the equity curve date range; daily bars assumed if same-day range
    const first = new Date(equityCurve[0].time);
    const last  = new Date(equityCurve[n - 1].time);
    const years = (last.getTime() - first.getTime()) / (365.25 * 24 * 3600 * 1000);
    if (years > 0 && initialEquity > 0 && finalEquity > 0) {
      cagr = (Math.pow(finalEquity / initialEquity, 1 / years) - 1) * 100;
    }
  }

  // --- Trade stats ---
  const numTrades = trades.length;
  const wins  = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);

  const winRate = numTrades > 0 ? wins.length / numTrades : 0;

  const avgWinPct =
    wins.length > 0 ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
  const avgLossPct =
    losses.length > 0 ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0;

  const grossWins  = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLosses = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

  const avgHoldingBars =
    numTrades > 0 ? trades.reduce((s, t) => s + t.holdingBars, 0) / numTrades : 0;

  // --- Max drawdown (on equity curve) ---
  let peak = initialEquity;
  let maxDrawdownPct = 0;
  for (const pt of equityCurve) {
    if (pt.equity > peak) peak = pt.equity;
    const dd = ((pt.equity - peak) / peak) * 100; // negative
    if (dd < maxDrawdownPct) maxDrawdownPct = dd;
  }
  // Return as positive % for readability (e.g. 15 means 15% drawdown)
  maxDrawdownPct = Math.abs(maxDrawdownPct);

  // --- Sharpe (annualised, rf=0) ---
  // Full-curve Sharpe: includes flat/cash bars (zero returns). This is the
  // conventional "strategy Sharpe" accounting for the time not invested.
  // Exposure Sharpe: only in-market bars. Avoids the flat-bar std deflation
  // that inflates Sharpe for part-time strategies (e.g. 15% exposure means
  // 85% of returns are exactly zero, pushing std toward zero artificially).
  function annualisedSharpe(returns: number[]): number {
    if (returns.length < 2) return 0;
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    const std = Math.sqrt(variance);
    return std > 0 ? (mean / std) * Math.sqrt(barsPerYear) : 0;
  }

  let sharpe = 0;
  let exposureSharpe = NaN;
  if (n >= 2) {
    const allReturns: number[] = [];
    const inMarketReturns: number[] = [];
    for (let i = 1; i < n; i++) {
      const prev = equityCurve[i - 1].equity;
      if (prev > 0) {
        const r = (equityCurve[i].equity - prev) / prev;
        allReturns.push(r);
        // Bar i is "in market" when the position was open at that bar index
        if (inPositionBars.has(i)) inMarketReturns.push(r);
      }
    }
    sharpe = annualisedSharpe(allReturns);
    if (inMarketReturns.length >= 2) {
      exposureSharpe = annualisedSharpe(inMarketReturns);
    }
  }

  // --- Exposure ---
  // Fraction of bars where a position was open. De-duped via inPositionBars
  // (same set exposureSharpe uses) rather than summing t.holdingBars directly:
  // a partial exit pushes an extra trade record spanning the same entry..exit
  // bar range as the runner, so a naive sum can push exposurePct past 100%.
  const exposurePct = totalBars > 0 ? (inPositionBars.size / totalBars) * 100 : 0;

  return {
    totalReturnPct,
    cagr,
    winRate,
    avgWinPct,
    avgLossPct,
    profitFactor,
    maxDrawdownPct,
    sharpe,
    exposureSharpe,
    exposurePct,
    numTrades,
    avgHoldingBars,
  };
}
