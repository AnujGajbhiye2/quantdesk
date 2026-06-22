/**
 * Pre-trade risk checks - the deterministic "risk management team".
 *
 * Pure functions: caller supplies the account state, open positions and the
 * candidate trade (all amounts already converted to USD). Enforced by the
 * paper broker on every open; surfaced in the UI as exposure gauges.
 *
 * Each rule exists to stop a specific way accounts die:
 * - concentration: one bad position cannot sink the account
 * - total open risk: simultaneous stop-outs stay survivable
 * - max open trades: attention and correlation discipline
 * - drawdown halt: a system that is losing badly must stop trading, not "win it back"
 * - correlated-cluster: 3 correlated longs is 1 big bet, not 3 independent ones
 */

export interface RiskLimits {
  /** Max entry cost of a single position, as % of equity. */
  maxPositionPct: number;
  /** Max sum of stop-loss risk across all open trades + candidate, as % of equity. */
  maxOpenRiskPct: number;
  /** Max number of simultaneously open trades. */
  maxOpenTrades: number;
  /** Halt all new entries when equity has fallen this % below the starting budget. */
  haltDrawdownPct: number;
  /**
   * Rolling-return correlation threshold above which two positions are considered
   * part of the same "cluster". When the candidate's correlation to any open
   * position exceeds this AND the combined cluster risk exceeds clusterRiskPct,
   * the entry is blocked. Default 0.7.
   */
  corrThreshold: number;
  /**
   * Max combined stop-loss risk for any correlated cluster as % of equity.
   * Prevents building a levered sector bet through per-trade 1% sizing.
   * Default 3 (%).
   */
  clusterRiskPct: number;
}

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxPositionPct:  25,
  maxOpenRiskPct:  6,
  // 4 concurrent positions: SP500 MR strategies correlate in drawdown; more than 4 is one big bet.
  maxOpenTrades:   4,
  // Halt permanently at 12% portfolio drawdown from starting budget.
  // OOS walk-forward max DD for these MR strategies is ~8-10%; 12% = 1.5x OOS max DD.
  // Requires manual reset (new starting budget) to lift - not auto-resuming.
  haltDrawdownPct: 12,
  corrThreshold:   0.7,
  clusterRiskPct:  3,
};

/** Resolve limits from env with NaN-safe fallbacks to the defaults. */
export function riskLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): RiskLimits {
  const num = (key: string, fallback: number): number => {
    const v = Number(env[key]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  return {
    maxPositionPct:  num('RISK_MAX_POSITION_PCT',  DEFAULT_RISK_LIMITS.maxPositionPct),
    maxOpenRiskPct:  num('RISK_MAX_OPEN_RISK_PCT', DEFAULT_RISK_LIMITS.maxOpenRiskPct),
    maxOpenTrades:   num('RISK_MAX_OPEN_TRADES',   DEFAULT_RISK_LIMITS.maxOpenTrades),
    haltDrawdownPct: num('RISK_HALT_DRAWDOWN_PCT', DEFAULT_RISK_LIMITS.haltDrawdownPct),
    corrThreshold:   num('RISK_CORR_THRESHOLD',    DEFAULT_RISK_LIMITS.corrThreshold),
    clusterRiskPct:  num('RISK_CLUSTER_RISK_PCT',  DEFAULT_RISK_LIMITS.clusterRiskPct),
  };
}

/** Open position, already USD-converted. */
export interface OpenPositionUSD {
  symbol:    string;
  /** Entry notional (entryPrice * qty) in USD. */
  costUSD:   number;
  /** Stop-loss risk (|entry - stop| * qty) in USD; null = no stop set. */
  stopRiskUSD: number | null;
  /**
   * Rolling-return correlation between this position and the candidate trade.
   * Computed externally (core/risk/correlation.ts) and passed in to keep
   * checkRisk pure (no bar loading here). null = not computed / not available.
   */
  corrToCandidate?: number | null;
}

export interface CandidateTradeUSD {
  symbol:      string;
  costUSD:     number;
  stopRiskUSD: number | null;
}

export interface AccountStateUSD {
  startingBalance: number;
  equity:          number;
}

export type RiskRule = 'drawdown-halt' | 'manual-halt' | 'max-open-trades' | 'position-concentration' | 'total-open-risk' | 'correlated-cluster';

export type RiskCheckResult =
  | { ok: true }
  | { ok: false; rule: RiskRule; message: string };

/**
 * Risk taken by a position if its stop is hit. Positions without a stop are
 * charged their FULL entry notional - the honest worst case, and a strong
 * nudge to always set stops.
 */
export function positionRiskUSD(p: { costUSD: number; stopRiskUSD: number | null }): number {
  return p.stopRiskUSD ?? p.costUSD;
}

export function checkRisk(
  account:   AccountStateUSD,
  openTrades: readonly OpenPositionUSD[],
  candidate: CandidateTradeUSD,
  limits:    RiskLimits = DEFAULT_RISK_LIMITS,
): RiskCheckResult {
  const { equity, startingBalance } = account;

  // 1. Drawdown circuit breaker - checked first; a bleeding system must not trade
  const haltFloor = startingBalance * (1 - limits.haltDrawdownPct / 100);
  if (equity <= haltFloor) {
    const ddPct = ((startingBalance - equity) / startingBalance) * 100;
    return {
      ok: false,
      rule: 'drawdown-halt',
      message:
        `Drawdown halt: equity $${equity.toFixed(2)} is ${ddPct.toFixed(1)}% below the ` +
        `$${startingBalance.toFixed(2)} budget (limit ${limits.haltDrawdownPct}%). ` +
        `The system is losing - stop and review before adding new trades. ` +
        `Reset the budget to lift the halt.`,
    };
  }

  // 2. Max open trades
  if (openTrades.length + 1 > limits.maxOpenTrades) {
    return {
      ok: false,
      rule: 'max-open-trades',
      message:
        `Max open trades: already holding ${openTrades.length} of ${limits.maxOpenTrades}. ` +
        `More positions than this is unmanageable and usually correlated - close something first.`,
    };
  }

  // 3. Position concentration
  const maxCost = equity * (limits.maxPositionPct / 100);
  if (candidate.costUSD > maxCost) {
    return {
      ok: false,
      rule: 'position-concentration',
      message:
        `Position too large: $${candidate.costUSD.toFixed(2)} is over ${limits.maxPositionPct}% ` +
        `of equity (max $${maxCost.toFixed(2)}). One position must never be able to sink the account.`,
    };
  }

  // 4. Total open risk (stop-loss distance summed; stop-less = full notional)
  const openRisk  = openTrades.reduce((sum, p) => sum + positionRiskUSD(p), 0);
  const totalRisk = openRisk + positionRiskUSD(candidate);
  const maxRisk   = equity * (limits.maxOpenRiskPct / 100);
  if (totalRisk > maxRisk) {
    return {
      ok: false,
      rule: 'total-open-risk',
      message:
        `Total open risk too high: $${totalRisk.toFixed(2)} at risk if every stop hits ` +
        `(limit ${limits.maxOpenRiskPct}% of equity = $${maxRisk.toFixed(2)}). ` +
        `A bad week must stay survivable - reduce size or close positions.`,
    };
  }

  // 5. Correlated cluster risk
  // If any open position has a high correlation to the candidate AND the
  // combined cluster risk (stop-loss risk of both) exceeds the cluster cap,
  // block the entry. This catches "three tech stocks = one big bet" scenarios
  // that per-trade 1% sizing completely misses.
  // corrToCandidate is pre-computed by the caller using core/risk/correlation.ts.
  // When null/undefined (data unavailable), this rule is skipped.
  const clusterMaxRisk = equity * (limits.clusterRiskPct / 100);
  for (const open of openTrades) {
    const corr = open.corrToCandidate;
    if (corr == null || !Number.isFinite(corr)) continue;
    if (Math.abs(corr) < limits.corrThreshold) continue;
    const clusterRisk = positionRiskUSD(open) + positionRiskUSD(candidate);
    if (clusterRisk > clusterMaxRisk) {
      return {
        ok: false,
        rule: 'correlated-cluster',
        message:
          `Correlated cluster: ${candidate.symbol} has ${(corr * 100).toFixed(0)}% rolling ` +
          `correlation to open position ${open.symbol}. Combined cluster risk ` +
          `$${clusterRisk.toFixed(2)} exceeds the ${limits.clusterRiskPct}% cluster cap ` +
          `($${clusterMaxRisk.toFixed(2)}). Three correlated positions is one levered bet - ` +
          `close ${open.symbol} first or reduce size.`,
      };
    }
  }

  return { ok: true };
}
