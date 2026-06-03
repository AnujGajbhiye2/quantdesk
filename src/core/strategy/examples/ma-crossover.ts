/**
 * SMA Crossover strategy.
 *
 * Logic: enter long when the fast SMA crosses above the slow SMA (golden cross);
 * exit when the fast SMA crosses back below (death cross).
 *
 * The cross is detected by comparing bar[i-1] vs bar[i] values - both indices are
 * within the causal slice, so no look-ahead is possible.
 */

import { z } from 'zod';
import type { Strategy, StrategyContext, StrategyDecision } from '../Strategy';

const paramsSchema = z.object({
  fast:      z.number().int().positive().default(50),
  slow:      z.number().int().positive().default(200),
  stopPct:   z.number().positive().optional(),
  targetPct: z.number().positive().optional(),
  sizePct:   z.number().positive().max(1).default(1),
});

export class MACrossoverStrategy implements Strategy {
  readonly id          = 'ma-crossover';
  readonly name        = 'SMA Crossover';
  readonly description = 'Enter long on golden cross (fast SMA above slow SMA); exit on death cross.';
  readonly params      = paramsSchema;

  onBar(ctx: StrategyContext, rawParams: unknown): StrategyDecision {
    const p = paramsSchema.parse(rawParams);

    // Need at least 2 bars to detect a cross
    if (ctx.i < 1) return { action: 'hold' };

    const fast = ctx.indicator('sma', { period: p.fast }) as number[];
    const slow = ctx.indicator('sma', { period: p.slow }) as number[];

    const f0 = fast[ctx.i - 1], f1 = fast[ctx.i];
    const s0 = slow[ctx.i - 1], s1 = slow[ctx.i];

    if (![f0, f1, s0, s1].every(Number.isFinite)) return { action: 'hold' };

    const crossedUp   = f0 <= s0 && f1 > s1;
    const crossedDown = f0 >= s0 && f1 < s1;

    if (ctx.position === 'flat' && crossedUp) {
      return {
        action:    'enter_long',
        stopPct:   p.stopPct,
        targetPct: p.targetPct,
        sizePct:   p.sizePct,
        reason:    `SMA(${p.fast}) crossed above SMA(${p.slow})`,
      };
    }

    if (ctx.position === 'long' && crossedDown) {
      return {
        action: 'exit',
        reason: `SMA(${p.fast}) crossed below SMA(${p.slow})`,
      };
    }

    return { action: 'hold' };
  }
}
