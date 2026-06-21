/**
 * SMA44 Support Bounce swing strategy.
 *
 * The classic "44 MA" daily setup:
 *   - Trend filter: close > SMA200 (long-only uptrend).
 *   - Setup: prior bar's low dipped to/under SMA44, current bar closes back above it
 *     (price uses the SMA44 as dynamic support and bounces off it).
 *   - Entry: signal bar close (fill at next bar's open per engine rules).
 *   - Stop: 2x ATR below entry. Target: 4x ATR above entry (2R). Time cap: 21 bars.
 *
 * Named after the observation that the SMA44 ~ one quarter of trading days and
 * tends to act as mid-term support in trending US and Indian equities.
 */

import { z } from 'zod';
import type { Strategy, StrategyContext, StrategyDecision } from '../Strategy';

const paramsSchema = z.object({
  maPeriod:      z.number().int().positive().default(44),
  trendSma:      z.number().int().positive().default(200),
  atrPeriod:     z.number().int().positive().default(14),
  atrStopMult:   z.number().positive().default(2),
  atrTargetMult: z.number().positive().default(4),
  maxHoldBars:   z.number().int().positive().default(21),
  sizePct:       z.number().positive().max(1).default(1),
});

export class Ma44SupportStrategy implements Strategy {
  readonly id          = 'ma44-support';
  readonly name        = 'SMA44 Support Bounce';
  readonly description = 'In an SMA200 uptrend, buy when price dips to touch SMA44 then closes back above it; 2x ATR stop, 4x ATR target (2R), 21-bar time stop.';
  readonly tier        = 'production' as const;
  readonly params      = paramsSchema;

  onBar(ctx: StrategyContext, rawParams: unknown): StrategyDecision {
    const p = paramsSchema.parse(rawParams);
    const i = ctx.i;

    if (ctx.position !== 'flat' || i < 1) {
      // Exits handled entirely by stop/target/time - nothing to decide here
      return { action: 'hold' };
    }

    const bar  = ctx.bars[i];
    const prev = ctx.bars[i - 1];

    const sma44  = ctx.indicator('sma', { period: p.maPeriod })  as number[];
    const sma200 = ctx.indicator('sma', { period: p.trendSma })  as number[];

    const ma44Now  = sma44[i];
    const ma44Prev = sma44[i - 1];
    const ma200Now = sma200[i];

    if (![ma44Now, ma44Prev, ma200Now].every(Number.isFinite)) {
      return { action: 'hold' };
    }

    // Trend filter: price above SMA200
    const uptrend  = bar.close > ma200Now;
    // Bounce: prior bar dipped to/under SMA44 then current bar closed back above it
    const dipped   = prev.low <= ma44Prev;
    const reclaimed = bar.close > ma44Now;

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
        reason:      `SMA${p.maPeriod} support bounce in SMA${p.trendSma} uptrend`,
      };
    }

    return { action: 'hold' };
  }
}
