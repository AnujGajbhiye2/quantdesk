/**
 * RSI Mean Reversion strategy.
 *
 * Logic: enter long when RSI drops below the oversold threshold;
 * exit when RSI recovers above the exit level.
 *
 * Clone this file to author a new strategy:
 * 1. Rename the class and update id/name/description.
 * 2. Edit the paramsSchema and onBar logic.
 * 3. Register in strategy/registry.ts (one line).
 */

import { z } from 'zod';
import type { Strategy, StrategyContext, StrategyDecision } from '../Strategy';

const paramsSchema = z.object({
  period:     z.number().int().positive().default(14),
  oversold:   z.number().positive().default(30),
  exitLevel:  z.number().positive().default(50),
  stopPct:    z.number().positive().optional(),
  targetPct:  z.number().positive().optional(),
  sizePct:    z.number().positive().max(1).default(1),
  adxPeriod:  z.number().int().positive().default(14),
  /**
   * Entry suppressed when symbol ADX >= adxMax (trending). Default 100 =
   * gate off. Evaluated at adxMax=25 via scripts/eval-adx-gate.ts on SP500 +
   * Nifty200 walk-forward: REJECTED for all 3 live MR strategies - OOS
   * Sharpe and win rate both fell (drawdown improved, but not enough to
   * offset it). Don't flip this default without re-running that harness.
   */
  adxMax:     z.number().positive().default(100),
});

export class RSIReversionStrategy implements Strategy {
  readonly id          = 'rsi-reversion';
  readonly name        = 'RSI Mean Reversion';
  readonly description = 'Enter long when RSI drops below oversold; exit when RSI recovers above exit level.';
  readonly tier        = 'baseline' as const;
  readonly params      = paramsSchema;

  /**
   * Imp 3: signal strength for dynamic sizing.
   * Deeper RSI oversold = stronger signal = larger position.
   * RSI at oversold threshold -> 0 (min), RSI at floor (15) -> 1 (max).
   * Causal: reads only bars[0..i] via indicator.
   */
  signalStrength(ctx: StrategyContext, rawParams: unknown): number {
    const p      = paramsSchema.parse(rawParams);
    const rsi    = ctx.indicator('rsi', { period: p.period }) as number[];
    const rsiNow = rsi[ctx.i];
    if (!Number.isFinite(rsiNow)) return 0.5; // warm-up: neutral size
    const floor = 15; // RSI floor for 2x sizing
    // Clamp: strength = 0 when rsi=oversold, 1 when rsi<=floor
    const strength = Math.min(1, Math.max(0, (p.oversold - rsiNow) / (p.oversold - floor)));
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
      if (rsiNow < p.oversold) {
        // ADX ranging gate: skip entry when trending (NaN = warm-up, pass)
        const adxArr = ctx.indicator('adx', { period: p.adxPeriod }) as number[];
        const adxNow = adxArr[ctx.i];
        if (Number.isFinite(adxNow) && adxNow >= p.adxMax) {
          return { action: 'hold', reason: `ADX=${adxNow.toFixed(1)} >= ${p.adxMax} - trending, gate blocked` };
        }
        return {
          action:    'enter_long',
          stopPct:   p.stopPct,
          targetPct: p.targetPct,
          sizePct:   p.sizePct,
          reason:    `RSI(${p.period})=${rsiNow.toFixed(1)} < ${p.oversold} oversold`,
        };
      }
      return { action: 'hold', reason: `RSI(${p.period})=${rsiNow.toFixed(1)} >= ${p.oversold} - not oversold` };
    }

    if (ctx.position === 'long') {
      if (!Number.isFinite(rsiNow)) {
        return { action: 'hold', reason: `warming up - RSI(${p.period}) not ready` };
      }
      if (rsiNow > p.exitLevel) {
        return {
          action: 'exit',
          reason: `RSI(${p.period})=${rsiNow.toFixed(1)} > ${p.exitLevel} exit level`,
        };
      }
      return { action: 'hold', reason: `RSI(${p.period})=${rsiNow.toFixed(1)} <= ${p.exitLevel} - waiting for recovery` };
    }

    return { action: 'hold' };
  }
}
