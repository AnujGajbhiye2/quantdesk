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
  period:  z.number().int().positive().default(20),
  stddev:  z.number().positive().default(2),
  stopPct: z.number().positive().optional(),
  sizePct: z.number().positive().max(1).default(1),
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

    if (!Number.isFinite(lower) || !Number.isFinite(middle)) return { action: 'hold' };

    if (ctx.position === 'flat') {
      if (close < lower) {
        return {
          action:  'enter_long',
          stopPct: p.stopPct,
          sizePct: p.sizePct,
          reason:  `close ${close.toFixed(2)} < lower BB ${lower.toFixed(2)}`,
        };
      }
    }

    if (ctx.position === 'long') {
      if (close >= middle) {
        return {
          action: 'exit',
          reason: `close ${close.toFixed(2)} recovered to mid BB ${middle.toFixed(2)}`,
        };
      }
    }

    return { action: 'hold' };
  }
}
