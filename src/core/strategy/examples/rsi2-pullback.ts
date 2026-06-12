/**
 * RSI-2 Pullback (Connors-style) swing strategy.
 *
 * Logic: in a long-term uptrend (close > SMA200), a deeply oversold short-period
 * RSI marks a sharp pullback that statistically snaps back within days.
 * Enter long; exit on the snap-back (RSI(2) > exit level or close > SMA5),
 * a 2x ATR stop, or the time stop.
 *
 * Hold profile: typically 2-7 bars; hard cap via maxHoldBars (default 10).
 */

import { z } from 'zod';
import type { Strategy, StrategyContext, StrategyDecision } from '../Strategy';

const paramsSchema = z.object({
  rsiPeriod:    z.number().int().positive().default(2),
  entryLevel:   z.number().positive().default(10),
  exitLevel:    z.number().positive().default(70),
  trendSma:     z.number().int().positive().default(200),
  exitSma:      z.number().int().positive().default(5),
  atrPeriod:    z.number().int().positive().default(14),
  atrStopMult:  z.number().positive().default(2),
  maxHoldBars:  z.number().int().positive().default(10),
  sizePct:      z.number().positive().max(1).default(1),
});

export class Rsi2PullbackStrategy implements Strategy {
  readonly id          = 'rsi2-pullback';
  readonly name        = 'RSI-2 Pullback';
  readonly description = 'Buy deep RSI(2) oversold dips in a long-term uptrend (close > SMA200); exit on snap-back, 2x ATR stop, or 10-bar time stop.';
  readonly params      = paramsSchema;

  onBar(ctx: StrategyContext, rawParams: unknown): StrategyDecision {
    const p = paramsSchema.parse(rawParams);
    const close = ctx.bars[ctx.i].close;

    const rsi      = ctx.indicator('rsi', { period: p.rsiPeriod }) as number[];
    const smaTrend = ctx.indicator('sma', { period: p.trendSma }) as number[];
    const rsiNow   = rsi[ctx.i];
    const trendNow = smaTrend[ctx.i];

    if (ctx.position === 'flat') {
      if (!Number.isFinite(rsiNow) || !Number.isFinite(trendNow)) return { action: 'hold' };
      if (close > trendNow && rsiNow < p.entryLevel) {
        const atr    = ctx.indicator('atr', { period: p.atrPeriod }) as number[];
        const atrNow = atr[ctx.i];
        const stopPct = Number.isFinite(atrNow) && close > 0
          ? (p.atrStopMult * atrNow) / close
          : undefined;
        return {
          action:      'enter_long',
          stopPct,
          sizePct:     p.sizePct,
          maxHoldBars: p.maxHoldBars,
          reason:      `RSI(${p.rsiPeriod})=${rsiNow.toFixed(1)} < ${p.entryLevel} in uptrend (close > SMA${p.trendSma})`,
        };
      }
    }

    if (ctx.position === 'long') {
      const smaExit = ctx.indicator('sma', { period: p.exitSma }) as number[];
      const exitNow = smaExit[ctx.i];
      if (Number.isFinite(rsiNow) && rsiNow > p.exitLevel) {
        return { action: 'exit', reason: `RSI(${p.rsiPeriod})=${rsiNow.toFixed(1)} > ${p.exitLevel} snap-back` };
      }
      if (Number.isFinite(exitNow) && close > exitNow) {
        return { action: 'exit', reason: `close back above SMA${p.exitSma}` };
      }
    }

    return { action: 'hold' };
  }
}
