/**
 * EMA20 Pullback Trend swing strategy.
 *
 * Logic: in an established momentum trend (SMA50 > SMA200), price pulling back
 * to the EMA20 and closing back above it marks a continuation entry with a
 * defined invalidation level. Enter long with a 2x ATR stop and 4x ATR target
 * (2R) - exits are pure stop/target/time, no discretionary signal exit.
 *
 * Hold profile: days to weeks; hard cap via maxHoldBars (default 21).
 */

import { z } from 'zod';
import type { Strategy, StrategyContext, StrategyDecision } from '../Strategy';

const paramsSchema = z.object({
  emaPeriod:     z.number().int().positive().default(20),
  fastSma:       z.number().int().positive().default(50),
  slowSma:       z.number().int().positive().default(200),
  atrPeriod:     z.number().int().positive().default(14),
  atrStopMult:   z.number().positive().default(2),
  atrTargetMult: z.number().positive().default(4),
  maxHoldBars:   z.number().int().positive().default(21),
  sizePct:       z.number().positive().max(1).default(1),
});

export class EmaPullbackStrategy implements Strategy {
  readonly id          = 'ema-pullback';
  readonly name        = 'EMA20 Pullback Trend';
  readonly description = 'In an SMA50 > SMA200 uptrend, buy the reclaim after price dips to EMA20; 2x ATR stop, 4x ATR target (2R), 21-bar time stop.';
  readonly params      = paramsSchema;

  onBar(ctx: StrategyContext, rawParams: unknown): StrategyDecision {
    const p = paramsSchema.parse(rawParams);
    const i = ctx.i;
    if (ctx.position !== 'flat' || i < 1) {
      // Exits are handled entirely by stop/target/time - nothing to decide here
      return { action: 'hold' };
    }

    const bar  = ctx.bars[i];
    const prev = ctx.bars[i - 1];

    const ema  = ctx.indicator('ema', { period: p.emaPeriod }) as number[];
    const fast = ctx.indicator('sma', { period: p.fastSma })  as number[];
    const slow = ctx.indicator('sma', { period: p.slowSma })  as number[];

    const emaNow  = ema[i];
    const emaPrev = ema[i - 1];
    const fastNow = fast[i];
    const slowNow = slow[i];

    if (![emaNow, emaPrev, fastNow, slowNow].every(Number.isFinite)) {
      return { action: 'hold' };
    }

    const uptrend   = fastNow > slowNow;
    // Pullback touched the EMA20 on the prior bar, current bar closed back above it
    const dipped    = prev.low <= emaPrev;
    const reclaimed = bar.close > emaNow;

    if (uptrend && dipped && reclaimed) {
      const atr    = ctx.indicator('atr', { period: p.atrPeriod }) as number[];
      const atrNow = atr[i];
      if (!Number.isFinite(atrNow) || bar.close <= 0) return { action: 'hold' };
      return {
        action:      'enter_long',
        stopPct:     (p.atrStopMult * atrNow) / bar.close,
        targetPct:   (p.atrTargetMult * atrNow) / bar.close,
        sizePct:     p.sizePct,
        maxHoldBars: p.maxHoldBars,
        reason:      `EMA${p.emaPeriod} reclaim in SMA${p.fastSma}>SMA${p.slowSma} uptrend`,
      };
    }

    return { action: 'hold' };
  }
}
