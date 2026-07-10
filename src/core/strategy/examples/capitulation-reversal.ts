/**
 * Capitulation Reversal swing strategy (from transcript strat-2, mean reversion).
 *
 * Video rules:
 *   - Setup: sharp, extended downmove whose selling exhausts itself with
 *     capitulation volume (massive spike vs recent average).
 *   - Entry: "the right side of the V" - the first bar that breaks the
 *     downtrend (close above the prior bar's high).
 *   - Initial stop: at the capitulation lows. Trail: prior daily bar lows.
 */

import { z } from 'zod';
import type { Strategy, StrategyContext, StrategyDecision } from '../Strategy';

const paramsSchema = z.object({
  dropBars:    z.number().int().positive().default(5),
  dropPct:     z.number().positive().default(0.12),
  volMult:     z.number().positive().default(2.5),
  volAvgLen:   z.number().int().positive().default(20),
  capitWindow: z.number().int().positive().default(3),
  maxHoldBars: z.number().int().positive().default(10),
  sizePct:     z.number().positive().max(1).default(1),
});

export class CapitulationReversalStrategy implements Strategy {
  readonly id          = 'capitulation-reversal';
  readonly name        = 'Capitulation Reversal';
  readonly description = 'After a sharp multi-day selloff with capitulation volume, buy the first bar closing above the prior high ("right side of the V"); stop at the lows, trail prior daily bar lows, 10-bar cap.';
  readonly tier        = 'production' as const;
  readonly params      = paramsSchema;

  onBar(ctx: StrategyContext, rawParams: unknown): StrategyDecision {
    const p = paramsSchema.parse(rawParams);
    const i = ctx.i;
    const bars = ctx.bars;

    // Trail prior daily bar lows - the video's exit for the V bounce
    if (ctx.position === 'long') {
      if (i >= 1 && bars[i].close < bars[i - 1].low) {
        return { action: 'exit', reason: 'closed below prior bar low (trail)' };
      }
      return { action: 'hold' };
    }
    if (ctx.position !== 'flat' || i < p.dropBars + p.volAvgLen + p.capitWindow) {
      return { action: 'hold' };
    }

    const bar  = bars[i];
    const prev = bars[i - 1];

    // Extended: >= dropPct decline over the prior dropBars bars
    const refClose = bars[i - 1 - p.dropBars].close;
    const extended = refClose > 0 && (prev.close - refClose) / refClose <= -p.dropPct;

    // Capitulation: max volume of the last capitWindow bars >> average before them
    let capVol = 0;
    for (let j = i - p.capitWindow + 1; j <= i; j++) capVol = Math.max(capVol, bars[j].volume);
    let volSum = 0;
    for (let j = i - p.capitWindow - p.volAvgLen + 1; j <= i - p.capitWindow; j++) volSum += bars[j].volume;
    const capitulation = capVol >= p.volMult * (volSum / p.volAvgLen);

    // Right side of the V: first bar breaking the downtrend
    const rightSideOfV = bar.close > prev.high;

    if (extended && capitulation && rightSideOfV) {
      let low = Infinity;
      for (let j = i - p.dropBars; j <= i; j++) low = Math.min(low, bars[j].low);
      if (!(low < bar.close)) return { action: 'hold' };
      return {
        action:      'enter_long',
        stopPct:     (bar.close - low) / bar.close,
        sizePct:     p.sizePct,
        maxHoldBars: p.maxHoldBars,
        reason:      `capitulation reversal: ${(p.dropPct * 100).toFixed(0)}%+ drop, volume spike, close above prior high`,
      };
    }

    return { action: 'hold' };
  }
}
