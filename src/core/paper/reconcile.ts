import 'server-only';
import { getPaperTrades } from '@/core/db/paper';
import { buildPerformanceMetrics } from '@/core/paper/perf';
import { toUSD } from '@/core/format/fx';
import { mirrorDriftStats } from '@/core/broker/mirror-reconcile';
import { mirrorEnabled } from '@/core/broker/mirror';

/**
 * Live-vs-backtest reconciliation (IMPROVEMENT_PLAN.md WS5): compares the
 * live paper book's realized statistics against each strategy's walk-forward
 * OOS expectation, and evaluates the written promotion criteria
 * (PROMOTION_CRITERIA.md - numbers fixed there, do not move them here).
 *
 * Slippage: with Alpaca mirroring enabled, real fill prices from the paper
 * follower account are compared against the internal modeled fills (5 bps) -
 * see core/broker/mirror-reconcile.ts. Without mirroring, paper fills ARE
 * the cost model and the criterion stays not-applicable rather than silently
 * passing as 0 drift.
 */

// Walk-forward OOS expectations for the LIVE configuration (trailing stop +
// target ratchet combined - FEATURE=both), from the 2026-07-03 Round 3
// evaluation in SYSTEM_AUDIT_AND_ROADMAP.md. Update only when a new
// walk-forward run on corrected data replaces that evidence.
export interface StrategyExpectation {
  oosSharpe: number;
  oosWinRate: number;    // 0..1
  oosMaxDrawdownPct: number;
}
export const WF_EXPECTATIONS: Record<string, StrategyExpectation> = {
  'rsi-reversion':       { oosSharpe: 0.50, oosWinRate: 0.72, oosMaxDrawdownPct: 11.06 },
  'bollinger-reversion': { oosSharpe: 0.47, oosWinRate: 0.67, oosMaxDrawdownPct: 16.33 },
  'stoch-reversal':      { oosSharpe: 0.44, oosWinRate: 0.68, oosMaxDrawdownPct: 15.53 },
};

/** Win-rate drift beyond this (percentage points, over the trailing window) raises a flag. */
export const DRIFT_WINRATE_PP = 15;
/** Trailing window (closed trades) used for drift detection. */
export const DRIFT_WINDOW = 20;

export interface StrategyReconcileRow {
  strategyId:   string;
  liveTrades:   number;
  liveWinRate:  number | null;   // null below MIN_SAMPLE
  liveAvgR:     number | null;   // mean pnl / initial stop risk (stop-carrying trades only)
  /** null = insufficient sample; -1 = no losing trades yet (PF undefined/infinite - JSON cannot carry Infinity). */
  liveProfitFactor: number | null;
  wfWinRate:    number | null;   // null when the strategy has no WF expectation entry
  wfSharpe:     number | null;
  flags:        string[];
}

export interface PromotionCriterionRow {
  id:          string;
  label:       string;
  target:      string;
  actual:      string;
  status:      'pass' | 'fail' | 'pending' | 'n/a';
}

export interface ReconcileReport {
  generatedAt: string;
  rows:        StrategyReconcileRow[];
  criteria:    PromotionCriterionRow[];
}

/** Below this many closed trades a strategy row reports nulls, not noise. */
export const MIN_SAMPLE = 5;

// Promotion criteria constants - MUST mirror PROMOTION_CRITERIA.md verbatim.
const PROMO_MIN_TRADES        = 60;
const PROMO_MIN_MONTHS        = 6;
const PROMO_SHARPE_FRACTION   = 0.7;   // live Sharpe >= 0.7x blended WF OOS Sharpe
const PROMO_WF_BLENDED_SHARPE = 0.47;  // mean of the three live strategies' WF OOS Sharpe
const PROMO_MAX_DD_MULT       = 1.25;  // live max DD <= 1.25x worst modeled OOS DD
const PROMO_WORST_MODELED_DD  = 16.33; // bollinger-reversion OOS max DD, FEATURE=both

export function buildReconcileReport(): ReconcileReport {
  const closed = getPaperTrades({ status: 'closed' })
    .filter((t) => t.exitTime != null)
    .sort((a, b) => (a.exitTime! < b.exitTime! ? -1 : 1));

  // ---- per-strategy rows -------------------------------------------------
  const byStrategy = new Map<string, typeof closed>();
  for (const t of closed) {
    const arr = byStrategy.get(t.strategyId) ?? [];
    arr.push(t);
    byStrategy.set(t.strategyId, arr);
  }

  const rows: StrategyReconcileRow[] = [];
  for (const [strategyId, trades] of byStrategy) {
    const exp = WF_EXPECTATIONS[strategyId] ?? null;
    const flags: string[] = [];

    let liveWinRate: number | null = null;
    let liveAvgR: number | null = null;
    let livePf: number | null = null;

    if (trades.length >= MIN_SAMPLE) {
      const wins = trades.filter((t) => (t.pnl ?? 0) > 0);
      liveWinRate = wins.length / trades.length;

      const grossW = wins.reduce((s, t) => s + toUSD(t.pnl ?? 0, t.currency), 0);
      const grossL = Math.abs(
        trades.filter((t) => (t.pnl ?? 0) <= 0)
          .reduce((s, t) => s + toUSD(t.pnl ?? 0, t.currency), 0),
      );
      livePf = grossL > 0 ? grossW / grossL : grossW > 0 ? -1 : 0;

      // R multiple: realized pnl over initial stop risk, stop-carrying trades only
      const withStop = trades.filter((t) => t.stopPrice != null && t.stopPrice > 0);
      if (withStop.length > 0) {
        const rs = withStop.map((t) => {
          const riskUSD = toUSD(Math.abs(t.entryPrice - t.stopPrice!) * t.qty, t.currency);
          return riskUSD > 0 ? toUSD(t.pnl ?? 0, t.currency) / riskUSD : 0;
        });
        liveAvgR = rs.reduce((s, r) => s + r, 0) / rs.length;
      }

      // Drift: trailing-window win rate vs WF expectation
      if (exp) {
        const window = trades.slice(-DRIFT_WINDOW);
        if (window.length >= DRIFT_WINDOW) {
          const wr = window.filter((t) => (t.pnl ?? 0) > 0).length / window.length;
          const driftPp = (exp.oosWinRate - wr) * 100;
          if (driftPp > DRIFT_WINRATE_PP) {
            flags.push(
              `win-rate drift: last ${DRIFT_WINDOW} trades ${(wr * 100).toFixed(0)}% vs WF ${(exp.oosWinRate * 100).toFixed(0)}% (-${driftPp.toFixed(0)}pp)`,
            );
          }
        }
      } else {
        flags.push('no walk-forward expectation on file');
      }
    }

    rows.push({
      strategyId,
      liveTrades: trades.length,
      liveWinRate,
      liveAvgR,
      liveProfitFactor: livePf,
      wfWinRate: exp?.oosWinRate ?? null,
      wfSharpe:  exp?.oosSharpe ?? null,
      flags,
    });
  }
  rows.sort((a, b) => b.liveTrades - a.liveTrades);

  // ---- promotion criteria ------------------------------------------------
  const perf = buildPerformanceMetrics();
  const firstExit = closed[0]?.exitTime ?? null;
  const monthsElapsed = firstExit
    ? (Date.now() - new Date(firstExit).getTime()) / (30.44 * 86400_000)
    : 0;

  const criteria: PromotionCriterionRow[] = [
    {
      id: 'trades',
      label: 'Closed live paper trades',
      target: `>= ${PROMO_MIN_TRADES}`,
      actual: String(perf.totalTrades),
      status: perf.totalTrades >= PROMO_MIN_TRADES ? 'pass' : 'pending',
    },
    {
      id: 'months',
      label: 'Months of live operation',
      target: `>= ${PROMO_MIN_MONTHS}`,
      actual: monthsElapsed.toFixed(1),
      status: monthsElapsed >= PROMO_MIN_MONTHS ? 'pass' : 'pending',
    },
    {
      id: 'sharpe',
      label: `Live Sharpe >= ${PROMO_SHARPE_FRACTION}x blended WF OOS (${PROMO_WF_BLENDED_SHARPE})`,
      target: `>= ${(PROMO_SHARPE_FRACTION * PROMO_WF_BLENDED_SHARPE).toFixed(2)}`,
      actual: perf.sharpe != null ? perf.sharpe.toFixed(2) : `n/a (< 30 trades)`,
      status: perf.sharpe == null
        ? 'pending'
        : perf.sharpe >= PROMO_SHARPE_FRACTION * PROMO_WF_BLENDED_SHARPE ? 'pass' : 'fail',
    },
    {
      id: 'drawdown',
      label: `Live max drawdown <= ${PROMO_MAX_DD_MULT}x worst modeled OOS DD (${PROMO_WORST_MODELED_DD}%)`,
      target: `<= ${(PROMO_MAX_DD_MULT * PROMO_WORST_MODELED_DD).toFixed(1)}%`,
      actual: `${perf.maxDrawdownPct.toFixed(1)}%`,
      status: perf.maxDrawdownPct <= PROMO_MAX_DD_MULT * PROMO_WORST_MODELED_DD ? 'pass' : 'fail',
    },
    buildSlippageCriterion(),
  ];

  return { generatedAt: new Date().toISOString(), rows, criteria };
}

// Modeled slippage is 5 bps per fill (broker/engine default). The promotion
// criterion allows actual slippage up to 2x the model, i.e. mean drift beyond
// the model must stay under +5 bps. Requires 20 clean (day-tif) mirrored
// fills before it reports a number - OPG fills embed overnight gap and are
// excluded (see mirror-reconcile.ts).
const SLIPPAGE_MODEL_BPS = 5;
const SLIPPAGE_MIN_FILLS = 20;

function buildSlippageCriterion(): PromotionCriterionRow {
  const base = {
    id: 'slippage',
    label: 'Slippage drift < 2x model',
    target: `< +${SLIPPAGE_MODEL_BPS} bps vs model`,
  };
  if (!mirrorEnabled()) {
    return { ...base, actual: 'n/a on paper (fills are the model; enable Alpaca mirror)', status: 'n/a' };
  }
  const drift = mirrorDriftStats();
  if (!drift || drift.fills < SLIPPAGE_MIN_FILLS) {
    const n = drift?.fills ?? 0;
    return { ...base, actual: `pending (${n}/${SLIPPAGE_MIN_FILLS} mirrored day fills)`, status: 'pending' };
  }
  return {
    ...base,
    actual: `${drift.meanDriftBps >= 0 ? '+' : ''}${drift.meanDriftBps.toFixed(1)} bps mean over ${drift.fills} fills`,
    status: drift.meanDriftBps < SLIPPAGE_MODEL_BPS ? 'pass' : 'fail',
  };
}
