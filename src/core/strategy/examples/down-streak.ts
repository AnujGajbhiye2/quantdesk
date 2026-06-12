/**
 * Down-Streak Reversion swing strategy.
 *
 * Logic: N (default 3) consecutive lower closes while the long-term trend is
 * up (close > SMA200) marks a routine pullback, not a breakdown. Buy it;
 * exit on the first close above the prior close (streak broken upward),
 * a 2.5x ATR stop, or the time stop.
 *
 * Hold profile: typically 1-5 bars; hard cap via maxHoldBars (default 7).
 */

import { z } from 'zod';
import type { Strategy, StrategyContext, StrategyDecision } from '../Strategy';

const paramsSchema = z.object({
  streakLen:    z.number().int().positive().default(3),
  trendSma:     z.number().int().positive().default(200),
  atrPeriod:    z.number().int().positive().default(14),
  atrStopMult:  z.number().positive().default(2.5),
  maxHoldBars:  z.number().int().positive().default(7),
  sizePct:      z.number().positive().max(1).default(1),
});

export class DownStreakStrategy implements Strategy {
  readonly id          = 'down-streak';
  readonly name        = 'Down-Streak Reversion';
  readonly description = 'Buy 3+ consecutive lower closes in a long-term uptrend; exit on first up-close, 2.5x ATR stop, or 7-bar time stop.';
  readonly params      = paramsSchema;

  onBar(ctx: StrategyContext, rawParams: unknown): StrategyDecision {
    const p = paramsSchema.parse(rawParams);
    const i = ctx.i;
    if (i < p.streakLen) return { action: 'hold' };

    const close     = ctx.bars[i].close;
    const prevClose = ctx.bars[i - 1].close;

    if (ctx.position === 'flat') {
      const smaTrend = ctx.indicator('sma', { period: p.trendSma }) as number[];
      const trendNow = smaTrend[i];
      if (!Number.isFinite(trendNow) || close <= trendNow) return { action: 'hold' };

      // N consecutive lower closes ending at the current bar
      let streak = 0;
      for (let k = i; k > 0 && ctx.bars[k].close < ctx.bars[k - 1].close; k--) {
        streak += 1;
      }
      if (streak >= p.streakLen) {
        const atr    = ctx.indicator('atr', { period: p.atrPeriod }) as number[];
        const atrNow = atr[i];
        const stopPct = Number.isFinite(atrNow) && close > 0
          ? (p.atrStopMult * atrNow) / close
          : undefined;
        return {
          action:      'enter_long',
          stopPct,
          sizePct:     p.sizePct,
          maxHoldBars: p.maxHoldBars,
          reason:      `${streak} consecutive lower closes in uptrend (close > SMA${p.trendSma})`,
        };
      }
    }

    if (ctx.position === 'long' && close > prevClose) {
      return { action: 'exit', reason: 'first up-close - streak broken' };
    }

    return { action: 'hold' };
  }
}
