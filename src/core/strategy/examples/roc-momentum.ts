/**
 * Rate-of-Change Momentum Strategy.
 *
 * Logic:
 *   Entry long : ROC > threshold AND price is above its EMA (trend filter).
 *   Exit long  : ROC drops below the exit threshold (momentum fades).
 *
 * The EMA trend filter avoids buying into oversold bounces in downtrends.
 *
 * Conservative: all indicator values guarded with Number.isFinite().
 * No look-ahead: only reads ctx.bars[ctx.i] and earlier.
 */

import { z } from 'zod';
import type { Strategy, StrategyContext, StrategyDecision } from '../Strategy';

const paramsSchema = z.object({
  /** ROC lookback period (bars). */
  rocPeriod:     z.number().int().positive().default(12),
  /** Entry threshold: ROC must exceed this % to trigger a long. */
  entryRoc:      z.number().default(3),
  /** Exit threshold: exit when ROC drops below this %. */
  exitRoc:       z.number().default(0),
  /** EMA trend filter period. Price must be above this EMA to enter. */
  emaPeriod:     z.number().int().positive().default(50),
  stopPct:       z.number().positive().optional(),
  targetPct:     z.number().positive().optional(),
  sizePct:       z.number().positive().max(1).default(1),
});

export class RocMomentumStrategy implements Strategy {
  readonly id          = 'roc-momentum';
  readonly name        = 'ROC Momentum';
  readonly description = 'Enter long when rate-of-change exceeds threshold and price is above EMA trend filter; exit when momentum fades.';
  readonly params      = paramsSchema;

  onBar(ctx: StrategyContext, rawParams: unknown): StrategyDecision {
    const p   = paramsSchema.parse(rawParams);
    const roc = ctx.indicator('roc', { period: p.rocPeriod }) as number[];
    const ema = ctx.indicator('ema', { period: p.emaPeriod }) as number[];

    const rocNow = roc[ctx.i];
    const emaNow = ema[ctx.i];
    const close  = ctx.bars[ctx.i].close;

    if (!Number.isFinite(rocNow) || !Number.isFinite(emaNow)) return { action: 'hold' };

    if (ctx.position === 'flat') {
      if (rocNow > p.entryRoc && close > emaNow) {
        return {
          action:    'enter_long',
          stopPct:   p.stopPct,
          targetPct: p.targetPct,
          sizePct:   p.sizePct,
          reason:    `ROC(${p.rocPeriod})=${rocNow.toFixed(2)}% > ${p.entryRoc}% and price above EMA${p.emaPeriod}`,
        };
      }
    }

    if (ctx.position === 'long') {
      if (rocNow < p.exitRoc) {
        return {
          action: 'exit',
          reason: `ROC(${p.rocPeriod})=${rocNow.toFixed(2)}% < exit threshold ${p.exitRoc}%`,
        };
      }
    }

    return { action: 'hold' };
  }
}
