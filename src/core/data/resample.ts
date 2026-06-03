/**
 * Bar resampling utilities.
 *
 * These are pure functions (no I/O, no DB) that convert daily bars into
 * lower-frequency aggregates so the UI can show weekly charts without
 * requiring an extra ingest pass.
 *
 * OHLCV aggregation rules:
 *   open   = first bar's open
 *   high   = max of all highs
 *   low    = min of all lows
 *   close  = last bar's close
 *   volume = sum of all volumes
 *
 * Time label = the first bar's time (start of the period).
 */

import type { Bar } from '@/core/types';

// ---------------------------------------------------------------------------
// ISO week key
// ---------------------------------------------------------------------------

/**
 * Return the ISO week identifier 'YYYY-Www' for a 'YYYY-MM-DD' date string.
 * Monday is the first day of the week per ISO 8601.
 */
function isoWeekKey(dateStr: string): string {
  const d  = new Date(dateStr + 'T00:00:00Z');
  // ISO week: find Thursday of this week (ISO 8601 defines week by Thursday)
  const thu = new Date(d);
  const day = d.getUTCDay() || 7; // convert Sunday=0 to Sunday=7
  thu.setUTCDate(d.getUTCDate() + 4 - day); // Thursday of this week
  const year   = thu.getUTCFullYear();
  const jan1   = new Date(Date.UTC(year, 0, 1));
  const weekNum = Math.ceil((((thu.getTime() - jan1.getTime()) / 86_400_000) + jan1.getUTCDay() + 1) / 7);
  return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Weekly resampler
// ---------------------------------------------------------------------------

/**
 * Resample daily bars into weekly bars.
 * Bars must be sorted ascending (oldest first).
 * Returns weekly bars sorted ascending.
 */
export function toWeekly(bars: readonly Bar[]): Bar[] {
  if (bars.length === 0) return [];

  // Group by ISO week
  const groups = new Map<string, Bar[]>();
  for (const bar of bars) {
    const key = isoWeekKey(bar.time);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(bar);
  }

  // Aggregate each group
  const weekly: Bar[] = [];
  for (const [, group] of groups) {
    // group is already in ascending order (same week -> same order as input)
    const first  = group[0];
    const last   = group[group.length - 1];
    const high   = Math.max(...group.map((b) => b.high));
    const low    = Math.min(...group.map((b) => b.low));
    const volume = group.reduce((s, b) => s + b.volume, 0);

    weekly.push({
      time:   first.time, // week starts on the first trading day
      open:   first.open,
      high,
      low,
      close:  last.close,
      volume,
    });
  }

  // Sort ascending (Map preserves insertion order but weeks may be out of order
  // if bars were not perfectly sorted; defensive sort)
  weekly.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  return weekly;
}
