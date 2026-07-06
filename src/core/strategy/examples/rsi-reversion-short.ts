/**
 * RSI Mean Reversion Short strategy.
 *
 * Logic: enter short when RSI rises above the overbought threshold;
 * exit when RSI drops below the exit level.
 *
 * Mirror of rsi-reversion.ts (long) - fades overbought bounces instead of
 * buying oversold dips. Same params shape, ADX ranging gate, and no-look-ahead
 * discipline.
 */

import { z } from 'zod';
import type { Strategy, StrategyContext, StrategyDecision } from '../Strategy';

const paramsSchema = z.object({
  period:     z.number().int().positive().default(14),
  overbought: z.number().positive().default(70),
  exitLevel:  z.number().positive().default(50),
  stopPct:    z.number().positive().optional(),
  targetPct:  z.number().positive().optional(),
  sizePct:    z.number().positive().max(1).default(1),
  adxPeriod:  z.number().int().positive().default(14),
  /**
   * Entry suppressed when symbol ADX >= adxMax (trending). Default 100 =
   * gate off. Mirrors the long strategy's adxMax default - see
   * rsi-reversion.ts for the walk-forward evidence against flipping it.
   */
  adxMax:     z.number().positive().default(100),
});

export class RSIReversionShortStrategy implements Strategy {
  readonly id          = 'rsi-reversion-short';
  readonly name        = 'RSI Mean Reversion Short';
  readonly description = 'Enter short when RSI rises above overbought; exit when RSI drops below exit level.';
  readonly tier        = 'baseline' as const;
  readonly params      = paramsSchema;

  /**
   * Signal strength for dynamic sizing (mirror of the long floor=15 logic).
   * Deeper RSI overbought = stronger signal = larger position.
   * RSI at overbought threshold -> 0 (min), RSI at ceiling (85) -> 1 (max).
   * Causal: reads only bars[0..i] via indicator.
   */
  signalStrength(ctx: StrategyContext, rawParams: unknown): number {
    const p      = paramsSchema.parse(rawParams);
    const rsi    = ctx.indicator('rsi', { period: p.period }) as number[];
    const rsiNow = rsi[ctx.i];
    if (!Number.isFinite(rsiNow)) return 0.5; // warm-up: neutral size
    const ceiling = 85; // RSI ceiling for 2x sizing
    // Clamp: strength = 0 when rsi=overbought, 1 when rsi>=ceiling
    const strength = Math.min(1, Math.max(0, (rsiNow - p.overbought) / (ceiling - p.overbought)));
    return strength;
  }

  onBar(ctx: StrategyContext, rawParams: unknown): StrategyDecision {
    const p = paramsSchema.parse(rawParams);
    const rsi    = ctx.indicator('rsi', { period: p.period }) as number[];
    const rsiNow = rsi[ctx.i];

    if (ctx.position === 'flat') {
      if (!Number.isFinite(rsiNow)) {
        return { action: 'hold', reason: `warming up - RSI(${p.period}) not ready` };
      }
      if (rsiNow > p.overbought) {
        // ADX ranging gate: skip entry when trending (NaN = warm-up, pass)
        const adxArr = ctx.indicator('adx', { period: p.adxPeriod }) as number[];
        const adxNow = adxArr[ctx.i];
        if (Number.isFinite(adxNow) && adxNow >= p.adxMax) {
          return { action: 'hold', reason: `ADX=${adxNow.toFixed(1)} >= ${p.adxMax} - trending, gate blocked` };
        }
        return {
          action:    'enter_short',
          stopPct:   p.stopPct,
          targetPct: p.targetPct,
          sizePct:   p.sizePct,
          reason:    `RSI(${p.period})=${rsiNow.toFixed(1)} > ${p.overbought} overbought`,
        };
      }
      return { action: 'hold', reason: `RSI(${p.period})=${rsiNow.toFixed(1)} <= ${p.overbought} - not overbought` };
    }

    if (ctx.position === 'short') {
      if (!Number.isFinite(rsiNow)) {
        return { action: 'hold', reason: `warming up - RSI(${p.period}) not ready` };
      }
      if (rsiNow < p.exitLevel) {
        return {
          action: 'exit',
          reason: `RSI(${p.period})=${rsiNow.toFixed(1)} < ${p.exitLevel} exit level`,
        };
      }
      return { action: 'hold', reason: `RSI(${p.period})=${rsiNow.toFixed(1)} >= ${p.exitLevel} - waiting for reversal` };
    }

    return { action: 'hold' };
  }
}
