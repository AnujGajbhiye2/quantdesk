/**
 * EMA50 Fib Discount Pullback swing strategy (from transcript strat-4).
 *
 * Video rules:
 *   - Filter: price above the 50 EMA (uptrend).
 *   - Pullback: at least 3 consecutive red candles.
 *   - Discount zone: price below the 50% retracement of the most recent
 *     swing low -> swing high move.
 *   - Trigger: one green confirmation candle.
 *   - Stop: below the swing low. Target ~3R.
 */

import { z } from 'zod';
import type { Strategy, StrategyContext, StrategyDecision } from '../Strategy';

const paramsSchema = z.object({
  emaPeriod:     z.number().int().positive().default(50),
  redCandles:    z.number().int().positive().default(3),
  swingLookback: z.number().int().positive().default(20),
  retraceLevel:  z.number().positive().max(1).default(0.5),
  targetR:       z.number().positive().default(3),
  maxHoldBars:   z.number().int().positive().default(15),
  sizePct:       z.number().positive().max(1).default(1),
});

export class Ema50FibPullbackStrategy implements Strategy {
  readonly id          = 'ema50-fib-pullback';
  readonly name        = 'EMA50 Fib Discount Pullback';
  readonly description = 'Above the EMA50, after 3+ consecutive red candles pulling into the discount zone (below the 50% retracement of the last swing), buy the green confirmation candle; stop at the swing low, 3R target.';
  readonly tier        = 'production' as const;
  readonly params      = paramsSchema;

  onBar(ctx: StrategyContext, rawParams: unknown): StrategyDecision {
    const p = paramsSchema.parse(rawParams);
    const i = ctx.i;
    const bars = ctx.bars;

    if (ctx.position !== 'flat' || i < p.emaPeriod + p.swingLookback) {
      // Exits handled entirely by stop/target/time knobs
      return { action: 'hold' };
    }

    const bar = bars[i];
    const ema = ctx.indicator('ema', { period: p.emaPeriod }) as number[];
    if (!Number.isFinite(ema[i])) return { action: 'hold' };

    const trend   = bar.close > ema[i];
    const confirm = bar.close > bar.open;
    if (!trend || !confirm) return { action: 'hold' };

    // Pullback: the redCandles bars before this one are all red
    for (let j = i - p.redCandles; j < i; j++) {
      if (bars[j].close >= bars[j].open) return { action: 'hold' };
    }

    // ponytail: naive swing detection - rolling-window extremes, not fractal
    // pivots; upgrade to k-bar pivot confirmation if fills look wrong on data.
    const start = i - p.swingLookback;
    let hIdx = start;
    for (let j = start; j < i; j++) {
      if (bars[j].high > bars[hIdx].high) hIdx = j;
    }
    // Swing high must predate the pullback leg
    if (hIdx > i - p.redCandles - 1) return { action: 'hold' };
    const swingHigh = bars[hIdx].high;
    let swingLow = Infinity;
    for (let j = start; j <= hIdx; j++) swingLow = Math.min(swingLow, bars[j].low);
    if (!(swingHigh > swingLow) || !(swingLow < bar.close)) return { action: 'hold' };

    const discount = bar.close < swingLow + p.retraceLevel * (swingHigh - swingLow);
    if (!discount) return { action: 'hold' };

    const stopPct = (bar.close - swingLow) / bar.close;
    return {
      action:      'enter_long',
      stopPct,
      targetPct:   p.targetR * stopPct,
      sizePct:     p.sizePct,
      maxHoldBars: p.maxHoldBars,
      reason:      `green confirmation in discount zone after ${p.redCandles}+ red candles above EMA${p.emaPeriod}`,
    };
  }
}
