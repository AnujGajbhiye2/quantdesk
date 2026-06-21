/**
 * Strategy interface - the public contract for all trading strategies.
 *
 * Rules every implementation must honour:
 * - onBar MUST be pure: no I/O, no Date.now(), no external state mutation.
 * - onBar MUST NOT look ahead. ctx.bars is a frozen slice 0..i; reading
 *   ctx.bars[i+1] returns undefined. Writes throw TypeError.
 * - rawParams is `unknown` (not `any`) per the no-any rule for core contracts.
 *   Each strategy parses it internally with its own Zod schema inside onBar.
 *   This matches the IndicatorDef pattern in indicators/registry.ts.
 */

import { z } from 'zod';
import type { Bar } from '@/core/types';
import type { IndicatorOutput } from '@/core/indicators/registry';
import type { RegimeRequirement } from '@/core/market/regime';

// ---------------------------------------------------------------------------
// Context (what strategies can see per bar)
// ---------------------------------------------------------------------------

export interface StrategyContext {
  /**
   * Frozen slice allBars[0..i]. bars[bars.length-1] is the just-closed bar.
   * bars[i+1] === undefined (OOB). Writes throw TypeError (frozen + strict mode).
   * This is the structural no-look-ahead guarantee.
   */
  readonly bars: ReadonlyArray<Bar>;
  /** Current bar index (0-based). bars[i] === bars[bars.length-1]. */
  readonly i: number;
  /** Position state entering this bar (before onBar fires). */
  readonly position: 'long' | 'short' | 'flat';
  /**
   * Precomputed + cached indicator for the full symbol series.
   * Returns a causal slice 0..i: only indices 0..i present.
   * output[i] is NaN during warm-up, finite once warm-up is satisfied.
   * Multi-output indicators (MACD, BBands, Stoch) return Record<string, number[]>.
   */
  indicator(id: string, params?: object): IndicatorOutput;
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export interface StrategyDecision {
  action: 'enter_long' | 'enter_short' | 'exit' | 'hold';
  /** Stop-loss distance as fraction of entry price (e.g. 0.05 = 5%). */
  stopPct?: number;
  /** Profit-target distance as fraction of entry price (e.g. 0.10 = 10%). */
  targetPct?: number;
  /** Fraction of current equity to allocate (0..1]. Default 1.0. */
  sizePct?: number;
  /**
   * Maximum bars to hold this position before a forced time exit (fills at
   * the next bar's open). The engine takes min(this, config.maxHoldBars).
   * Only read on entry decisions.
   */
  maxHoldBars?: number;
  /** Human-readable reason surfaced in the trade record and signal UI. */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Strategy interface
// ---------------------------------------------------------------------------

export interface Strategy {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /**
   * Zod schema describing all params with .default() on every field.
   * Used by the engine to normalise raw params and by the UI for param forms.
   */
  readonly params: z.ZodTypeAny;
  /**
   * Optional market-level precondition. When present, the scanner and backtest
   * engine suppress entry signals until the regime requirement is satisfied.
   * onBar() is never aware of this - it remains pure.
   *
   * Examples:
   *   { kind: 'market-trend', index: '^GSPC', over: 'sma', period: 200 }
   *   { kind: 'adx', index: '^GSPC', max: 20 }   // ranging - for MR strategies
   *   { kind: 'volatility', index: '^VIX', max: 30 }
   */
  readonly regime?: RegimeRequirement;
  /**
   * Strategy quality tier.
   * 'baseline' - single-indicator textbook patterns (RSI<30, golden cross, etc.).
   *   Use for learning and comparison. Do not allocate real capital without
   *   walk-forward validation and a regime filter.
   * 'production' - trend-filtered, multi-condition entries with defined stop/target/time
   *   exits. Suitable candidates for walk-forward testing and live paper-trading.
   * Omitting tier is equivalent to 'baseline'.
   */
  readonly tier?: 'baseline' | 'production';
  /**
   * Called once per bar with a no-look-ahead context.
   * @param ctx       Causal view: frozen bars[0..i] + precomputed indicator slices.
   * @param rawParams Raw params; call this.params.parse(rawParams) inside.
   */
  onBar(ctx: StrategyContext, rawParams: unknown): StrategyDecision;
}
