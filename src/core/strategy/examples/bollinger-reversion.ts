/**
 * Bollinger Band Mean Reversion Strategy.
 *
 * Logic:
 *   Entry long : close crosses below the lower Bollinger Band (price too cheap vs volatility).
 *   Exit long  : close recovers to or above the middle band (SMA).
 *
 * Swing-trade style: holds for a few bars on average; best on daily timeframe.
 *
 * Conservative: all indicator values guarded with Number.isFinite().
 * No look-ahead: only reads ctx.bars[ctx.i] and earlier.
 */

import { z } from 'zod';
import type { Strategy, StrategyContext, StrategyDecision } from '../Strategy';

const paramsSchema = z.object({
  period:    z.number().int().positive().default(20),
  stddev:    z.number().positive().default(2),
  stopPct:   z.number().positive().optional(),
  sizePct:   z.number().positive().max(1).default(1),
  adxPeriod: z.number().int().positive().default(14),
  /**
   * Entry suppressed when symbol ADX >= adxMax (trending). Default 100 =
   * gate off. Evaluated at adxMax=25 via scripts/eval-adx-gate.ts on SP500 +
   * Nifty200 walk-forward: REJECTED for all 3 live MR strategies - OOS
   * Sharpe and win rate both fell (drawdown improved, but not enough to
   * offset it). Don't flip this default without re-running that harness.
   */
  adxMax:    z.number().positive().default(100),
});

export class BollingerReversionStrategy implements Strategy {
  readonly id          = 'bollinger-reversion';
  readonly name        = 'Bollinger Band Mean Reversion';
  readonly description = 'Enter long when price drops below lower BB; exit when price recovers to the middle band (SMA).';
  readonly tier        = 'baseline' as const;
  readonly params      = paramsSchema;

  /**
   * Imp 3: signal strength for dynamic sizing.
   * Deeper below lower band = stronger signal.
   * strength = (lower - close) / (upper - lower), clamped 0..1.
   * At lower band -> 0, one full band-width below -> 1.
   * Causal: reads only bars[0..i].
   */
  signalStrength(ctx: StrategyContext, rawParams: unknown): number {
    const p  = paramsSchema.parse(rawParams);
    const bb = ctx.indicator('bbands', { period: p.period, stddev: p.stddev }) as {
      lower: number[]; middle: number[]; upper: number[];
    };
    const close  = ctx.bars[ctx.i].close;
    const lower  = bb.lower[ctx.i];
    const upper  = bb.upper[ctx.i];
    if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper <= lower) return 0.5;
    const bandWidth = upper - lower;
    const dist      = lower - close; // positive when below lower band
    return Math.min(1, Math.max(0, dist / bandWidth));
  }

  onBar(ctx: StrategyContext, rawParams: unknown): StrategyDecision {
    const p  = paramsSchema.parse(rawParams);
    const bb = ctx.indicator('bbands', { period: p.period, stddev: p.stddev }) as {
      lower:  number[];
      middle: number[];
      upper:  number[];
    };

    const close  = ctx.bars[ctx.i].close;
    const lower  = bb.lower[ctx.i];
    const middle = bb.middle[ctx.i];

    if (!Number.isFinite(lower) || !Number.isFinite(middle)) {
      return { action: 'hold', reason: `warming up - BB(${p.period}) not ready` };
    }

    if (ctx.position === 'flat') {
      if (close < lower) {
        // ADX ranging gate: skip entry when trending (NaN = warm-up, pass)
        const adxArr = ctx.indicator('adx', { period: p.adxPeriod }) as number[];
        const adxNow = adxArr[ctx.i];
        if (Number.isFinite(adxNow) && adxNow >= p.adxMax) {
          return { action: 'hold', reason: `ADX=${adxNow.toFixed(1)} >= ${p.adxMax} - trending, gate blocked` };
        }
        return {
          action:  'enter_long',
          stopPct: p.stopPct,
          sizePct: p.sizePct,
          reason:  `close ${close.toFixed(2)} < lower BB ${lower.toFixed(2)}`,
        };
      }
      return { action: 'hold', reason: `close ${close.toFixed(2)} >= lower BB ${lower.toFixed(2)} - not oversold` };
    }

    if (ctx.position === 'long') {
      if (close >= middle) {
        return {
          action: 'exit',
          reason: `close ${close.toFixed(2)} recovered to mid BB ${middle.toFixed(2)}`,
        };
      }
      return { action: 'hold', reason: `close ${close.toFixed(2)} < mid BB ${middle.toFixed(2)} - still below target` };
    }

    return { action: 'hold' };
  }
}
