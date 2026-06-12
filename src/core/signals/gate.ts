/**
 * Trade idea quality gate.
 *
 * An idea is suppressed (rendered as a muted "insufficient edge" row, never
 * silently dropped) when any of these fail, checked in order - first failure
 * wins so the user sees the most fundamental problem:
 *   1. R:R ratio below 1.5 - not worth taking.
 *   2. Fewer than 15 closed trades on the strategy's asset-class record -
 *      not enough data to trust the win-rate estimate.
 *   3. Asset-class win rate below 40%.
 *
 * Scope note: both the trade-count and win-rate rules read the CLASS scope
 * ('class:<assetClass>'), not the per-symbol scope. The count rule exists to
 * protect the win-rate estimate in rule 3, and that estimate is class-pooled,
 * so the sample size must measure the same pool. Per-symbol thinness stays
 * visible to the user through the inline edge badge.
 *
 * Pure module - no I/O.
 */

import type { AssetClass, TradeIdea } from '@/core/types';
import type { EdgeStats } from '@/core/edge/types';
import type { EdgeSummary } from '@/core/edge/context';
import type { Conviction } from './conviction';

export const GATE_MIN_RR              = 1.5;
export const GATE_MIN_CLASS_WIN_RATE  = 0.40;
export const GATE_MIN_TRADES          = 15;

export interface GateContext {
  rr:         number;
  /** Edge stats at scope 'class:<assetClass>' for the idea's strategy. */
  classEdge:  Pick<EdgeStats, 'winRate' | 'numTrades'> | null;
  /** For human-readable reasons; null when symbol meta is missing. */
  assetClass: AssetClass | null;
}

export interface IdeaGate {
  passed: boolean;
  /** Human-readable failing reason; null when passed. */
  reason: string | null;
}

/** TradeIdea + edge context + gate verdict, as returned by the scan APIs. */
export interface EnrichedTradeIdea extends TradeIdea {
  edge: EdgeSummary | null;
  gate: IdeaGate;
  /** Composite 0-100 score with named components; filled by the scan routes. */
  conviction?: Conviction;
}

export function gateIdea(ctx: GateContext): IdeaGate {
  const cls = ctx.assetClass ?? 'asset class';

  if (ctx.rr < GATE_MIN_RR) {
    return { passed: false, reason: `R:R ${ctx.rr.toFixed(2)} < ${GATE_MIN_RR}` };
  }

  if (ctx.classEdge === null || ctx.classEdge.numTrades < GATE_MIN_TRADES) {
    const n = ctx.classEdge?.numTrades ?? 0;
    return {
      passed: false,
      reason: `only ${n} closed trades on ${cls} record (< ${GATE_MIN_TRADES})`,
    };
  }

  if (ctx.classEdge.winRate < GATE_MIN_CLASS_WIN_RATE) {
    const pct = (ctx.classEdge.winRate * 100).toFixed(0);
    return { passed: false, reason: `win rate ${pct}% on ${cls} < 40%` };
  }

  return { passed: true, reason: null };
}
