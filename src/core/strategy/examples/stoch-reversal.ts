/**
 * Stochastic Oversold Reversal Strategy.
 *
 * Logic:
 *   Entry long : Stochastic %K crosses above %D while both are in the oversold zone (<= oversoldLevel).
 *                This signals a short-term reversal from oversold conditions.
 *   Exit long  : Stochastic %K reaches overbought territory (>= overboughtLevel).
 *
 * Swing-trade oriented; best on daily timeframe where stochastic oscillations
 * represent multi-day exhaustion and recovery cycles.
 *
 * Conservative: all indicator values guarded with Number.isFinite().
 * No look-ahead: only reads ctx.bars[ctx.i] and ctx.bars[ctx.i-1].
 */

import { z } from 'zod';
import type { Strategy, StrategyContext, StrategyDecision } from '../Strategy';

const paramsSchema = z.object({
  kperiod:       z.number().int().positive().default(14),
  kslow:         z.number().int().positive().default(3),
  dperiod:       z.number().int().positive().default(3),
  oversoldLevel: z.number().positive().default(20),
  overboughtLevel: z.number().positive().default(80),
  stopPct:       z.number().positive().optional(),
  targetPct:     z.number().positive().optional(),
  sizePct:       z.number().positive().max(1).default(1),
  adxPeriod:     z.number().int().positive().default(14),
  /** Entry suppressed when symbol ADX >= adxMax (trending). Default 100 = gate off. */
  adxMax:        z.number().positive().default(100),
});

export class StochReversalStrategy implements Strategy {
  readonly id          = 'stoch-reversal';
  readonly name        = 'Stochastic Oversold Reversal';
  readonly description = 'Enter long when Stochastic %K crosses above %D from the oversold zone; exit in overbought territory.';
  readonly tier        = 'baseline' as const;
  readonly params      = paramsSchema;

  /**
   * Imp 3: signal strength for dynamic sizing.
   * Lower stochastic K in oversold zone = stronger signal.
   * strength = (oversoldLevel - K) / oversoldLevel, clamped 0..1.
   * K at oversoldLevel -> 0, K at 0 -> 1.
   * Causal: reads only bars[0..i].
   */
  signalStrength(ctx: StrategyContext, rawParams: unknown): number {
    const p     = paramsSchema.parse(rawParams);
    const stoch = ctx.indicator('stoch', {
      kperiod: p.kperiod,
      kslow:   p.kslow,
      dperiod: p.dperiod,
    }) as { k: number[]; d: number[] };
    const kNow = stoch.k[ctx.i];
    if (!Number.isFinite(kNow)) return 0.5;
    const strength = Math.min(1, Math.max(0, (p.oversoldLevel - kNow) / p.oversoldLevel));
    return strength;
  }

  onBar(ctx: StrategyContext, rawParams: unknown): StrategyDecision {
    const p     = paramsSchema.parse(rawParams);
    const stoch = ctx.indicator('stoch', {
      kperiod: p.kperiod,
      kslow:   p.kslow,
      dperiod: p.dperiod,
    }) as { k: number[]; d: number[] };

    if (ctx.i < 1) return { action: 'hold', reason: 'need at least 2 bars' };

    const kNow  = stoch.k[ctx.i];
    const dNow  = stoch.d[ctx.i];
    const kPrev = stoch.k[ctx.i - 1];
    const dPrev = stoch.d[ctx.i - 1];

    if (
      !Number.isFinite(kNow) ||
      !Number.isFinite(dNow) ||
      !Number.isFinite(kPrev) ||
      !Number.isFinite(dPrev)
    ) {
      return { action: 'hold', reason: `warming up - Stoch(${p.kperiod},${p.kslow},${p.dperiod}) not ready` };
    }

    // Bullish cross: K crosses above D while in oversold zone
    const crossedUp = kPrev <= dPrev && kNow > dNow;
    const oversold  = kNow <= p.oversoldLevel && dNow <= p.oversoldLevel;

    if (ctx.position === 'flat') {
      if (crossedUp && oversold) {
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
          reason:    `Stoch K=${kNow.toFixed(1)} crossed above D=${dNow.toFixed(1)} in oversold zone`,
        };
      }
      if (!oversold) {
        return { action: 'hold', reason: `Stoch K=${kNow.toFixed(1)}, D=${dNow.toFixed(1)} - not in oversold zone (<=${p.oversoldLevel})` };
      }
      return { action: 'hold', reason: `Stoch K=${kNow.toFixed(1)}, D=${dNow.toFixed(1)} - no bullish cross (K must cross above D)` };
    }

    if (ctx.position === 'long') {
      if (kNow >= p.overboughtLevel) {
        return {
          action: 'exit',
          reason: `Stoch K=${kNow.toFixed(1)} reached overbought ${p.overboughtLevel}`,
        };
      }
      return { action: 'hold', reason: `Stoch K=${kNow.toFixed(1)} < ${p.overboughtLevel} overbought - waiting` };
    }

    return { action: 'hold' };
  }
}
