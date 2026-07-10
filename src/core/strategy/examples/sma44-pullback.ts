/**
 * SMA44 Pullback swing strategy (from transcript strat-3, "44 moving average").
 *
 * Video rules:
 *   - Filter: 44-day SMA rising (slope up over a short lookback).
 *   - Setup: price pulls back to the SMA44 and prints a green candle at/near it.
 *   - Entry: break of the green candle's high. Stop: below the green candle's low.
 *   - Targets: 2R (book half) and 3R (runner). Hold roughly 3-10 days.
 *
 * Causal mapping: setup bar = i-1 (the green candle), trigger bar = i breaking
 * its high; the engine fills at bar i+1's open - one bar of lag vs a real
 * buy-stop order at the candle high.
 */

import { z } from 'zod';
import type { Strategy, StrategyContext, StrategyDecision } from '../Strategy';

const paramsSchema = z.object({
  maPeriod:            z.number().int().positive().default(44),
  slopeLookback:       z.number().int().positive().default(5),
  nearPct:             z.number().positive().default(0.01),
  targetR:             z.number().positive().default(3),
  partialAtR:          z.number().positive().default(2),
  partialExitFraction: z.number().positive().max(1).default(0.5),
  maxHoldBars:         z.number().int().positive().default(10),
  sizePct:             z.number().positive().max(1).default(1),
});

export class Sma44PullbackStrategy implements Strategy {
  readonly id          = 'sma44-pullback';
  readonly name        = 'SMA44 Pullback (green candle)';
  readonly description = 'Rising SMA44, pullback prints a green candle at the SMA, buy the break of its high; stop below its low, half off at 2R, runner to 3R, 10-bar time stop.';
  readonly tier        = 'production' as const;
  readonly params      = paramsSchema;

  onBar(ctx: StrategyContext, rawParams: unknown): StrategyDecision {
    const p = paramsSchema.parse(rawParams);
    const i = ctx.i;

    if (ctx.position !== 'flat' || i < p.maPeriod + p.slopeLookback) {
      // Exits handled entirely by stop/target/partial/time knobs
      return { action: 'hold' };
    }

    const bar   = ctx.bars[i];
    const setup = ctx.bars[i - 1];
    const sma44 = ctx.indicator('sma', { period: p.maPeriod }) as number[];

    const maNow   = sma44[i];
    const maSetup = sma44[i - 1];
    const maPast  = sma44[i - p.slopeLookback];
    if (![maNow, maSetup, maPast].every(Number.isFinite)) return { action: 'hold' };

    const rising    = maNow > maPast;
    const greenAtMa = setup.close > setup.open
      && setup.low <= maSetup * (1 + p.nearPct)
      && setup.close >= maSetup;
    const triggered = bar.high > setup.high && bar.close > maNow;

    if (rising && greenAtMa && triggered && setup.low < bar.close) {
      const stopPct = (bar.close - setup.low) / bar.close;
      return {
        action:                 'enter_long',
        stopPct,
        targetPct:              p.targetR * stopPct,
        partialExitFraction:    p.partialExitFraction,
        partialExitAtTargetPct: p.partialAtR / p.targetR,
        sizePct:                p.sizePct,
        maxHoldBars:            p.maxHoldBars,
        reason:                 `green candle at rising SMA${p.maPeriod}, break of its high`,
      };
    }

    return { action: 'hold' };
  }
}
