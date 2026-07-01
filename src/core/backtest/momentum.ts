/**
 * Cross-sectional momentum scoring.
 *
 * Classic academic "12-1" construction: total return over the trailing ~12
 * months, EXCLUDING the most recent ~1 month. Skipping the last month is a
 * standard reversal guard - short-term price moves tend to mean-revert, while
 * the 12-month trend tends to persist (the well-documented momentum effect).
 *
 * Pure, no I/O. Used by src/core/backtest/cross-sectional.ts to rank a
 * universe of symbols at each rebalance date.
 */
import type { Bar } from '@/core/types';

/**
 * Momentum score for one symbol as of `asOfIndex` in its own bar array.
 *
 * score = close[asOfIndex - skipBars] / close[asOfIndex - lookbackBars] - 1
 *
 * Returns NaN when there isn't enough history (asOfIndex - lookbackBars < 0),
 * when skipBars >= lookbackBars, or when a referenced close is non-positive.
 * NaN (never throwing) lets the ranker simply exclude the symbol for that
 * rebalance instead of crashing the whole run.
 */
export function momentumScore(
  bars: readonly Bar[],
  asOfIndex: number,
  lookbackBars = 252,
  skipBars = 21,
): number {
  if (skipBars < 0 || lookbackBars <= 0 || skipBars >= lookbackBars) return NaN;
  if (asOfIndex < 0 || asOfIndex >= bars.length) return NaN;

  const recentIdx = asOfIndex - skipBars;
  const pastIdx   = asOfIndex - lookbackBars;
  if (pastIdx < 0 || recentIdx < 0) return NaN;

  const recentClose = bars[recentIdx].close;
  const pastClose    = bars[pastIdx].close;
  if (!(pastClose > 0) || !(recentClose > 0)) return NaN;

  return recentClose / pastClose - 1;
}

/**
 * Index of the last bar with time <= date, or -1 if every bar is after date
 * (or bars is empty). Binary search - bars must be ascending by time.
 */
export function indexAsOf(bars: readonly Bar[], date: string): number {
  let lo = 0;
  let hi = bars.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].time <= date) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}
