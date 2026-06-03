/**
 * Crossover/crossunder signal helpers and golden/death-cross detection.
 *
 * These return boolean[] (not number[]) so they live outside the number[]-typed
 * indicator registry. All outputs are aligned to the input array length.
 */

import type { Bar } from '@/core/types';
import { compute } from './registry';

// ---------------------------------------------------------------------------
// Primitive crossover/crossunder helpers
// ---------------------------------------------------------------------------

/**
 * True at index i when a crosses over b from below.
 * Definition: a[i-1] <= b[i-1] AND a[i] > b[i].
 * NaN-safe: any NaN value yields false.
 * output[0] is always false (no previous bar).
 *
 * Both input arrays must have the same length (typically aligned outputs from
 * the indicator registry).
 */
export function crossover(a: readonly number[], b: readonly number[]): boolean[] {
  const n = a.length;
  const out: boolean[] = new Array(n).fill(false);
  for (let i = 1; i < n; i++) {
    const a0 = a[i - 1], a1 = a[i];
    const b0 = b[i - 1], b1 = b[i];
    if (!isFinite(a0) || !isFinite(a1) || !isFinite(b0) || !isFinite(b1)) continue;
    out[i] = a0 <= b0 && a1 > b1;
  }
  return out;
}

/**
 * True at index i when a crosses under b from above.
 * Definition: a[i-1] >= b[i-1] AND a[i] < b[i].
 * NaN-safe: any NaN value yields false.
 * output[0] is always false (no previous bar).
 */
export function crossunder(a: readonly number[], b: readonly number[]): boolean[] {
  const n = a.length;
  const out: boolean[] = new Array(n).fill(false);
  for (let i = 1; i < n; i++) {
    const a0 = a[i - 1], a1 = a[i];
    const b0 = b[i - 1], b1 = b[i];
    if (!isFinite(a0) || !isFinite(a1) || !isFinite(b0) || !isFinite(b1)) continue;
    out[i] = a0 >= b0 && a1 < b1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Golden / death cross (SMA50 vs SMA200)
// ---------------------------------------------------------------------------

/**
 * True at bar i when the 50-bar SMA crosses OVER the 200-bar SMA.
 * Requires bars.length >= 200 to produce any true values.
 * Output aligned to bars.length.
 */
export function goldenCross(bars: readonly Bar[]): boolean[] {
  const sma50  = compute('sma', bars, { period: 50 }) as number[];
  const sma200 = compute('sma', bars, { period: 200 }) as number[];
  return crossover(sma50, sma200);
}

/**
 * True at bar i when the 50-bar SMA crosses UNDER the 200-bar SMA.
 * Requires bars.length >= 200 to produce any true values.
 * Output aligned to bars.length.
 */
export function deathCross(bars: readonly Bar[]): boolean[] {
  const sma50  = compute('sma', bars, { period: 50 }) as number[];
  const sma200 = compute('sma', bars, { period: 200 }) as number[];
  return crossunder(sma50, sma200);
}
