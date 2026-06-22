/**
 * Bollinger Band Mean Reversion Strategy.
 *
 * Logic:
 *   Entry long : close crosses below the lower Bollinger Band (price too cheap vs volatility).
 *   Exit long  : close recovers to or above the middle band (SMA).
 *
 * Swing-trade style: holds for a few bars on average; best on daily timeframe.
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
  /** Entry suppressed when symbol ADX >= adxMax (trending). Default 100 = gate off. */
  adxMax:    z.number().positive().default(100),
});

export class BollingerReversionStrategy implements Strategy {
  readonly id          = 'bollinger-reversion';
  readonly name        = 'Bollinger Band Mean Reversion';
  readonly description = 'Enter long when price drops below lower BB; exit when price recovers to the middle band (SMA).';
  readonly tier        = 'baseline' as const;
  readonly params      = paramsSchema;

  onBar(ctx: StrategyContext, rawParams: unknown): StrategyDecision {
    const p  = paramsSchema.parse(rawParams);
    const bb = ctx.indicator('bbands', { period: p.period, stddev: p.stddev }) as {
      lower:  number[];
      middle: number[];
      upper:  number[];
    };

    const close  = ctx.bars[ctx.i].close;
    const lower  = bb.lower[ctx.i];
    const middle = bb.middle[ctx.i];

    if (!Number.isFinite(lower) || !Number.isFinite(middle)) {
      return { action: 'hold', reason: `warming up - BB(${p.period}) not ready` };
    }

    if (ctx.position === 'flat') {
      if (close < lower) {
        // ADX ranging gate: skip entry when trending (NaN = warm-up, pass)
        const adxArr = ctx.indicator('adx', { period: p.adxPeriod }) as number[];
        const adxNow = adxArr[ctx.i];
        if (Number.isFinite(adxNow) && adxNow >= p.adxMax) {
          return { action: 'hold', reason: `ADX=${adxNow.toFixed(1)} >= ${p.adxMax} - trending, gate blocked` };
        }
        return {
          action:  'enter_long',
          stopPct: p.stopPct,
          sizePct: p.sizePct,
          reason:  `close ${close.toFixed(2)} < lower BB ${lower.toFixed(2)}`,
        };
      }
      return { action: 'hold', reason: `close ${close.toFixed(2)} >= lower BB ${lower.toFixed(2)} - not oversold` };
    }

    if (ctx.position === 'long') {
      if (close >= middle) {
        return {
          action: 'exit',
          reason: `close ${close.toFixed(2)} recovered to mid BB ${middle.toFixed(2)}`,
        };
      }
      return { action: 'hold', reason: `close ${close.toFixed(2)} < mid BB ${middle.toFixed(2)} - still below target` };
    }

    return { action: 'hold' };
  }
}
