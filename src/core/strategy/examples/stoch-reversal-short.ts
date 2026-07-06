/**
 * Stochastic Overbought Reversal Short strategy.
 *
 * Logic:
 *   Entry short : Stochastic %K crosses below %D while both are in the overbought zone (>= overboughtLevel).
 *                 This signals a short-term reversal from overbought conditions.
 *   Exit short  : Stochastic %K drops into oversold territory (<= oversoldLevel).
 *
 * Mirror of stoch-reversal.ts (long) - fades overbought bounces instead of
 * buying oversold dips. Swing-trade oriented; best on daily timeframe.
 *
 * Conservative: all indicator values guarded with Number.isFinite().
 * No look-ahead: only reads ctx.bars[ctx.i] and ctx.bars[ctx.i-1].
 */

import { z } from 'zod';
import type { Strategy, StrategyContext, StrategyDecision } from '../Strategy';

const paramsSchema = z.object({
  kperiod:         z.number().int().positive().default(14),
  kslow:           z.number().int().positive().default(3),
  dperiod:         z.number().int().positive().default(3),
  oversoldLevel:   z.number().positive().default(20),
  overboughtLevel: z.number().positive().default(80),
  stopPct:         z.number().positive().optional(),
  targetPct:       z.number().positive().optional(),
  sizePct:         z.number().positive().max(1).default(1),
  adxPeriod:       z.number().int().positive().default(14),
  /**
   * Entry suppressed when symbol ADX >= adxMax (trending). Default 100 =
   * gate off. Mirrors the long strategy's adxMax default - see
   * stoch-reversal.ts for the walk-forward evidence against flipping it.
   */
  adxMax:          z.number().positive().default(100),
});

export class StochReversalShortStrategy implements Strategy {
  readonly id          = 'stoch-reversal-short';
  readonly name        = 'Stochastic Overbought Reversal Short';
  readonly description = 'Enter short when Stochastic %K crosses below %D from the overbought zone; exit in oversold territory.';
  readonly tier        = 'baseline' as const;
  readonly params      = paramsSchema;

  /**
   * Signal strength for dynamic sizing (mirror of the long strategy's logic).
   * Higher stochastic K in overbought zone = stronger signal.
   * strength = (K - overboughtLevel) / (100 - overboughtLevel), clamped 0..1.
   * K at overboughtLevel -> 0, K at 100 -> 1.
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
    const strength = Math.min(1, Math.max(0, (kNow - p.overboughtLevel) / (100 - p.overboughtLevel)));
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

    // Bearish cross: K crosses below D while in overbought zone
    const crossedDown = kPrev >= dPrev && kNow < dNow;
    const overbought  = kNow >= p.overboughtLevel && dNow >= p.overboughtLevel;

    if (ctx.position === 'flat') {
      if (crossedDown && overbought) {
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
          reason:    `Stoch K=${kNow.toFixed(1)} crossed below D=${dNow.toFixed(1)} in overbought zone`,
        };
      }
      if (!overbought) {
        return { action: 'hold', reason: `Stoch K=${kNow.toFixed(1)}, D=${dNow.toFixed(1)} - not in overbought zone (>=${p.overboughtLevel})` };
      }
      return { action: 'hold', reason: `Stoch K=${kNow.toFixed(1)}, D=${dNow.toFixed(1)} - no bearish cross (K must cross below D)` };
    }

    if (ctx.position === 'short') {
      if (kNow <= p.oversoldLevel) {
        return {
          action: 'exit',
          reason: `Stoch K=${kNow.toFixed(1)} reached oversold ${p.oversoldLevel}`,
        };
      }
      return { action: 'hold', reason: `Stoch K=${kNow.toFixed(1)} > ${p.oversoldLevel} oversold - waiting` };
    }

    return { action: 'hold' };
  }
}
