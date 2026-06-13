/**
 * Strategy validation utility.
 *
 * Runs four checks on a candidate Strategy before it is trusted:
 *   1. Shape   - required fields non-empty; params is a Zod schema with .parse().
 *   2. Params defaults - strategy.params.parse({}) must succeed (every field has
 *      a .default() so callers never need to supply a full params object).
 *   3. Look-ahead probe - onBar is called via a Proxy-based context that throws a
 *      LookAheadError if the strategy reads bars[i+1] or beyond. Stronger than the
 *      silent undefined produced by the frozen slice in makeContext - this check
 *      actively catches future-bar reads at dev/test time.
 *   4. Smoke backtest - runBacktest on a deterministic 300-bar synthetic series must
 *      not throw and must produce finite totalReturnPct + maxDrawdownPct.
 *
 * Called by strategy/registry.ts register() when NODE_ENV !== 'production'.
 */

import { runBacktest } from '@/core/backtest/engine';
import { compute } from '@/core/indicators/registry';
import type { IndicatorOutput } from '@/core/indicators/registry';
import type { Bar } from '@/core/types';
import type { Strategy, StrategyContext } from './Strategy';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateStrategy(strategy: Strategy): ValidationResult {
  const errors: string[] = [];

  // 1. Shape
  if (!strategy.id || typeof strategy.id !== 'string') {
    errors.push('id must be a non-empty string');
  }
  if (!strategy.name || typeof strategy.name !== 'string') {
    errors.push('name must be a non-empty string');
  }
  if (!strategy.description || typeof strategy.description !== 'string') {
    errors.push('description must be a non-empty string');
  }
  if (!strategy.params || typeof strategy.params.parse !== 'function') {
    errors.push('params must be a Zod schema (must have a .parse() method)');
  }
  if (typeof strategy.onBar !== 'function') {
    errors.push('onBar must be a function');
  }

  // Bail early - remaining checks would throw on a malformed strategy
  if (errors.length > 0) return { ok: false, errors };

  // 2. Params defaults
  try {
    strategy.params.parse({});
  } catch (e) {
    errors.push(
      `params.parse({}) failed - every field must have a .default() value: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // 3. Look-ahead probe (active trap via Proxy)
  const probeBars = makeSyntheticBars(35);
  const probeIndices = [0, 5, 15, 34].filter((i) => i < probeBars.length);

  for (const i of probeIndices) {
    try {
      const ctx = makeProbingContext(probeBars, i);
      strategy.onBar(ctx, {});
    } catch (err) {
      if (err instanceof LookAheadError) {
        errors.push(`look-ahead detected at bar i=${i}: ${err.message}`);
        break;
      }
      // Non-look-ahead throws (warm-up NaN guards, short-circuit holds) are fine
    }
  }

  // 4. Smoke backtest - skipped in development to avoid expensive module-load cost.
  // Runs in test (NODE_ENV=test) and when VALIDATE_STRATEGIES=1 is explicitly set.
  if (process.env.NODE_ENV === 'test' || process.env.VALIDATE_STRATEGIES === '1') {
    const smokeBars = makeSyntheticBars(300);
    try {
      const result = runBacktest({
        strategy,
        bars: smokeBars,
        symbol: '__smoke__',
        rawParams: {},
        commission: 0,
        slippagePct: 0,
      });
      const m = result.metrics;
      if (!Number.isFinite(m.totalReturnPct)) {
        errors.push('smoke backtest produced non-finite totalReturnPct');
      }
      if (!Number.isFinite(m.maxDrawdownPct)) {
        errors.push('smoke backtest produced non-finite maxDrawdownPct');
      }
    } catch (err) {
      errors.push(
        `smoke backtest threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Deterministic synthetic bar series (no RNG - same output every call)
// ---------------------------------------------------------------------------

export function makeSyntheticBars(n: number): Bar[] {
  const bars: Bar[] = [];
  const startMs = new Date('2020-01-02').getTime();
  const dayMs   = 86_400_000;

  for (let i = 0; i < n; i++) {
    const date  = new Date(startMs + i * dayMs).toISOString().slice(0, 10);
    const base  = 100 + Math.sin(i * 0.15) * 8 + i * 0.03;
    const open  = base + Math.sin(i * 0.70) * 0.5;
    const close = base + Math.sin(i * 0.70 + 1.0) * 0.5;
    const high  = Math.max(open, close) + Math.abs(Math.sin(i * 0.3)) * 1.2 + 0.1;
    const low   = Math.min(open, close) - Math.abs(Math.sin(i * 0.3)) * 1.2 - 0.1;
    bars.push({
      time:   date,
      open:   +open.toFixed(4),
      high:   +high.toFixed(4),
      low:    +low.toFixed(4),
      close:  +close.toFixed(4),
      volume: 1_000_000 + Math.floor(Math.abs(Math.sin(i * 0.2)) * 500_000),
    });
  }

  return bars;
}

// ---------------------------------------------------------------------------
// Internal: look-ahead probe context
// ---------------------------------------------------------------------------

class LookAheadError extends Error {}

function makeProbingContext(allBars: Bar[], i: number): StrategyContext {
  // Proxy bars[0..i]: any numeric index > i throws LookAheadError
  const slice = allBars.slice(0, i + 1);
  const proxyBars = new Proxy(slice, {
    get(target, prop, receiver) {
      const idx = typeof prop === 'string' ? Number(prop) : NaN;
      if (Number.isInteger(idx) && idx > i) {
        throw new LookAheadError(
          `bars[${idx}] accessed at bar i=${i} - future bar read`,
        );
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as ReadonlyArray<Bar>;

  const cache = new Map<string, IndicatorOutput>();

  function indicator(id: string, params?: object): IndicatorOutput {
    const key = `${id}::${JSON.stringify(params ?? {})}`;
    if (!cache.has(key)) {
      cache.set(key, compute(id, allBars.slice(0, i + 1), params ?? {}));
    }
    return cache.get(key)!;
  }

  return Object.freeze({ bars: proxyBars, i, position: 'flat' as const, indicator });
}
