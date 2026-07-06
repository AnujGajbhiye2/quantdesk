/**
 * Bollinger Band Mean Reversion Short strategy.
 *
 * Logic:
 *   Entry short : close crosses above the upper Bollinger Band (price too rich vs volatility).
 *   Exit short  : close drops back to or below the middle band (SMA).
 *
 * Mirror of bollinger-reversion.ts (long) - fades overbought bounces instead of
 * buying oversold dips. Swing-trade style: holds for a few bars on average;
 * best on daily timeframe.
 *
 * Conservative: all indicator values guarded with Number.isFinite().
 * No look-ahead: only reads ctx.bars[ctx.i] and earlier.
 */

import { z } from 'zod';
import type { Strategy, StrategyContext, StrategyDecision } from '../Strategy';

const paramsSchema = z.object({
  period:    z.number().int().positive().default(20),
  stddev:    z.number().positive().default(2),
  stopPct:   z.number().positive().optional(),
  sizePct:   z.number().positive().max(1).default(1),
  adxPeriod: z.number().int().positive().default(14),
  /**
   * Entry suppressed when symbol ADX >= adxMax (trending). Default 100 =
   * gate off. Mirrors the long strategy's adxMax default - see
   * bollinger-reversion.ts for the walk-forward evidence against flipping it.
   */
  adxMax:    z.number().positive().default(100),
});

export class BollingerReversionShortStrategy implements Strategy {
  readonly id          = 'bollinger-reversion-short';
  readonly name        = 'Bollinger Band Mean Reversion Short';
  readonly description = 'Enter short when price rises above upper BB; exit when price drops back to the middle band (SMA).';
  readonly tier        = 'baseline' as const;
  readonly params      = paramsSchema;

  /**
   * Signal strength for dynamic sizing (mirror of the long band-width logic).
   * Higher above upper band = stronger signal.
   * strength = (close - upper) / (upper - lower), clamped 0..1.
   * At upper band -> 0, one full band-width above -> 1.
   * Causal: reads only bars[0..i].
   */
  signalStrength(ctx: StrategyContext, rawParams: unknown): number {
    const p  = paramsSchema.parse(rawParams);
    const bb = ctx.indicator('bbands', { period: p.period, stddev: p.stddev }) as {
      lower: number[]; middle: number[]; upper: number[];
    };
    const close  = ctx.bars[ctx.i].close;
    const lower  = bb.lower[ctx.i];
    const upper  = bb.upper[ctx.i];
    if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper <= lower) return 0.5;
    const bandWidth = upper - lower;
    const dist      = close - upper; // positive when above upper band
    return Math.min(1, Math.max(0, dist / bandWidth));
  }

  onBar(ctx: StrategyContext, rawParams: unknown): StrategyDecision {
    const p  = paramsSchema.parse(rawParams);
    const bb = ctx.indicator('bbands', { period: p.period, stddev: p.stddev }) as {
      lower:  number[];
      middle: number[];
      upper:  number[];
    };

    const close  = ctx.bars[ctx.i].close;
    const upper  = bb.upper[ctx.i];
    const middle = bb.middle[ctx.i];

    if (!Number.isFinite(upper) || !Number.isFinite(middle)) {
      return { action: 'hold', reason: `warming up - BB(${p.period}) not ready` };
    }

    if (ctx.position === 'flat') {
      if (close > upper) {
        // ADX ranging gate: skip entry when trending (NaN = warm-up, pass)
        const adxArr = ctx.indicator('adx', { period: p.adxPeriod }) as number[];
        const adxNow = adxArr[ctx.i];
        if (Number.isFinite(adxNow) && adxNow >= p.adxMax) {
          return { action: 'hold', reason: `ADX=${adxNow.toFixed(1)} >= ${p.adxMax} - trending, gate blocked` };
        }
        return {
          action:  'enter_short',
          stopPct: p.stopPct,
          sizePct: p.sizePct,
          reason:  `close ${close.toFixed(2)} > upper BB ${upper.toFixed(2)}`,
        };
      }
      return { action: 'hold', reason: `close ${close.toFixed(2)} <= upper BB ${upper.toFixed(2)} - not overbought` };
    }

    if (ctx.position === 'short') {
      if (close <= middle) {
        return {
          action: 'exit',
          reason: `close ${close.toFixed(2)} dropped to mid BB ${middle.toFixed(2)}`,
        };
      }
      return { action: 'hold', reason: `close ${close.toFixed(2)} > mid BB ${middle.toFixed(2)} - still above target` };
    }

    return { action: 'hold' };
  }
}
