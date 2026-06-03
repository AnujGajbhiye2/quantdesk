/**
 * Context factory for the backtest engine.
 *
 * No-look-ahead guarantee (structural, not convention):
 * - ctx.bars = Object.freeze(allBars.slice(0, i+1))
 *   Reading ctx.bars[i+1] returns undefined (out-of-bounds on the slice).
 *   Writing to ctx.bars throws TypeError (frozen array in strict mode).
 * - ctx.indicator() returns a slice of precomputed output: only indices 0..i.
 *   Indicator values are causal by construction (output[j] uses only bars[0..j]),
 *   so slicing to i+1 is equivalent to computing on bars[0..i].
 *
 * Performance: indicators are computed ONCE over allBars per (id, params) pair
 * and cached for the whole backtest run. ctx.indicator() is O(i) per call (slice),
 * not O(n*i) recomputation.
 */

import type { Bar } from '@/core/types';
import type { IndicatorOutput } from '@/core/indicators/registry';
import { compute } from '@/core/indicators/registry';
import type { StrategyContext } from './Strategy';

export type IndicatorCache = Map<string, IndicatorOutput>;

/**
 * Return a causal slice of an indicator output - only indices 0..i present.
 * Single array: slice to i+1. Multi-output record: each sub-array sliced.
 */
function sliceOutput(output: IndicatorOutput, i: number): IndicatorOutput {
  if (Array.isArray(output)) {
    return output.slice(0, i + 1);
  }
  const result: Record<string, number[]> = {};
  for (const [key, arr] of Object.entries(output)) {
    result[key] = arr.slice(0, i + 1);
  }
  return result;
}

/**
 * Build a StrategyContext for bar index `i`.
 *
 * @param allBars  Full bar series for the symbol (engine owns this; never passed to strategies).
 * @param i        Current bar index.
 * @param position Position state entering this bar.
 * @param cache    Mutable indicator cache shared across the full backtest run.
 */
export function makeContext(
  allBars: readonly Bar[],
  i: number,
  position: 'long' | 'short' | 'flat',
  cache: IndicatorCache,
): StrategyContext {
  // Structural no-look-ahead: frozen shallow copy of bars[0..i].
  // bars[i+1] === undefined (array OOB), writes throw TypeError (freeze + strict mode).
  const bars = Object.freeze(allBars.slice(0, i + 1)) as ReadonlyArray<Bar>;

  function indicator(id: string, params?: object): IndicatorOutput {
    const cacheKey = `${id}::${JSON.stringify(params ?? {})}`;
    let full = cache.get(cacheKey);
    if (!full) {
      // Compute once over the full series.
      // output[j] is causal (uses only bars[0..j]); slicing to i+1 is safe.
      full = compute(id, allBars, params ?? {});
      cache.set(cacheKey, full);
    }
    return sliceOutput(full, i);
  }

  return Object.freeze({ bars, i, position, indicator });
}
