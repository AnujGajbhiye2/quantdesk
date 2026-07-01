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

  // --- Improvement 1: Trailing stop ---
  /**
   * Arm the trailing stop once the trade is profitable by this fraction
   * (e.g. 0.03 = trail activates when trade is up 3%). Only read on entry.
   */
  trailingStopActivationPct?: number;
  /**
   * Once armed, trail the stop this fraction below the running peak close
   * (long) / above the running trough close (short). e.g. 0.02 = trail 2%
   * from peak. Only read on entry.
   */
  trailingStopDistancePct?: number;

  // --- Improvement 2: Gap filter ---
  /**
   * If next-bar open gaps up more than this fraction above the signal close
   * (long entry), skip the trade - the bounce already happened overnight.
   * e.g. 0.03 = skip if gap > 3%. Only read on entry.
   */
  maxEntrySlippagePct?: number;
  /**
   * If next-bar open gaps down more than this fraction below the signal close
   * (long entry), widen the stop from signal-close to fill-price basis so
   * the gap itself does not trigger an immediate stop-out. e.g. 0.02.
   * Only read on entry.
   */
  gapDownWidenPct?: number;

  // --- Improvement 5: Partial profit taking ---
  /**
   * Fraction of qty to close when the partial target is hit (e.g. 0.5 = half).
   * The runner stays open to the full target. Only read on entry.
   */
  partialExitFraction?: number;
  /**
   * Fraction of the full target distance at which to trigger the partial exit
   * (e.g. 0.5 = halfway to full target). Only read on entry.
   */
  partialExitAtTargetPct?: number;
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

  /**
   * Improvement 3 - optional signal-strength scorer (0..1).
   *
   * Called at bar i when an entry signal fires. Returns a normalised conviction
   * score used by the engine to scale position size (0.5x..2x base sizePct).
   * Must obey the same no-look-ahead contract as onBar: reads only bars[0..i]
   * and causal indicator slices. When absent, flat sizing is used.
   */
  signalStrength?(ctx: StrategyContext, rawParams: unknown): number;
}
