/**
 * Exit-date projection from historical winning-trade hold times.
 * Pure date arithmetic - no DB, no I/O.
 *
 * This is NOT a forecast. It reports the historical median hold of winning
 * trades and translates it into a calendar range from a given entry date.
 * Every UI surface that shows it must carry the label
 * "Historical median - not a forecast."
 */

import type { Timeframe } from '@/core/types';
import { median, type SlimTrade } from './aggregate';

export interface ExitProjectionRange {
  /** Entry date the range is anchored to (ISO date). */
  fromDate: string;
  medianHoldBars: number;
  /** fromDate + 75% of median hold (ISO date). */
  earliest: string;
  /** fromDate + 125% of median hold (ISO date). */
  latest: string;
}

/** Median holdingBars of winning trades, or null if there are no winners. */
export function medianWinHoldBars(trades: readonly SlimTrade[]): number | null {
  const winHolds = trades.filter((t) => t.pnl > 0).map((t) => t.holdingBars);
  if (winHolds.length === 0) return null;
  return median(winHolds);
}

/** Add n business days (Mon-Fri) to an ISO date. */
export function addBusinessDays(dateISO: string, n: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  let remaining = n;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining -= 1;
  }
  return d.toISOString().slice(0, 10);
}

/** Add n calendar days to an ISO date. */
function addCalendarDays(dateISO: string, n: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Translate a median hold (in bars) into a date range from an entry date.
 * Daily bars map to business days; weekly bars to 7 calendar days per bar.
 * Returns null for non-positive medians.
 */
export function projectExitRange(
  fromDate: string,
  medianBars: number,
  timeframe: Timeframe = '1d',
): ExitProjectionRange | null {
  if (!(medianBars > 0)) return null;

  const lo = Math.max(1, Math.floor(medianBars * 0.75));
  const hi = Math.max(lo, Math.ceil(medianBars * 1.25));

  let earliest: string;
  let latest: string;
  if (timeframe === '1d') {
    earliest = addBusinessDays(fromDate, lo);
    latest   = addBusinessDays(fromDate, hi);
  } else if (timeframe === '1wk') {
    earliest = addCalendarDays(fromDate, lo * 7);
    latest   = addCalendarDays(fromDate, hi * 7);
  } else {
    // Intraday timeframes: treat bars as same-or-next-day; range in calendar days
    earliest = addCalendarDays(fromDate, Math.ceil(lo / 7));
    latest   = addCalendarDays(fromDate, Math.ceil(hi / 7));
  }

  return { fromDate, medianHoldBars: medianBars, earliest, latest };
}
