/**
 * Shared utilities for the indicator registry.
 * These are pure functions with no side effects.
 */

import type { Bar } from '@/core/types';

// ---------------------------------------------------------------------------
// Bar-array extractors
// ---------------------------------------------------------------------------

export function closes(bars: readonly Bar[]): number[] {
  return bars.map((b) => b.close);
}

export function opens(bars: readonly Bar[]): number[] {
  return bars.map((b) => b.open);
}

export function highs(bars: readonly Bar[]): number[] {
  return bars.map((b) => b.high);
}

export function lows(bars: readonly Bar[]): number[] {
  return bars.map((b) => b.low);
}

export function volumes(bars: readonly Bar[]): number[] {
  return bars.map((b) => b.volume);
}

// ---------------------------------------------------------------------------
// Alignment primitive
// ---------------------------------------------------------------------------

/**
 * Left-pad `out` with NaN until it equals `targetLen`.
 *
 * @ixjb94/indicators (Tulip-style) returns shorter arrays that omit the
 * warm-up prefix. This function restores alignment so output[i] always maps
 * to bars[i] - the structural guarantee that prevents look-ahead bias.
 *
 * @param out       Short array from the indicator library.
 * @param targetLen Desired output length (= bars.length).
 */
export function padLeft(out: number[], targetLen: number): number[] {
  const padCount = targetLen - out.length;
  if (padCount <= 0) return out;
  return [...Array(padCount).fill(NaN), ...out];
}

/**
 * Apply padLeft to each sub-array in a multi-output result (e.g. MACD, BBands).
 * Each sub-array is padded independently to `targetLen`.
 */
export function padLeftAll(outs: number[][], targetLen: number): number[][] {
  return outs.map((o) => padLeft(o, targetLen));
}
