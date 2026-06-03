/**
 * Indicator registry.
 *
 * Wraps @ixjb94/indicators (zero-dep, pure TS) behind a uniform interface.
 * Every registered indicator:
 *   - Accepts `bars: readonly Bar[]` and a params object.
 *   - Returns an array (or named-array object) **aligned to bars.length** via
 *     left-padding with NaN for the warm-up period.
 *   - Validates its own params with a Zod schema that supplies defaults.
 *
 * Adding a new indicator: one new `register(...)` call at the bottom of this file.
 */

import { z } from 'zod';
import { IndicatorsSync } from '@ixjb94/indicators';
import type { Bar } from '@/core/types';
import { closes, highs, lows, volumes, padLeft, padLeftAll } from './helpers';

// ---------------------------------------------------------------------------
// Single module-level instance (synchronous, zero Promises in hot loop)
// ---------------------------------------------------------------------------
const ta = new IndicatorsSync();

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Single-series or named-series output. All arrays are aligned to bars.length. */
export type IndicatorOutput = number[] | Record<string, number[]>;

/**
 * A registered indicator definition.
 *
 * No `any` in this contract - rawParams is `unknown` and each def validates
 * it internally with its own Zod schema.
 */
export interface IndicatorDef {
  id: string;
  label: string;
  /** Zod schema with defaults; used by UI/strategies to build param forms. */
  params: z.ZodTypeAny;
  /**
   * Compute the indicator over `bars`. Returns arrays aligned to bars.length
   * (NaN-padded for warm-up bars so index i always maps to bars[i]).
   *
   * @param bars      Full bar slice visible to the strategy (already 0..i bounded).
   * @param rawParams Raw params object; parsed + defaulted by this def's schema.
   */
  compute(bars: readonly Bar[], rawParams: unknown): IndicatorOutput;
}

// ---------------------------------------------------------------------------
// Internal registry state
// ---------------------------------------------------------------------------

const _registry = new Map<string, IndicatorDef>();

// ---------------------------------------------------------------------------
// Registry API
// ---------------------------------------------------------------------------

/** Register an indicator definition. Overwrites if id already exists. */
export function register(def: IndicatorDef): void {
  _registry.set(def.id, def);
}

/** Retrieve a definition by id. Throws if not registered. */
export function get(id: string): IndicatorDef {
  const def = _registry.get(id);
  if (!def) throw new Error(`Indicator '${id}' not registered.`);
  return def;
}

/**
 * Compute indicator `id` over `bars` using `rawParams`.
 * Thin wrapper: resolves the def and calls def.compute().
 */
export function compute(id: string, bars: readonly Bar[], rawParams: unknown): IndicatorOutput {
  return get(id).compute(bars, rawParams);
}

/** List all registered indicator ids + labels. */
export function listIndicators(): { id: string; label: string }[] {
  return Array.from(_registry.values()).map(({ id, label }) => ({ id, label }));
}

// ---------------------------------------------------------------------------
// Built-in indicator definitions
// ---------------------------------------------------------------------------

// --- SMA ----------------------------------------------------------------
register({
  id: 'sma',
  label: 'Simple Moving Average (SMA)',
  params: z.object({ period: z.number().int().positive().default(20) }),
  compute(bars, rawParams) {
    const { period } = z.object({ period: z.number().int().positive().default(20) }).parse(rawParams);
    return padLeft(ta.sma(closes(bars), period), bars.length);
  },
});

// --- EMA ----------------------------------------------------------------
register({
  id: 'ema',
  label: 'Exponential Moving Average (EMA)',
  params: z.object({ period: z.number().int().positive().default(20) }),
  compute(bars, rawParams) {
    const { period } = z.object({ period: z.number().int().positive().default(20) }).parse(rawParams);
    return padLeft(ta.ema(closes(bars), period), bars.length);
  },
});

// --- WMA ----------------------------------------------------------------
register({
  id: 'wma',
  label: 'Weighted Moving Average (WMA)',
  params: z.object({ period: z.number().int().positive().default(20) }),
  compute(bars, rawParams) {
    const { period } = z.object({ period: z.number().int().positive().default(20) }).parse(rawParams);
    return padLeft(ta.wma(closes(bars), period), bars.length);
  },
});

// --- RSI ----------------------------------------------------------------
register({
  id: 'rsi',
  label: 'Relative Strength Index (RSI)',
  params: z.object({ period: z.number().int().positive().default(14) }),
  compute(bars, rawParams) {
    const { period } = z.object({ period: z.number().int().positive().default(14) }).parse(rawParams);
    return padLeft(ta.rsi(closes(bars), period), bars.length);
  },
});

// --- MACD ---------------------------------------------------------------
// lib returns [macd, signal, histogram]; output order verified from type defs.
const macdSchema = z.object({
  short: z.number().int().positive().default(12),
  long:  z.number().int().positive().default(26),
  signal: z.number().int().positive().default(9),
});

register({
  id: 'macd',
  label: 'MACD (Moving Average Convergence Divergence)',
  params: macdSchema,
  compute(bars, rawParams) {
    const p = macdSchema.parse(rawParams);
    const [macdLine, signalLine, histogram] = padLeftAll(
      ta.macd(closes(bars), p.short, p.long, p.signal),
      bars.length,
    );
    return { macd: macdLine, signal: signalLine, histogram };
  },
});

// --- Bollinger Bands ----------------------------------------------------
// lib returns [lower, middle, upper]; output order verified from type defs.
const bbandsSchema = z.object({
  period: z.number().int().positive().default(20),
  stddev: z.number().positive().default(2),
});

register({
  id: 'bbands',
  label: 'Bollinger Bands',
  params: bbandsSchema,
  compute(bars, rawParams) {
    const p = bbandsSchema.parse(rawParams);
    const [lower, middle, upper] = padLeftAll(
      ta.bbands(closes(bars), p.period, p.stddev),
      bars.length,
    );
    return { lower, middle, upper };
  },
});

// --- ATR ----------------------------------------------------------------
register({
  id: 'atr',
  label: 'Average True Range (ATR)',
  params: z.object({ period: z.number().int().positive().default(14) }),
  compute(bars, rawParams) {
    const { period } = z.object({ period: z.number().int().positive().default(14) }).parse(rawParams);
    return padLeft(ta.atr(highs(bars), lows(bars), closes(bars), period), bars.length);
  },
});

// --- Stochastic ---------------------------------------------------------
// lib returns [k, d].
const stochSchema = z.object({
  kperiod: z.number().int().positive().default(14),
  kslow:   z.number().int().positive().default(3),
  dperiod: z.number().int().positive().default(3),
});

register({
  id: 'stoch',
  label: 'Stochastic Oscillator',
  params: stochSchema,
  compute(bars, rawParams) {
    const p = stochSchema.parse(rawParams);
    const [k, d] = padLeftAll(
      ta.stoch(highs(bars), lows(bars), closes(bars), p.kperiod, p.kslow, p.dperiod),
      bars.length,
    );
    return { k, d };
  },
});

// --- StochRSI -----------------------------------------------------------
register({
  id: 'stochrsi',
  label: 'Stochastic RSI',
  params: z.object({ period: z.number().int().positive().default(14) }),
  compute(bars, rawParams) {
    const { period } = z.object({ period: z.number().int().positive().default(14) }).parse(rawParams);
    return padLeft(ta.stochrsi(closes(bars), period), bars.length);
  },
});

// --- ADX ----------------------------------------------------------------
// lib signature: adx(high, low, period) - no close param.
register({
  id: 'adx',
  label: 'Average Directional Index (ADX)',
  params: z.object({ period: z.number().int().positive().default(14) }),
  compute(bars, rawParams) {
    const { period } = z.object({ period: z.number().int().positive().default(14) }).parse(rawParams);
    return padLeft(ta.adx(highs(bars), lows(bars), period), bars.length);
  },
});

// --- OBV ----------------------------------------------------------------
register({
  id: 'obv',
  label: 'On-Balance Volume (OBV)',
  params: z.object({}),
  compute(bars, _rawParams) {
    return padLeft(ta.obv(closes(bars), volumes(bars)), bars.length);
  },
});

// --- VWAP (rolling) -----------------------------------------------------
register({
  id: 'vwap',
  label: 'Volume-Weighted Average Price (VWAP)',
  params: z.object({ period: z.number().int().positive().default(14) }),
  compute(bars, rawParams) {
    const { period } = z.object({ period: z.number().int().positive().default(14) }).parse(rawParams);
    return padLeft(ta.vwap(highs(bars), lows(bars), closes(bars), volumes(bars), period), bars.length);
  },
});

// --- ROC ----------------------------------------------------------------
register({
  id: 'roc',
  label: 'Rate of Change (ROC)',
  params: z.object({ period: z.number().int().positive().default(12) }),
  compute(bars, rawParams) {
    const { period } = z.object({ period: z.number().int().positive().default(12) }).parse(rawParams);
    return padLeft(ta.roc(closes(bars), period), bars.length);
  },
});

// --- Williams %R --------------------------------------------------------
register({
  id: 'willr',
  label: "Williams %R",
  params: z.object({ period: z.number().int().positive().default(14) }),
  compute(bars, rawParams) {
    const { period } = z.object({ period: z.number().int().positive().default(14) }).parse(rawParams);
    return padLeft(ta.willr(highs(bars), lows(bars), closes(bars), period), bars.length);
  },
});
