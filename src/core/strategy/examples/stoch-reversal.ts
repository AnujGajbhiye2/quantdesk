/**
 * Stochastic Oversold Reversal Strategy.
 *
 * Logic:
 *   Entry long : Stochastic %K crosses above %D while both are in the oversold zone (<= oversoldLevel).
 *                This signals a short-term reversal from oversold conditions.
 *   Exit long  : Stochastic %K reaches overbought territory (>= overboughtLevel).
 *
 * Swing-trade oriented; best on daily timeframe where stochastic oscillations
 * represent multi-day exhaustion and recovery cycles.
 *
 * Conservative: all indicator values guarded with Number.isFinite().
 * No look-ahead: only reads ctx.bars[ctx.i] and ctx.bars[ctx.i-1].
 */

import { z } from 'zod';
import type { Strategy, StrategyContext, StrategyDecision } from '../Strategy';

const paramsSchema = z.object({
  kperiod:       z.number().int().positive().default(14),
  kslow:         z.number().int().positive().default(3),
  dperiod:       z.number().int().positive().default(3),
  oversoldLevel: z.number().positive().default(20),
  overboughtLevel: z.number().positive().default(80),
  stopPct:       z.number().positive().optional(),
  targetPct:     z.number().positive().optional(),
  sizePct:       z.number().positive().max(1).default(1),
});

export class StochReversalStrategy implements Strategy {
  readonly id          = 'stoch-reversal';
  readonly name        = 'Stochastic Oversold Reversal';
  readonly description = 'Enter long when Stochastic %K crosses above %D from the oversold zone; exit in overbought territory.';
  readonly tier        = 'baseline' as const;
  readonly params      = paramsSchema;

  onBar(ctx: StrategyContext, rawParams: unknown): StrategyDecision {
    const p     = paramsSchema.parse(rawParams);
    const stoch = ctx.indicator('stoch', {
      kperiod: p.kperiod,
      kslow:   p.kslow,
      dperiod: p.dperiod,
    }) as { k: number[]; d: number[] };

    if (ctx.i < 1) return { action: 'hold' };

    const kNow  = stoch.k[ctx.i];
    const dNow  = stoch.d[ctx.i];
    const kPrev = stoch.k[ctx.i - 1];
    const dPrev = stoch.d[ctx.i - 1];

    if (
      !Number.isFinite(kNow) ||
      !Number.isFinite(dNow) ||
      !Number.isFinite(kPrev) ||
      !Number.isFinite(dPrev)
    ) return { action: 'hold' };

    // Bullish cross: K crosses above D while in oversold zone
    const crossedUp = kPrev <= dPrev && kNow > dNow;
    const oversold  = kNow <= p.oversoldLevel && dNow <= p.oversoldLevel;

    if (ctx.position === 'flat') {
      if (crossedUp && oversold) {
        return {
          action:    'enter_long',
          stopPct:   p.stopPct,
          targetPct: p.targetPct,
          sizePct:   p.sizePct,
          reason:    `Stoch K=${kNow.toFixed(1)} crossed above D=${dNow.toFixed(1)} in oversold zone`,
        };
      }
    }

    if (ctx.position === 'long') {
      if (kNow >= p.overboughtLevel) {
        return {
          action: 'exit',
          reason: `Stoch K=${kNow.toFixed(1)} reached overbought ${p.overboughtLevel}`,
        };
      }
    }

    return { action: 'hold' };
  }
}
