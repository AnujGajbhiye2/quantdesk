import 'server-only';
import { getPaperTrades } from '@/core/db/paper';
import { toUSD } from '@/core/format/fx';
import {
  positionRiskUSD,
  riskLimitsFromEnv,
  type OpenPositionUSD,
  type RiskLimits,
} from './checks';

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

export function openPositionsUSD(): OpenPositionUSD[] {
  return getPaperTrades({ status: 'open' }).map((t) => {
    const costUSD = toUSD(t.entryPrice * t.qty, t.currency);
    const stopRiskUSD =
      t.stopPrice != null
        ? toUSD(Math.abs(t.entryPrice - t.stopPrice) * t.qty, t.currency)
        : null;
    return { symbol: t.symbol, costUSD, stopRiskUSD };
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
