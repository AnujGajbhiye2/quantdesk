/**
 * Rolling return correlation between two price series.
 *
 * Used by the 'correlated-cluster' risk rule to detect when a candidate
 * position would add to an already-large factor bet (e.g. three tech stocks
 * behaving as one levered position).
 *
 * Pure: no I/O, no DB. Caller supplies bar arrays already loaded from SQLite.
 */

import type { Bar } from '@/core/types';

/**
 * Compute the Pearson correlation of daily log-returns between two series
 * over the trailing `period` bars.
 *
 * Returns NaN when either series has fewer than `period + 1` bars or when
 * one series has zero variance (constant price). Caller treats NaN as
 * "insufficient data - no correlation penalty applied."
 */
export function rollingCorrelation(
  aBar: readonly Bar[],
  bBars: readonly Bar[],
  period = 60,
): number {
  // Need period+1 bars to produce period returns
  const minLen = period + 1;
  if (aBar.length < minLen || bBars.length < minLen) return NaN;

  // Use the trailing period bars from each series (most recent)
  const aSlice = aBar.slice(aBar.length - minLen);
  const bSlice = bBars.slice(bBars.length - minLen);

  const aReturns: number[] = [];
  const bReturns: number[] = [];

  for (let i = 1; i < minLen; i++) {
    const ap = aSlice[i - 1].close, ac = aSlice[i].close;
    const bp = bSlice[i - 1].close, bc = bSlice[i].close;
    if (ap <= 0 || bp <= 0 || ac <= 0 || bc <= 0) return NaN;
    aReturns.push(Math.log(ac / ap));
    bReturns.push(Math.log(bc / bp));
  }

  const n = aReturns.length;
  if (n < 2) return NaN;

  const meanA = aReturns.reduce((s, r) => s + r, 0) / n;
  const meanB = bReturns.reduce((s, r) => s + r, 0) / n;

  let covAB = 0, varA = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    const da = aReturns[i] - meanA;
    const db = bReturns[i] - meanB;
    covAB += da * db;
    varA  += da * da;
    varB  += db * db;
  }

  const denom = Math.sqrt(varA * varB);
  if (denom < 1e-12) return NaN; // one series is constant

  return covAB / denom;
}

/**
 * Find the maximum correlation between a candidate symbol and any open
 * position's symbol, given bar series for each.
 *
 * Returns null when there are no open positions or all correlations are NaN.
 */
export function maxCorrelationToOpen(
  candidateBars: readonly Bar[],
  openBars: ReadonlyArray<{ symbol: string; bars: readonly Bar[] }>,
  period = 60,
): { symbol: string; correlation: number } | null {
  let best: { symbol: string; correlation: number } | null = null;

  for (const open of openBars) {
    const corr = rollingCorrelation(candidateBars, open.bars, period);
    if (!Number.isFinite(corr)) continue;
    if (best === null || Math.abs(corr) > Math.abs(best.correlation)) {
      best = { symbol: open.symbol, correlation: corr };
    }
  }

  return best;
}
