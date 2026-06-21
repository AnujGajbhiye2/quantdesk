/**
 * ATR Trailing Stop Trend Strategy.
 *
 * Logic:
 *   Entry long : price closes above its EMA (uptrend confirmation).
 *   Exit long  : the trailing stop level (high-water-mark close minus
 *                multiplier * ATR) is breached by the current close.
 *
 * The trailing stop rises with new closing highs and never falls back.
 * It is tracked in strategy state via a module-level WeakMap keyed on the
 * context's bars array reference (each backtest / scan call passes a distinct
 * slice, so there is no cross-call leakage).
 *
 * Conservative: all indicator values guarded with Number.isFinite().
 * No look-ahead: only reads ctx.bars[ctx.i] and earlier.
 */

import { z } from 'zod';
import type { Strategy, StrategyContext, StrategyDecision } from '../Strategy';

const paramsSchema = z.object({
  emaPeriod:   z.number().int().positive().default(20),
  atrPeriod:   z.number().int().positive().default(14),
  atrMultiple: z.number().positive().default(2.5),
  targetPct:   z.number().positive().optional(),
  sizePct:     z.number().positive().max(1).default(1),
});

// Per-run trailing stop state: keyed on the bars array reference.
// Stores the current trailing stop level once a position is open.
const trailingState = new WeakMap<ReadonlyArray<object>, { stopLevel: number }>();

export class AtrTrendStrategy implements Strategy {
  readonly id          = 'atr-trend';
  readonly name        = 'ATR Trailing Stop Trend';
  readonly description = 'Enter long when price is above EMA; trailing stop rises with new closing highs (HWM - multiplier * ATR).';
  readonly tier        = 'baseline' as const;
  readonly params      = paramsSchema;

  onBar(ctx: StrategyContext, rawParams: unknown): StrategyDecision {
    const p   = paramsSchema.parse(rawParams);
    const ema = ctx.indicator('ema', { period: p.emaPeriod }) as number[];
    const atr = ctx.indicator('atr', { period: p.atrPeriod }) as number[];

    const emaNow = ema[ctx.i];
    const atrNow = atr[ctx.i];
    const close  = ctx.bars[ctx.i].close;

    if (!Number.isFinite(emaNow) || !Number.isFinite(atrNow)) return { action: 'hold' };

    if (ctx.position === 'flat') {
      // Clear any stale trailing state from a previous position on this run
      trailingState.delete(ctx.bars);

      if (close > emaNow) {
        const stopPct = (p.atrMultiple * atrNow) / close;
        // Initialise trailing stop at entry close
        trailingState.set(ctx.bars, { stopLevel: close - p.atrMultiple * atrNow });
        return {
          action:    'enter_long',
          stopPct,
          targetPct: p.targetPct,
          sizePct:   p.sizePct,
          reason:    `price ${close.toFixed(2)} > EMA(${p.emaPeriod})=${emaNow.toFixed(2)}; ATR stop=${(p.atrMultiple * atrNow).toFixed(2)}`,
        };
      }
    }

    if (ctx.position === 'long') {
      const state = trailingState.get(ctx.bars);
      if (!state) {
        // State lost (shouldn't happen in normal use) - exit defensively
        return { action: 'exit', reason: 'trailing state lost - defensive exit' };
      }

      // Raise stop if new closing high warrants it; never lower it
      const newLevel = close - p.atrMultiple * atrNow;
      if (newLevel > state.stopLevel) {
        state.stopLevel = newLevel;
      }

      if (close < state.stopLevel) {
        trailingState.delete(ctx.bars);
        return {
          action: 'exit',
          reason: `ATR trailing stop ${state.stopLevel.toFixed(2)} breached`,
        };
      }
    }

    return { action: 'hold' };
  }
}
