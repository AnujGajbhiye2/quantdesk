/**
 * Supertrend + Pivot R1 swing strategy (from transcript strat-5, "RR super trending").
 *
 * Video rules:
 *   - Indicators: Supertrend (bullish) + standard pivot points on the daily chart.
 *   - Entry: close crosses above pivot R1 while the supertrend is green.
 *   - Target: +10%. Stop: -5% (1:2). Works best in trending markets.
 *
 * Pivots are the TradingView daily-chart default: monthly pivots from the prior
 * calendar month's high/low/close. P = (H+L+C)/3, R1 = 2P - L. Computed inline
 * from bar.time ('YYYY-MM-DD') - no indicator registry entry needed.
 */

import { z } from 'zod';
import type { Bar } from '@/core/types';
import type { Strategy, StrategyContext, StrategyDecision } from '../Strategy';

const paramsSchema = z.object({
  stPeriod:    z.number().int().positive().default(10),
  stMult:      z.number().positive().default(3),
  stopPct:     z.number().positive().default(0.05),
  targetPct:   z.number().positive().default(0.10),
  maxHoldBars: z.number().int().positive().default(40),
  sizePct:     z.number().positive().max(1).default(1),
});

/** R1 from the prior full calendar month's bars, or NaN if none exists. */
function monthlyPivotR1(bars: ReadonlyArray<Bar>, i: number): number {
  const currentMonth = bars[i].time.slice(0, 7);
  let hi = -Infinity;
  let lo = Infinity;
  let lastClose = NaN;
  let pivotMonth = '';
  // ponytail: bounded backward walk (~45 bars max) instead of calendar grouping
  for (let j = i; j >= 0 && i - j < 60; j--) {
    const m = bars[j].time.slice(0, 7);
    if (m === currentMonth) continue;
    if (!pivotMonth) pivotMonth = m;
    if (m !== pivotMonth) break;
    hi = Math.max(hi, bars[j].high);
    lo = Math.min(lo, bars[j].low);
    if (!Number.isFinite(lastClose)) lastClose = bars[j].close; // first hit = month's last bar
  }
  if (!pivotMonth || !Number.isFinite(lastClose)) return NaN;
  const p = (hi + lo + lastClose) / 3;
  return 2 * p - lo;
}

export class SupertrendPivotStrategy implements Strategy {
  readonly id          = 'supertrend-pivot';
  readonly name        = 'Supertrend + Pivot R1';
  readonly description = 'Buy when the daily close crosses above the monthly pivot R1 while the Supertrend(10,3) is bullish; fixed -5% stop, +10% target.';
  readonly tier        = 'production' as const;
  readonly params      = paramsSchema;

  onBar(ctx: StrategyContext, rawParams: unknown): StrategyDecision {
    const p = paramsSchema.parse(rawParams);
    const i = ctx.i;

    if (ctx.position !== 'flat' || i < 1) {
      // Exits handled entirely by the fixed stop/target/time knobs
      return { action: 'hold' };
    }

    const st = ctx.indicator('supertrend', { period: p.stPeriod, multiplier: p.stMult }) as Record<string, number[]>;
    if (!Number.isFinite(st.direction[i])) return { action: 'hold' };

    const r1 = monthlyPivotR1(ctx.bars, i);
    if (!Number.isFinite(r1)) return { action: 'hold' };

    const bullish = st.direction[i] === 1;
    const crossR1 = ctx.bars[i].close > r1 && ctx.bars[i - 1].close <= r1;

    if (bullish && crossR1) {
      return {
        action:      'enter_long',
        stopPct:     p.stopPct,
        targetPct:   p.targetPct,
        sizePct:     p.sizePct,
        maxHoldBars: p.maxHoldBars,
        reason:      `close crossed above monthly pivot R1 with Supertrend(${p.stPeriod},${p.stMult}) bullish`,
      };
    }

    return { action: 'hold' };
  }
}
