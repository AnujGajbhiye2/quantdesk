import 'server-only';
import { getPaperTrades } from '@/core/db/paper';
import type { EquityPoint } from '@/core/backtest/engine';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PerfMetrics {
  totalTrades:      number;   // closed trades only
  winRate:          number;   // 0..1
  avgWinPct:        number;   // average pnlPct for winning trades (positive)
  avgLossPct:       number;   // average pnlPct for losing trades (negative)
  profitFactor:     number;   // sum(wins) / |sum(losses)|; Infinity when no losses
  totalReturnPct:   number;   // sum of all closed pnlPct (arithmetic)
  currentDrawdownPct: number; // current drawdown from peak equity curve (positive %)
  maxDrawdownPct:   number;   // worst peak-to-trough on equity curve (positive %)
  /** Only present when totalTrades >= 30 - not meaningful with fewer samples. */
  sharpe?:          number;
  /**
   * Notional $100-start compounded equity curve, one point per closed trade
   * (keyed by exitTime, so same-day trades collapse to their last value -
   * same convention EquityCurveChart already uses for backtest curves).
   * Reuses the existing EquityCurveChart component (built for backtests) -
   * the live paper account never had its own equity curve until this field.
   */
  equityCurve:      EquityPoint[];
}

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

/**
 * Compute lifetime paper-trading performance metrics from all closed trades.
 *
 * Uses arithmetic returns (pnlPct) to build a simple equity curve from
 * a notional $100 start. This is consistent across currencies without needing
 * FX conversion.
 *
 * Sharpe (annualised, rf=0, 252 bars/year) is only returned once
 * totalTrades >= 30 - below that the sample size is too small to be reliable.
 */
export function buildPerformanceMetrics(): PerfMetrics {
  const all    = getPaperTrades({ status: 'closed' });
  // Sort chronologically so the equity curve is meaningful
  const trades = [...all].sort((a, b) =>
    (a.exitTime ?? '').localeCompare(b.exitTime ?? ''),
  );

  if (trades.length === 0) {
    return {
      totalTrades:        0,
      winRate:            0,
      avgWinPct:          0,
      avgLossPct:         0,
      profitFactor:       0,
      totalReturnPct:     0,
      currentDrawdownPct: 0,
      maxDrawdownPct:     0,
      equityCurve:        [],
    };
  }

  const wins   = trades.filter((t) => (t.pnlPct ?? 0) > 0);
  const losses = trades.filter((t) => (t.pnlPct ?? 0) <= 0);

  const winRate     = wins.length / trades.length;
  const avgWinPct   = wins.length > 0 ? wins.reduce((s, t) => s + (t.pnlPct ?? 0), 0) / wins.length : 0;
  const avgLossPct  = losses.length > 0 ? losses.reduce((s, t) => s + (t.pnlPct ?? 0), 0) / losses.length : 0;

  const grossWins   = wins.reduce((s, t) => s + (t.pnlPct ?? 0), 0);
  const grossLosses = Math.abs(losses.reduce((s, t) => s + (t.pnlPct ?? 0), 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

  // --- Equity curve (notional $100 starting) ---
  // Using (1 + pnlPct/100) compound returns per trade
  const equityCurve: number[] = [100];
  for (const t of trades) {
    const prev = equityCurve[equityCurve.length - 1];
    equityCurve.push(prev * (1 + (t.pnlPct ?? 0) / 100));
  }

  const finalEquity   = equityCurve[equityCurve.length - 1];
  const totalReturnPct = ((finalEquity - 100) / 100) * 100;

  // --- Drawdown ---
  let peak            = 100;
  let maxDrawdownPct  = 0;
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    const dd = ((eq - peak) / peak) * 100; // negative number
    if (dd < -maxDrawdownPct) maxDrawdownPct = Math.abs(dd);
  }
  const currentEquity        = equityCurve[equityCurve.length - 1];
  let currentPeak            = 100;
  for (const eq of equityCurve) if (eq > currentPeak) currentPeak = eq;
  const currentDrawdownPct   = currentEquity < currentPeak
    ? ((currentPeak - currentEquity) / currentPeak) * 100
    : 0;

  // --- Sharpe (only when >= 30 trades) ---
  let sharpe: number | undefined;
  if (trades.length >= 30) {
    const returns = trades.map((t) => (t.pnlPct ?? 0) / 100);
    const mean    = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    const std      = Math.sqrt(variance);
    // Annualise: assume ~252 trading bars/year, treat each trade as one period.
    // This is a trade-return Sharpe (not bar-return), suitable for sparse
    // paper-trading where equity is flat between trades.
    sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;
  }

  // equityCurve[0] is the synthetic $100 starting point (no trade yet) -
  // one chart point per actual trade, dated at its exit, using the
  // post-trade equity (equityCurve[i+1]).
  const equityCurvePoints: EquityPoint[] = trades
    .map((t, i) => ({ time: t.exitTime ?? '', equity: equityCurve[i + 1] }))
    .filter((p) => p.time !== '');

  return {
    totalTrades: trades.length,
    winRate,
    avgWinPct,
    avgLossPct,
    profitFactor,
    totalReturnPct,
    currentDrawdownPct,
    maxDrawdownPct,
    sharpe,
    equityCurve: equityCurvePoints,
  };
}
