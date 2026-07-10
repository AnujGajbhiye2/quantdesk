/**
 * EMA8 Momentum Breakout swing strategy (from transcript strat-1).
 *
 * Video rules:
 *   - Filter: close above the 200 SMA (long-only, no weak stocks).
 *   - Setup: breakout above a daily resistance level tested at least twice,
 *     with the stock riding the 8 EMA.
 *   - Entry: pullback as close to the 8 EMA as possible while still above it.
 *   - Exit: scale out partials into extension; stop = daily close below the 8 EMA.
 *
 * Resistance is Donchian-style: the high of an older window, touched >= minTouches
 * times within tolerance, then exceeded during the recent breakout window.
 */

import { z } from 'zod';
import type { Strategy, StrategyContext, StrategyDecision } from '../Strategy';

const paramsSchema = z.object({
  trendSma:            z.number().int().positive().default(200),
  emaPeriod:           z.number().int().positive().default(8),
  resistanceLookback:  z.number().int().positive().default(30),
  breakoutWindow:      z.number().int().positive().default(10),
  minTouches:          z.number().int().positive().default(2),
  touchTolPct:         z.number().positive().default(0.015),
  nearEmaPct:          z.number().positive().default(0.005),
  targetR:             z.number().positive().default(3),
  maxHoldBars:         z.number().int().positive().default(30),
  sizePct:             z.number().positive().max(1).default(1),
});

export class Ema8MomentumBreakoutStrategy implements Strategy {
  readonly id          = 'ema8-momentum-breakout';
  readonly name        = 'EMA8 Momentum Breakout';
  readonly description = 'Above the SMA200, after a breakout of a twice-tested resistance, buy the pullback to the 8 EMA while riding it; half off at 1.5R, 3R target, exit on a close below the 8 EMA.';
  readonly tier        = 'production' as const;
  readonly params      = paramsSchema;

  onBar(ctx: StrategyContext, rawParams: unknown): StrategyDecision {
    const p = paramsSchema.parse(rawParams);
    const i = ctx.i;
    const bars = ctx.bars;

    const ema8 = ctx.indicator('ema', { period: p.emaPeriod }) as number[];

    // The video's trail: a daily close below the 8 EMA ends the swing
    if (ctx.position === 'long') {
      if (Number.isFinite(ema8[i]) && bars[i].close < ema8[i]) {
        return { action: 'exit', reason: `closed below EMA${p.emaPeriod}` };
      }
      return { action: 'hold' };
    }
    const warmup = p.trendSma;
    if (ctx.position !== 'flat' || i < Math.max(warmup, p.resistanceLookback + p.breakoutWindow)) {
      return { action: 'hold' };
    }

    const bar    = bars[i];
    const sma200 = ctx.indicator('sma', { period: p.trendSma }) as number[];
    if (!Number.isFinite(sma200[i]) || !Number.isFinite(ema8[i])) return { action: 'hold' };
    if (bar.close <= sma200[i]) return { action: 'hold' };

    // Riding the 8 EMA: last 5 closes above it
    for (let j = i - 4; j <= i; j++) {
      if (!Number.isFinite(ema8[j]) || bars[j].close <= ema8[j]) return { action: 'hold' };
    }

    // Pullback entry: low dips to within nearEmaPct of the EMA, close holds above
    const pullback = bar.low <= ema8[i] * (1 + p.nearEmaPct) && bar.close > ema8[i];
    if (!pullback) return { action: 'hold' };

    // Resistance from the older window, tested >= minTouches, broken recently
    const resStart = i - p.resistanceLookback - p.breakoutWindow;
    const resEnd   = i - p.breakoutWindow - 1;
    let res = -Infinity;
    for (let j = resStart; j <= resEnd; j++) res = Math.max(res, bars[j].high);
    let touches = 0;
    for (let j = resStart; j <= resEnd; j++) {
      if (bars[j].high >= res * (1 - p.touchTolPct)) touches++;
    }
    let brokeOut = false;
    for (let j = i - p.breakoutWindow; j <= i; j++) {
      if (bars[j].close > res) { brokeOut = true; break; }
    }
    if (touches < p.minTouches || !brokeOut) return { action: 'hold' };

    const stopLevel = bar.low * (1 - p.nearEmaPct);
    if (!(stopLevel < bar.close)) return { action: 'hold' };
    const stopPct = (bar.close - stopLevel) / bar.close;

    return {
      action:                 'enter_long',
      stopPct,
      targetPct:              p.targetR * stopPct,
      partialExitFraction:    0.5,
      partialExitAtTargetPct: 0.5,
      sizePct:                p.sizePct,
      maxHoldBars:            p.maxHoldBars,
      reason:                 `EMA${p.emaPeriod} pullback after breakout of ${touches}x-tested resistance above SMA${p.trendSma}`,
    };
  }
}
