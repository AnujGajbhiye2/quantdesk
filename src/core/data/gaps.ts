import 'server-only';

/**
 * Missing-trading-day gap detection.
 *
 * The system trades symbols across several exchanges (NYSE, NSE, Euronext
 * and friends), each with its own holiday calendar. Rather than hand-maintain
 * a holiday table per exchange (the NYSE table already went stale once - see
 * market/hours.ts), this uses peer consensus: within a group of symbols that
 * share an exchange, the set of dates where most symbols have a bar IS the
 * exchange's trading calendar for that window. A symbol that's missing a bar
 * on a date most of its peers traded has a gap - a missed refresh, a stale
 * symbol, or a provider outage for that name specifically.
 *
 * Pure functions here take date arrays, not DB handles, so the core logic is
 * unit-testable without a database.
 */

export interface SymbolBarDates {
  symbol: string;
  /** Ascending 'YYYY-MM-DD' dates for this symbol's stored daily bars. */
  dates: string[];
}

export interface SymbolGap {
  symbol: string;
  /** Dates the peer group traded but this symbol has no bar for. */
  missingDates: string[];
}

export interface GapDetectionResult {
  groupKey: string;
  peerCount: number;
  referenceCalendarSize: number;
  gaps: SymbolGap[];
}

/**
 * Detect gaps for one peer group (symbols sharing an exchange/market).
 *
 * @param group               Per-symbol ascending bar-date lists.
 * @param minPeerCoveragePct  A date counts as "the market was open" when at
 *                            least this fraction of the group has a bar on
 *                            it. Default 0.6 - tolerant of a few symbols
 *                            being newly listed or thinly traded.
 * @param minGroupSize        Below this many symbols, peer consensus is too
 *                            noisy to trust; returns no gaps. Default 5.
 */
export function detectGapsForGroup(
  groupKey: string,
  group: SymbolBarDates[],
  minPeerCoveragePct = 0.6,
  minGroupSize = 5,
): GapDetectionResult {
  if (group.length < minGroupSize) {
    return { groupKey, peerCount: group.length, referenceCalendarSize: 0, gaps: [] };
  }

  // Count how many symbols have a bar on each date.
  const dateCounts = new Map<string, number>();
  for (const { dates } of group) {
    for (const d of dates) {
      dateCounts.set(d, (dateCounts.get(d) ?? 0) + 1);
    }
  }

  const threshold = Math.ceil(group.length * minPeerCoveragePct);
  const referenceCalendar = new Set(
    [...dateCounts.entries()].filter(([, count]) => count >= threshold).map(([d]) => d),
  );

  const gaps: SymbolGap[] = [];
  for (const { symbol, dates } of group) {
    if (dates.length === 0) continue;
    const own = new Set(dates);
    const firstOwnDate = dates[0]; // don't flag pre-listing history as missing
    const missingDates = [...referenceCalendar]
      .filter((d) => d >= firstOwnDate && !own.has(d))
      .sort();
    if (missingDates.length > 0) {
      gaps.push({ symbol, missingDates });
    }
  }
  gaps.sort((a, b) => b.missingDates.length - a.missingDates.length);

  return { groupKey, peerCount: group.length, referenceCalendarSize: referenceCalendar.size, gaps };
}

/**
 * Group symbols by exchange (fallback: providerId, then 'unknown') and run
 * peer-consensus gap detection within each group.
 */
export function detectGapsAcrossGroups(
  symbolGroups: Map<string, SymbolBarDates[]>,
  minPeerCoveragePct = 0.6,
  minGroupSize = 5,
): GapDetectionResult[] {
  const results: GapDetectionResult[] = [];
  for (const [groupKey, group] of symbolGroups) {
    results.push(detectGapsForGroup(groupKey, group, minPeerCoveragePct, minGroupSize));
  }
  return results;
}

/** Total gap count across a set of group results - convenience for a one-line health check. */
export function totalGapCount(results: GapDetectionResult[]): number {
  return results.reduce((s, r) => s + r.gaps.reduce((gs, g) => gs + g.missingDates.length, 0), 0);
}

// ---------------------------------------------------------------------------
// DB-facing wrapper
// ---------------------------------------------------------------------------

import { getAllSymbols, getRecentBars } from '@/core/db/bars';

/**
 * Run peer-consensus gap detection across the full stored '1d' universe,
 * grouped by exchange (falling back to providerId, then 'unknown' when
 * exchange isn't set). Looks back `recentBarsLimit` daily bars per symbol
 * (~90 calendar days of trading history by default - enough for a reliable
 * peer calendar without loading full multi-year history per symbol).
 */
export function detectUniverseGaps(recentBarsLimit = 90): GapDetectionResult[] {
  const symbols = getAllSymbols();
  const groups = new Map<string, SymbolBarDates[]>();

  for (const meta of symbols) {
    const bars = getRecentBars(meta.symbol, '1d', recentBarsLimit);
    if (bars.length === 0) continue;
    const groupKey = meta.exchange || meta.providerId || 'unknown';
    const entry: SymbolBarDates = { symbol: meta.symbol, dates: bars.map((b) => b.time.slice(0, 10)) };
    const list = groups.get(groupKey);
    if (list) list.push(entry); else groups.set(groupKey, [entry]);
  }

  return detectGapsAcrossGroups(groups);
}
