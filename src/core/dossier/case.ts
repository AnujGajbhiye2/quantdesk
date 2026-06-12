/**
 * Deterministic bull/bear case builder - the "researcher debate" from the
 * TradingAgents structure, replaced by a mechanical scored checklist.
 * Pure function over precomputed inputs: no I/O, no LLM, fully explainable.
 *
 * Every factor is a named claim with a one-line explanation. The verdict bar
 * (bull score vs bear score) summarizes; the factors ARE the reasoning.
 */

import type { Fundamentals } from '@/core/data/DataProvider';

export interface CaseFactor {
  /** Short label, e.g. 'Long-term uptrend'. */
  label: string;
  /** One-line plain-language explanation with the actual numbers. */
  detail: string;
}

export interface CaseInputs {
  /** Latest close. */
  lastClose: number | null;
  /** SMA50 and SMA200 of the latest bar (null while warming up / no data). */
  sma50: number | null;
  sma200: number | null;
  /** % below the 52-week high (0 = at high, 25 = 25% below). Null if unknown. */
  pctBelow52wHigh: number | null;
  /** Strategies currently signalling long / short on this symbol. */
  consensusLong: number;
  consensusShort: number;
  totalStrategies: number;
  /** Best symbol-scoped edge among strategies (null = no edge rows yet). */
  bestEdge: { strategyId: string; winRate: number; profitFactor: number; numTrades: number } | null;
  /** Realized hit-rate of past LONG signals on this symbol (+5 bars), null if < 5 samples. */
  longSignalHitRate: number | null;
  longSignalSamples: number;
  fundamentals: Fundamentals | null;
}

export interface SymbolCase {
  bull: CaseFactor[];
  bear: CaseFactor[];
  /** 0..100 - share of evaluated factors landing bullish. */
  bullScore: number;
  /** Factors that could not be evaluated (missing data). */
  unavailable: string[];
}

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

/** Build the bull/bear case. Each check lands in bull, bear, or unavailable. */
export function buildCase(input: CaseInputs): SymbolCase {
  const bull: CaseFactor[] = [];
  const bear: CaseFactor[] = [];
  const unavailable: string[] = [];

  // 1. Long-term trend
  if (input.lastClose != null && input.sma200 != null) {
    if (input.lastClose > input.sma200) {
      bull.push({
        label: 'Above 200-day average',
        detail: `price ${input.lastClose.toFixed(2)} > SMA200 ${input.sma200.toFixed(2)} - long-term uptrend intact`,
      });
    } else {
      bear.push({
        label: 'Below 200-day average',
        detail: `price ${input.lastClose.toFixed(2)} < SMA200 ${input.sma200.toFixed(2)} - long-term trend is down; most long edges degrade here`,
      });
    }
  } else {
    unavailable.push('long-term trend (not enough bars)');
  }

  // 2. Medium-term momentum
  if (input.sma50 != null && input.sma200 != null) {
    if (input.sma50 > input.sma200) {
      bull.push({
        label: 'Momentum regime',
        detail: 'SMA50 above SMA200 - medium-term momentum supports long setups',
      });
    } else {
      bear.push({
        label: 'No momentum regime',
        detail: 'SMA50 below SMA200 - medium-term momentum is against longs',
      });
    }
  } else {
    unavailable.push('momentum regime (not enough bars)');
  }

  // 3. Strategy consensus
  if (input.totalStrategies > 0) {
    if (input.consensusLong >= 2 && input.consensusLong > input.consensusShort) {
      bull.push({
        label: 'Strategy consensus long',
        detail: `${input.consensusLong}/${input.totalStrategies} independent strategies signal LONG right now`,
      });
    } else if (input.consensusShort >= 2 && input.consensusShort > input.consensusLong) {
      bear.push({
        label: 'Strategy consensus short',
        detail: `${input.consensusShort}/${input.totalStrategies} independent strategies signal SHORT right now`,
      });
    } else {
      bear.push({
        label: 'No strategy agreement',
        detail: 'fewer than 2 strategies agree on a direction - no statistical setup is live',
      });
    }
  }

  // 4. Backtested edge on this symbol
  if (input.bestEdge && input.bestEdge.numTrades >= 15) {
    const e = input.bestEdge;
    if (e.winRate >= 0.5 && e.profitFactor >= 1.5) {
      bull.push({
        label: 'Proven edge here',
        detail: `${e.strategyId}: ${pct(e.winRate)} win rate, ${e.profitFactor.toFixed(2)} profit factor over ${e.numTrades} trades on this symbol`,
      });
    } else {
      bear.push({
        label: 'Weak edge here',
        detail: `best strategy (${e.strategyId}) manages only ${pct(e.winRate)} win rate / ${e.profitFactor.toFixed(2)} profit factor on this symbol`,
      });
    }
  } else {
    unavailable.push('backtested edge (under 15 trades of history on this symbol)');
  }

  // 5. Did past long signals actually work?
  if (input.longSignalHitRate != null) {
    if (input.longSignalHitRate >= 0.5) {
      bull.push({
        label: 'Past signals worked',
        detail: `${pct(input.longSignalHitRate)} of the last ${input.longSignalSamples} long signals here were followed by a rise within 5 bars`,
      });
    } else {
      bear.push({
        label: 'Past signals failed',
        detail: `only ${pct(input.longSignalHitRate)} of the last ${input.longSignalSamples} long signals here were followed by a rise within 5 bars`,
      });
    }
  } else {
    unavailable.push(`signal track record (only ${input.longSignalSamples} stored long signal(s), need 5+)`);
  }

  // 6. Distance from 52-week high
  if (input.pctBelow52wHigh != null) {
    if (input.pctBelow52wHigh <= 10) {
      bull.push({
        label: 'Near 52-week high',
        detail: `${input.pctBelow52wHigh.toFixed(1)}% below the 52w high - strength, not distress`,
      });
    } else if (input.pctBelow52wHigh >= 30) {
      bear.push({
        label: 'Deep below 52-week high',
        detail: `${input.pctBelow52wHigh.toFixed(1)}% below the 52w high - heavy overhead supply; falling knives need extra proof`,
      });
    }
    // 10-30%: neutral zone, no factor either way
  } else {
    unavailable.push('52-week range');
  }

  // 7. Fundamentals sanity (long-bias checks)
  const f = input.fundamentals;
  if (f && (f.trailingPE != null || f.epsGrowth != null)) {
    if (f.epsGrowth != null && f.epsGrowth > 0) {
      bull.push({
        label: 'Earnings growing',
        detail: `quarterly earnings up ${pct(f.epsGrowth)} year-over-year`,
      });
    } else if (f.epsGrowth != null) {
      bear.push({
        label: 'Earnings shrinking',
        detail: `quarterly earnings down ${pct(Math.abs(f.epsGrowth))} year-over-year`,
      });
    }
    if (f.trailingPE != null && f.trailingPE > 0) {
      if (f.trailingPE <= 60) {
        bull.push({
          label: 'Valuation not extreme',
          detail: `trailing P/E ${f.trailingPE.toFixed(1)} - rich maybe, bubble no`,
        });
      } else {
        bear.push({
          label: 'Extreme valuation',
          detail: `trailing P/E ${f.trailingPE.toFixed(1)} - priced for perfection; disappointments hit hard`,
        });
      }
    }
  } else {
    unavailable.push('fundamentals (no provider data - normal for indices, crypto, forex)');
  }

  const evaluated = bull.length + bear.length;
  const bullScore = evaluated > 0 ? Math.round((bull.length / evaluated) * 100) : 50;

  return { bull, bear, bullScore, unavailable };
}
