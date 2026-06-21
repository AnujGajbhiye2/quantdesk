/**
 * MACD Momentum strategy.
 *
 * Logic: enter long when the MACD line crosses above the signal line and the
 * histogram is positive (momentum confirmation); exit on cross-under.
 *
 * Uses the multi-output shape: ctx.indicator('macd', ...) returns
 * { macd: number[], signal: number[], histogram: number[] }.
 */

import { z } from 'zod';
import type { Strategy, StrategyContext, StrategyDecision } from '../Strategy';

const paramsSchema = z.object({
  short:     z.number().int().positive().default(12),
  long:      z.number().int().positive().default(26),
  signal:    z.number().int().positive().default(9),
  stopPct:   z.number().positive().optional(),
  targetPct: z.number().positive().optional(),
  sizePct:   z.number().positive().max(1).default(1),
});

export class MACDMomentumStrategy implements Strategy {
  readonly id          = 'macd-momentum';
  readonly name        = 'MACD Momentum';
  readonly description = 'Enter long when MACD crosses above signal with positive histogram; exit on cross-under.';
  readonly tier        = 'baseline' as const;
  readonly params      = paramsSchema;

  onBar(ctx: StrategyContext, rawParams: unknown): StrategyDecision {
    const p = paramsSchema.parse(rawParams);

    if (ctx.i < 1) return { action: 'hold' };

    const out = ctx.indicator('macd', { short: p.short, long: p.long, signal: p.signal }) as {
      macd:      number[];
      signal:    number[];
      histogram: number[];
    };

    const m0 = out.macd[ctx.i - 1],    m1 = out.macd[ctx.i];
    const s0 = out.signal[ctx.i - 1],  s1 = out.signal[ctx.i];
    const h1 = out.histogram[ctx.i];

    if (![m0, m1, s0, s1, h1].every(Number.isFinite)) return { action: 'hold' };

    const crossedUp   = m0 <= s0 && m1 > s1;
    const crossedDown = m0 >= s0 && m1 < s1;

    if (ctx.position === 'flat' && crossedUp && h1 > 0) {
      return {
        action:    'enter_long',
        stopPct:   p.stopPct,
        targetPct: p.targetPct,
        sizePct:   p.sizePct,
        reason:    `MACD(${p.short}/${p.long}/${p.signal}) crossed up, hist=${h1.toFixed(4)}`,
      };
    }

    if (ctx.position === 'long' && crossedDown) {
      return {
        action: 'exit',
        reason: `MACD(${p.short}/${p.long}/${p.signal}) crossed down`,
      };
    }

    return { action: 'hold' };
  }
}
