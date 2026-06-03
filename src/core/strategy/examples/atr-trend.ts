/**
 * ATR Trailing Stop Trend Strategy.
 *
 * Logic:
 *   Entry long : price closes above its EMA (uptrend confirmation).
 *   Exit long  : price closes below entry - multiplier * ATR
 *                (ATR trailing stop, recomputed each bar from the original entry price).
 *
 * The ATR-based stop gives the trade room to breathe in proportion to recent
 * volatility - wide stop in high-volatility regimes, tight in low-volatility ones.
 *
 * Conservative: all indicator values guarded with Number.isFinite().
 * No look-ahead: only reads ctx.bars[ctx.i] and earlier.
 */

import { z } from 'zod';
import type { Strategy, StrategyContext, StrategyDecision } from '../Strategy';

const paramsSchema = z.object({
  emaPeriod:   z.number().int().positive().default(20),
  atrPeriod:   z.number().int().positive().default(14),
  atrMultiple: z.number().positive().default(2.5),
  targetPct:   z.number().positive().optional(),
  sizePct:     z.number().positive().max(1).default(1),
});

export class AtrTrendStrategy implements Strategy {
  readonly id          = 'atr-trend';
  readonly name        = 'ATR Trailing Stop Trend';
  readonly description = 'Enter long when price is above EMA; stop loss is set at 2.5x ATR below entry, giving volatility-adjusted room.';
  readonly params      = paramsSchema;

  onBar(ctx: StrategyContext, rawParams: unknown): StrategyDecision {
    const p   = paramsSchema.parse(rawParams);
    const ema = ctx.indicator('ema', { period: p.emaPeriod }) as number[];
    const atr = ctx.indicator('atr', { period: p.atrPeriod }) as number[];

    const emaNow = ema[ctx.i];
    const atrNow = atr[ctx.i];
    const close  = ctx.bars[ctx.i].close;

    if (!Number.isFinite(emaNow) || !Number.isFinite(atrNow)) return { action: 'hold' };

    if (ctx.position === 'flat') {
      if (close > emaNow) {
        // Express stop as pct of entry for broker compatibility
        const stopPct = (p.atrMultiple * atrNow) / close;
        return {
          action:    'enter_long',
          stopPct,
          targetPct: p.targetPct,
          sizePct:   p.sizePct,
          reason:    `price ${close.toFixed(2)} > EMA(${p.emaPeriod})=${emaNow.toFixed(2)}; ATR stop=${(p.atrMultiple * atrNow).toFixed(2)}`,
        };
      }
    }

    if (ctx.position === 'long') {
      // Recalculate stop based on current ATR for a dynamic trailing stop
      const trailingStop = close - p.atrMultiple * atrNow;
      // Use prevClose to check if stop was hit
      const prevClose = ctx.i > 0 ? ctx.bars[ctx.i - 1].close : close;
      const stopLevel = prevClose - p.atrMultiple * (Number.isFinite(atr[ctx.i - 1]) ? atr[ctx.i - 1] : atrNow);
      if (close < stopLevel || close < trailingStop) {
        return {
          action: 'exit',
          reason: `ATR trailing stop at ${trailingStop.toFixed(2)} hit`,
        };
      }
    }

    return { action: 'hold' };
  }
}
