/**
 * Walk-forward out-of-sample validation.
 *
 * Wraps runBacktest to produce a stability report across multiple sequential
 * out-of-sample (OOS) windows. Answers: "does this strategy survive unseen
 * market regimes with the same fixed params?" before live paper-trading.
 *
 * v1 - fixed-param OOS stability report:
 *   The same rawParams are used on every window (no optimizer). This is the
 *   minimum useful check: if the strategy bleeds in 3 of 5 OOS windows on the
 *   same params it was "designed on", the edge is regime-dependent and not
 *   trustworthy without a regime filter.
 *
 * Two modes:
 *   rolling   - train window slides forward each step (equal-size windows)
 *   anchored  - train window grows from a fixed start (expanding history)
 *
 * The OOS slices are non-overlapping by construction and cover the last
 * (1 - trainFrac) fraction of the data.
 *
 * The decay metric (inSampleVsOosDecayPct) tells you how much edge is lost
 * going from the full in-sample run to the average OOS window. A negative
 * decay (OOS outperforms IS) is suspicious; >30% decay suggests overfit or
 * regime-dependence worth investigating.
 */

import type { Bar } from '@/core/types';
import type { Strategy } from '../strategy/Strategy';
import { runBacktest, type BacktestConfig, type BacktestMetrics } from './engine';
import { computeMetrics } from './metrics';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WalkForwardConfig {
  strategy:   Strategy;
  bars:       readonly Bar[];
  rawParams?: unknown;
  /** 'rolling' slides both train start and end; 'anchored' keeps train start fixed. */
  mode:       'rolling' | 'anchored';
  /** Fraction of total bars reserved for training in each window, e.g. 0.7. */
  trainFrac:  number;
  /** Number of OOS slices to produce. Each slice covers 1/windows of the OOS pool. */
  windows:    number;
  /** Passthrough to runBacktest */
  commission?:    number;
  slippagePct?:   number;
  initialEquity?: number;
  barsPerYear?:   number;
  maxHoldBars?:   number;
  regimeBars?:    Record<string, readonly Bar[]>;
  // Improvement engine overrides (passed through to every runBacktest call)
  trailingStopActivationPct?: number;
  trailingStopDistancePct?:   number;
  maxEntrySlippagePct?:       number;
  gapDownWidenPct?:           number;
  dynamicSizing?:             boolean;
  partialExitFraction?:       number;
  partialExitAtTargetPct?:    number;
}

export interface WalkForwardWindow {
  trainRange: { from: string; to: string };
  testRange:  { from: string; to: string };
  /** rawParams passed through unchanged in v1. */
  chosenParams: unknown;
  test: BacktestMetrics;
  testTrades: number;
}

export interface WalkForwardConsistency {
  /** Standard deviation of win-rate across OOS windows. Low = stable. */
  oosWinRateStd:         number;
  /** Fraction of OOS windows with positive total return (0..1). */
  profitableWindowFrac:  number;
  /**
   * Full in-sample return minus mean OOS return (percentage points).
   * Positive = edge decays out-of-sample (expected). Negative = suspicious.
   */
  inSampleVsOosDecayPct: number;
}

export interface WalkForwardResult {
  windows:     WalkForwardWindow[];
  /** Metrics computed by stitching all OOS trade records and equity curve. */
  oosAggregate: BacktestMetrics;
  consistency:  WalkForwardConsistency;
  /** Full in-sample metrics (single pass over all bars) for comparison. */
  inSample:     BacktestMetrics;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export function runWalkForward(config: WalkForwardConfig): WalkForwardResult {
  const {
    strategy,
    bars,
    rawParams     = {},
    mode,
    trainFrac,
    windows,
    commission    = 0,
    slippagePct   = 0.0005,
    initialEquity = 10_000,
    barsPerYear   = 252,
    maxHoldBars,
    regimeBars,
    trailingStopActivationPct,
    trailingStopDistancePct,
    maxEntrySlippagePct,
    gapDownWidenPct,
    dynamicSizing,
    partialExitFraction,
    partialExitAtTargetPct,
  } = config;

  const n = bars.length;

  if (n < 10) throw new Error('walk-forward requires at least 10 bars');
  if (trainFrac <= 0 || trainFrac >= 1) throw new Error('trainFrac must be in (0, 1)');
  if (windows < 1 || !Number.isInteger(windows)) throw new Error('windows must be a positive integer');

  const baseEngineConfig: Omit<BacktestConfig, 'strategy' | 'bars' | 'rawParams'> = {
    commission,
    slippagePct,
    initialEquity,
    barsPerYear,
    maxHoldBars,
    regimeBars,
    trailingStopActivationPct,
    trailingStopDistancePct,
    maxEntrySlippagePct,
    gapDownWidenPct,
    dynamicSizing,
    partialExitFraction,
    partialExitAtTargetPct,
  };

  // --- Full in-sample run (all bars) ---
  const inSampleResult = runBacktest({ strategy, bars, rawParams, ...baseEngineConfig });
  const inSample = inSampleResult.metrics;

  // --- Build OOS windows ---
  // The OOS pool is the last (1 - trainFrac) fraction of bars.
  // Split it into `windows` non-overlapping slices of equal size.
  const oosTotalBars = Math.floor(n * (1 - trainFrac));
  const sliceSize    = Math.floor(oosTotalBars / windows);

  if (sliceSize < 2) {
    throw new Error(
      `OOS slice too small (${sliceSize} bars). Reduce windows or increase trainFrac.`,
    );
  }

  const oosBars = bars.slice(n - oosTotalBars);

  const wfWindows: WalkForwardWindow[] = [];

  for (let w = 0; w < windows; w++) {
    const testStart = w * sliceSize;
    const testEnd   = w === windows - 1 ? oosBars.length : (w + 1) * sliceSize;
    const testBars  = oosBars.slice(testStart, testEnd);

    if (testBars.length < 2) continue;

    // Train window: everything before this OOS slice
    const trainEndIdx = n - oosTotalBars + testStart;
    const trainStart  = mode === 'rolling'
      ? Math.max(0, trainEndIdx - Math.floor(n * trainFrac))
      : 0;
    const trainBars = bars.slice(trainStart, trainEndIdx);

    const testResult = runBacktest({
      strategy,
      bars:     testBars,
      rawParams,
      ...baseEngineConfig,
    });

    wfWindows.push({
      trainRange: {
        from: trainBars[0]?.time ?? testBars[0].time,
        to:   trainBars[trainBars.length - 1]?.time ?? testBars[0].time,
      },
      testRange: {
        from: testBars[0].time,
        to:   testBars[testBars.length - 1].time,
      },
      chosenParams: rawParams,
      test:         testResult.metrics,
      testTrades:   testResult.trades.length,
    });
  }

  // --- OOS aggregate: stitch all test trade records + equity curves ---
  // Re-run a single backtest over the entire OOS pool for a coherent equity
  // curve (rather than trying to concatenate per-window curves).
  const oosResult = runBacktest({
    strategy,
    bars:     oosBars,
    rawParams,
    ...baseEngineConfig,
  });
  const oosAggregate = oosResult.metrics;

  // --- Consistency stats ---
  const winRates = wfWindows.map((w) => w.test.winRate);
  const meanWR   = winRates.reduce((s, r) => s + r, 0) / (winRates.length || 1);
  const oosWinRateStd = Math.sqrt(
    winRates.reduce((s, r) => s + (r - meanWR) ** 2, 0) / Math.max(winRates.length - 1, 1),
  );
  const profitableWindowFrac =
    wfWindows.filter((w) => w.test.totalReturnPct > 0).length / Math.max(wfWindows.length, 1);

  const meanOosReturn =
    wfWindows.reduce((s, w) => s + w.test.totalReturnPct, 0) / Math.max(wfWindows.length, 1);
  const inSampleVsOosDecayPct = inSample.totalReturnPct - meanOosReturn;

  return {
    windows:      wfWindows,
    oosAggregate,
    consistency: {
      oosWinRateStd,
      profitableWindowFrac,
      inSampleVsOosDecayPct,
    },
    inSample,
  };
}
