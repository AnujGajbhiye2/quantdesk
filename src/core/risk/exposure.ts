import 'server-only';
import { getPaperTrades } from '@/core/db/paper';
import { getBars } from '@/core/db/bars';
import { toUSD } from '@/core/format/fx';
import {
  positionRiskUSD,
  riskLimitsFromEnv,
  type OpenPositionUSD,
  type RiskLimits,
} from './checks';
import { rollingCorrelation } from './correlation';
import type { Bar } from '@/core/types';

/**
 * Current risk exposure derived from open paper trades (USD).
 * Server-side companion to the pure rules in checks.ts.
 */

export interface RiskExposure {
  limits: RiskLimits;
  openTrades: number;
  /** Sum of entry notionals (USD). */
  openCostUSD: number;
  /** Sum of stop risks; stop-less positions counted at full notional (USD). */
  openRiskUSD: number;
  /** Largest single position cost (USD) and its symbol. */
  largestPosition: { symbol: string; costUSD: number } | null;
}

/**
 * Build OpenPositionUSD[] for the current open trades.
 * When candidateBars is provided, also computes rolling-return correlation
 * between each open position and the candidate symbol (for the correlated-
 * cluster risk rule). Pass candidateBars only at trade-open time to avoid
 * the extra DB reads on every exposure poll.
 */
export function openPositionsUSD(candidateBars?: readonly Bar[]): OpenPositionUSD[] {
  return getPaperTrades({ status: 'open' }).map((t) => {
    const costUSD = toUSD(t.entryPrice * t.qty, t.currency);
    const stopRiskUSD =
      t.stopPrice != null
        ? toUSD(Math.abs(t.entryPrice - t.stopPrice) * t.qty, t.currency)
        : null;

    let corrToCandidate: number | null = null;
    if (candidateBars && candidateBars.length > 0) {
      try {
        const openBars = getBars(t.symbol, '1d');
        const corr = rollingCorrelation(candidateBars, openBars);
        corrToCandidate = Number.isFinite(corr) ? corr : null;
      } catch {
        // bars not available - skip correlation for this position
      }
    }

    return { symbol: t.symbol, costUSD, stopRiskUSD, corrToCandidate, market: t.market ?? null };
  });
}

export function currentExposure(): RiskExposure {
  const positions = openPositionsUSD();
  const largest = positions.reduce<{ symbol: string; costUSD: number } | null>(
    (acc, p) => (acc === null || p.costUSD > acc.costUSD ? { symbol: p.symbol, costUSD: p.costUSD } : acc),
    null,
  );
  return {
    limits: riskLimitsFromEnv(),
    openTrades: positions.length,
    openCostUSD: positions.reduce((s, p) => s + p.costUSD, 0),
    openRiskUSD: positions.reduce((s, p) => s + positionRiskUSD(p), 0),
    largestPosition: largest,
  };
}
