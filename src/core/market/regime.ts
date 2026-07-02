/**
 * Market regime evaluation.
 *
 * A RegimeRequirement is an optional declarative precondition on a Strategy.
 * When a strategy declares one, the scanner and backtest engine enforce it
 * before allowing an entry signal. Strategy.onBar() never sees this - it
 * remains pure and ignorant of market-level state.
 *
 * Four kinds:
 *   market-trend   index close > SMA(period)              e.g. SPY > 200dma
 *   volatility     index close within [min, max]           e.g. VIX < 30 (needs a VIX-like index series)
 *   adx            index ADX(period) within [min,max]      e.g. ADX > 25 = trending
 *   realized-vol   trailing annualized stddev of the index's daily log returns
 *                  within [min, max]% - a free VIX proxy computed from any
 *                  already-ingested index (e.g. ^GSPC), no separate VIX
 *                  ticker required. e.g. maxAnnualizedPct=25 blocks entries
 *                  when trailing realized vol exceeds 25%/year.
 *
 * buildRegimeMap pre-computes date->aligned in O(n) for the backtest engine.
 * checkRegime evaluates the latest bar only (for the scanner / live path).
 * lookupRegime does a date lookup with fallback to nearest prior date.
 */

import type { Bar } from '@/core/types';
import { compute } from '@/core/indicators/registry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RegimeRequirement =
  | { kind: 'market-trend'; index: string; over: 'sma'; period: number }
  | { kind: 'volatility';   index: string; max?: number; min?: number }
  | { kind: 'adx';          index: string; min?: number; max?: number; period?: number }
  | { kind: 'realized-vol'; index: string; period: number; maxAnnualizedPct?: number; minAnnualizedPct?: number };

// ---------------------------------------------------------------------------
// buildRegimeMap - O(n), used by backtest engine
// ---------------------------------------------------------------------------

/**
 * Pre-compute regime alignment for every bar in the index series.
 * Returns Map<'YYYY-MM-DD', aligned: boolean>.
 * Warm-up bars (NaN indicators) return true (neutral - do not suppress early bars).
 */
export function buildRegimeMap(req: RegimeRequirement, bars: readonly Bar[]): Map<string, boolean> {
  const map = new Map<string, boolean>();
  if (bars.length === 0) return map;

  switch (req.kind) {
    case 'market-trend': {
      const sma = compute('sma', bars as Bar[], { period: req.period }) as number[];
      for (let i = 0; i < bars.length; i++) {
        const aligned = !Number.isFinite(sma[i]) ? true : bars[i].close > sma[i];
        map.set(bars[i].time.slice(0, 10), aligned);
      }
      break;
    }
    case 'volatility': {
      for (let i = 0; i < bars.length; i++) {
        const v = bars[i].close;
        const aligned =
          (req.min == null || v >= req.min) &&
          (req.max == null || v <= req.max);
        map.set(bars[i].time.slice(0, 10), aligned);
      }
      break;
    }
    case 'adx': {
      const period = req.period ?? 14;
      const adx = compute('adx', bars as Bar[], { period }) as number[];
      for (let i = 0; i < bars.length; i++) {
        const v = adx[i];
        const aligned = !Number.isFinite(v)
          ? true
          : (req.min == null || v >= req.min) && (req.max == null || v <= req.max);
        map.set(bars[i].time.slice(0, 10), aligned);
      }
      break;
    }
    case 'realized-vol': {
      // Trailing annualized stddev of daily log returns, in percent.
      // dailyStd * sqrt(252) * 100 - the standard realized-vol annualization.
      const logReturns: number[] = new Array(bars.length).fill(NaN);
      for (let i = 1; i < bars.length; i++) {
        const prev = bars[i - 1].close;
        const cur  = bars[i].close;
        logReturns[i] = prev > 0 && cur > 0 ? Math.log(cur / prev) : NaN;
      }
      for (let i = 0; i < bars.length; i++) {
        const window = logReturns.slice(Math.max(0, i - req.period + 1), i + 1)
          .filter((r) => Number.isFinite(r));
        let aligned = true; // warm-up: neutral
        if (window.length >= Math.min(req.period, 5)) {
          const mean = window.reduce((s, r) => s + r, 0) / window.length;
          const variance = window.reduce((s, r) => s + (r - mean) ** 2, 0) / window.length;
          const annualizedPct = Math.sqrt(variance) * Math.sqrt(252) * 100;
          aligned =
            (req.maxAnnualizedPct == null || annualizedPct <= req.maxAnnualizedPct) &&
            (req.minAnnualizedPct == null || annualizedPct >= req.minAnnualizedPct);
        }
        map.set(bars[i].time.slice(0, 10), aligned);
      }
      break;
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// checkRegime - evaluates latest bar only (scanner / live path)
// ---------------------------------------------------------------------------

/**
 * Returns true when the latest bar of indexBars satisfies the regime requirement.
 * Returns true (neutral) when indexBars is empty or warm-up hasn't cleared.
 */
export function checkRegime(req: RegimeRequirement, bars: readonly Bar[]): boolean {
  if (bars.length === 0) return true;
  const map = buildRegimeMap(req, bars);
  return map.get(bars[bars.length - 1].time.slice(0, 10)) ?? true;
}

// ---------------------------------------------------------------------------
// lookupRegime - date lookup with fallback (backtest engine)
// ---------------------------------------------------------------------------

/**
 * Look up regime state for a given date.
 * Falls back to the nearest prior date when the exact date is missing
 * (e.g. strategy bar on a holiday where the index had no trading day).
 * Returns true (neutral) when no prior date is available.
 *
 * sortedDates is optional; when omitted it is derived from the map keys
 * (pass it in if calling in a tight loop to avoid repeated Array.from).
 */
export function lookupRegime(
  map: Map<string, boolean>,
  date: string,
  sortedDates?: string[],
): boolean {
  const d = date.slice(0, 10);
  if (map.has(d)) return map.get(d)!;

  const dates = sortedDates ?? Array.from(map.keys()).sort();
  // Binary search for latest date <= d
  let lo = 0, hi = dates.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= d) { found = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return found >= 0 ? (map.get(dates[found]) ?? true) : true;
}
