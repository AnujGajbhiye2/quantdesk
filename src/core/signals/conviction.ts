/**
 * Conviction score - the deterministic "trader agent".
 *
 * Folds everything known about a trade idea into one 0-100 number with named,
 * inspectable components. Pure function: same inputs, same score, and the
 * components are returned so the UI can show WHY, never just a number.
 *
 * Weights (sum 100):
 *   edge       40 - backtested edge of this strategy on this symbol/class
 *   consensus  20 - how many independent strategies agree right now
 *   rr         15 - reward-to-risk of the concrete idea
 *   hitRate    15 - realized +5-bar hit rate of this symbol's past long/short signals
 *   regime     10 - is the medium-term trend aligned with the trade direction
 *
 * Unknown inputs score neutral (0.5 of their weight), never zero - missing
 * data is uncertainty, not evidence against.
 */

export interface ConvictionInputs {
  /** Edge score 0..1 from edge/score.ts (EdgeSummary.score); null = no edge data. */
  edgeScore: number | null;
  /** Backtested sample size behind the edge; small samples get discounted. */
  edgeTrades: number | null;
  /** Share of strategies agreeing with this direction, 0..1; null = unknown. */
  consensusStrength: number | null;
  /** Reward-to-risk of the idea. */
  rr: number | null;
  /** Realized hit rate of past same-direction signals on this symbol, 0..1; null = thin history. */
  hitRate: number | null;
  /** Trend alignment: true = with the trade, false = against, null = unknown. */
  regimeAligned: boolean | null;
}

export type ConvictionBand = 'STRONG' | 'MODERATE' | 'WEAK';

export interface ConvictionComponent {
  key: 'edge' | 'consensus' | 'rr' | 'hitRate' | 'regime';
  label: string;
  weight: number;
  /** 0..1 contribution before weighting. */
  value: number;
  detail: string;
}

export interface Conviction {
  score: number; // 0..100
  band: ConvictionBand;
  components: ConvictionComponent[];
}

const WEIGHTS = { edge: 40, consensus: 20, rr: 15, hitRate: 15, regime: 10 } as const;
const NEUTRAL = 0.5;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function computeConviction(input: ConvictionInputs): Conviction {
  const components: ConvictionComponent[] = [];

  // Edge: score is already 0..1; thin samples pulled toward neutral
  let edgeValue = NEUTRAL;
  let edgeDetail = 'no backtested edge data - neutral';
  if (input.edgeScore != null) {
    edgeValue = clamp01(input.edgeScore);
    edgeDetail = `backtested edge score ${(edgeValue * 100).toFixed(0)}/100`;
    if (input.edgeTrades != null && input.edgeTrades < 15) {
      edgeValue = edgeValue * 0.5 + NEUTRAL * 0.5;
      edgeDetail += ` (only ${input.edgeTrades} trades - discounted toward neutral)`;
    }
  }
  components.push({ key: 'edge', label: 'Backtested edge', weight: WEIGHTS.edge, value: edgeValue, detail: edgeDetail });

  // Consensus
  const consensusValue = input.consensusStrength != null ? clamp01(input.consensusStrength) : NEUTRAL;
  components.push({
    key: 'consensus',
    label: 'Strategy agreement',
    weight: WEIGHTS.consensus,
    value: consensusValue,
    detail:
      input.consensusStrength != null
        ? `${(input.consensusStrength * 100).toFixed(0)}% of strategies agree on this direction`
        : 'consensus unknown - neutral',
  });

  // R:R - 1.0 maps to 0, 3.0+ maps to 1
  const rrValue = input.rr != null && isFinite(input.rr) ? clamp01((input.rr - 1) / 2) : NEUTRAL;
  components.push({
    key: 'rr',
    label: 'Reward-to-risk',
    weight: WEIGHTS.rr,
    value: rrValue,
    detail: input.rr != null && isFinite(input.rr) ? `${input.rr.toFixed(1)}x reward vs risk` : 'no R:R - neutral',
  });

  // Realized hit rate
  const hitValue = input.hitRate != null ? clamp01(input.hitRate) : NEUTRAL;
  components.push({
    key: 'hitRate',
    label: 'Past signals worked',
    weight: WEIGHTS.hitRate,
    value: hitValue,
    detail:
      input.hitRate != null
        ? `${(input.hitRate * 100).toFixed(0)}% of past same-direction signals here moved the right way within 5 bars`
        : 'too few stored signals on this symbol - neutral',
  });

  // Regime
  const regimeValue = input.regimeAligned == null ? NEUTRAL : input.regimeAligned ? 1 : 0;
  components.push({
    key: 'regime',
    label: 'Trend alignment',
    weight: WEIGHTS.regime,
    value: regimeValue,
    detail:
      input.regimeAligned == null
        ? 'trend regime unknown - neutral'
        : input.regimeAligned
          ? 'medium-term trend supports this direction'
          : 'trading AGAINST the medium-term trend',
  });

  const score = Math.round(components.reduce((sum, c) => sum + c.value * c.weight, 0));
  const band: ConvictionBand = score >= 70 ? 'STRONG' : score >= 45 ? 'MODERATE' : 'WEAK';

  return { score, band, components };
}
