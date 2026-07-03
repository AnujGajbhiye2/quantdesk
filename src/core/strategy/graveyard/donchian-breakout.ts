/**
 * Donchian Channel Breakout Strategy.
 *
 * Logic:
 *   Entry long : close breaks above the N-bar high (Donchian upper channel).
 *                This signals momentum / trend initiation.
 *   Exit long  : close drops below the N-bar low (Donchian lower channel)
 *                OR an ATR-based trailing stop is hit.
 *
 * Donchian channels are not in the indicator registry, so we compute them
 * inline from the bars slice (pure; no registry bypass needed).
 *
 * Conservative: no look-ahead; all values guarded with Number.isFinite().
 */

import { z } from 'zod';
import type { Strategy, StrategyContext, StrategyDecision } from '../Strategy';

const paramsSchema = z.object({
  /** Lookback for the breakout channel (bars). */
  period:     z.number().int().positive().default(20),
  /** ATR stop multiplier - stop is placed this many ATRs below entry. */
  atrStop:    z.number().positive().default(2),
  /** ATR period for stop calculation. */
  atrPeriod:  z.number().int().positive().default(14),
  sizePct:    z.number().positive().max(1).default(1),
});

export class DonchianBreakoutStrategy implements Strategy {
  readonly id          = 'donchian-breakout';
  readonly name        = 'Donchian Channel Breakout';
  readonly description = 'Enter long on close above N-bar high; exit on close below N-bar low or ATR trailing stop.';
  readonly tier        = 'baseline' as const;
  readonly params      = paramsSchema;

  onBar(ctx: StrategyContext, rawParams: unknown): StrategyDecision {
    const p = paramsSchema.parse(rawParams);
    if (ctx.i < p.period) return { action: 'hold' };

    // Donchian channel: high/low of bars[i-period .. i-1] (exclude current bar - no look-ahead)
    const lookback = ctx.bars.slice(Math.max(0, ctx.i - p.period), ctx.i);
    const chanHigh = Math.max(...lookback.map((b) => b.high));
    const chanLow  = Math.min(...lookback.map((b) => b.low));

    const close = ctx.bars[ctx.i].close;

    // ATR for stop sizing
    const atr = ctx.indicator('atr', { period: p.atrPeriod }) as number[];
    const atrNow = atr[ctx.i];

    if (ctx.position === 'flat') {
      if (close > chanHigh) {
        // Stop: entry - 2*ATR (expressed as pct for broker.ts compatibility)
        const stopPct = Number.isFinite(atrNow) ? (p.atrStop * atrNow) / close : undefined;
        return {
          action:  'enter_long',
          stopPct,
          sizePct: p.sizePct,
          reason:  `breakout above ${chanHigh.toFixed(2)} (${p.period}-bar high)`,
        };
      }
    }

    if (ctx.position === 'long') {
      if (close < chanLow) {
        return {
          action: 'exit',
          reason: `close ${close.toFixed(2)} below ${p.period}-bar low ${chanLow.toFixed(2)}`,
        };
      }
    }

    return { action: 'hold' };
  }
}
