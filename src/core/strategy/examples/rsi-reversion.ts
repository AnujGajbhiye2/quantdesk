/**
 * RSI Mean Reversion strategy.
 *
 * Logic: enter long when RSI drops below the oversold threshold;
 * exit when RSI recovers above the exit level.
 *
 * Clone this file to author a new strategy:
 * 1. Rename the class and update id/name/description.
 * 2. Edit the paramsSchema and onBar logic.
 * 3. Register in strategy/registry.ts (one line).
 */

import { z } from 'zod';
import type { Strategy, StrategyContext, StrategyDecision } from '../Strategy';

const paramsSchema = z.object({
  period:     z.number().int().positive().default(14),
  oversold:   z.number().positive().default(30),
  exitLevel:  z.number().positive().default(50),
  stopPct:    z.number().positive().optional(),
  targetPct:  z.number().positive().optional(),
  sizePct:    z.number().positive().max(1).default(1),
});

export class RSIReversionStrategy implements Strategy {
  readonly id          = 'rsi-reversion';
  readonly name        = 'RSI Mean Reversion';
  readonly description = 'Enter long when RSI drops below oversold; exit when RSI recovers above exit level.';
  readonly tier        = 'baseline' as const;
  readonly params      = paramsSchema;

  onBar(ctx: StrategyContext, rawParams: unknown): StrategyDecision {
    const p = paramsSchema.parse(rawParams);
    const rsi    = ctx.indicator('rsi', { period: p.period }) as number[];
    const rsiNow = rsi[ctx.i];

    if (ctx.position === 'flat') {
      if (Number.isFinite(rsiNow) && rsiNow < p.oversold) {
        return {
          action:    'enter_long',
          stopPct:   p.stopPct,
          targetPct: p.targetPct,
          sizePct:   p.sizePct,
          reason:    `RSI(${p.period})=${rsiNow.toFixed(1)} < ${p.oversold} oversold`,
        };
      }
    }

    if (ctx.position === 'long') {
      if (Number.isFinite(rsiNow) && rsiNow > p.exitLevel) {
        return {
          action: 'exit',
          reason: `RSI(${p.period})=${rsiNow.toFixed(1)} > ${p.exitLevel} exit level`,
        };
      }
    }

    return { action: 'hold' };
  }
}
