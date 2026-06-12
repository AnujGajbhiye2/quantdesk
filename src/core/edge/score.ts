/**
 * Edge scoring - maps backtested stats to a 0..1 score and a visual tier.
 *
 * The score drives how strongly a signal is rendered in the UI: a signal from
 * a strategy with a weak backtested edge should look visually weaker than one
 * with a strong edge.
 *
 * Scoring model:
 *   - win-rate component:      0 at 35% win rate, 1 at 60%+
 *   - profit-factor component: 0 at PF 0.8, 1 at PF 1.8+ (PF capped at 3 so
 *     the 9999 "no losses" sentinel cannot dominate a tiny sample)
 *   - confidence multiplier:   numTrades / 30, capped at 1
 *   - score = (0.5 * wr + 0.5 * pf) * confidence
 *
 * Tiers:
 *   - unknown:  no stats, or fewer than 5 trades (too few samples to claim anything)
 *   - weak:     score < 0.35, or PF < 1 (loses money regardless of win rate)
 *   - strong:   score >= 0.65
 *   - moderate: everything else
 *
 * Pure module - no I/O. Safe to import from client components.
 */

export type EdgeTier = 'strong' | 'moderate' | 'weak' | 'unknown';

export interface EdgeScoreInput {
  /** 0..1 */
  winRate:      number;
  profitFactor: number;
  numTrades:    number;
}

export interface EdgeScore {
  /** 0..1 composite edge score. */
  score: number;
  tier:  EdgeTier;
}

const MIN_TRADES_FOR_SCORE = 5;
const CONFIDENCE_TRADES    = 30;
const PF_CAP               = 3;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function edgeScore(e: EdgeScoreInput | null): EdgeScore {
  if (e === null || e.numTrades < MIN_TRADES_FOR_SCORE) {
    return { score: 0, tier: 'unknown' };
  }

  const wr = clamp01((e.winRate - 0.35) / 0.25);
  const pf = clamp01((Math.min(e.profitFactor, PF_CAP) - 0.8) / 1.0);
  const confidence = Math.min(1, e.numTrades / CONFIDENCE_TRADES);
  const score = (0.5 * wr + 0.5 * pf) * confidence;

  let tier: EdgeTier;
  if (score < 0.35 || e.profitFactor < 1) {
    tier = 'weak';
  } else if (score >= 0.65) {
    tier = 'strong';
  } else {
    tier = 'moderate';
  }

  return { score, tier };
}

/** Row opacity for a tier - visual weight proportional to backtested edge. */
export function tierOpacity(tier: EdgeTier): number {
  switch (tier) {
    case 'strong':   return 1.0;
    case 'moderate': return 0.75;
    case 'weak':     return 0.45;
    case 'unknown':  return 0.45;
  }
}
