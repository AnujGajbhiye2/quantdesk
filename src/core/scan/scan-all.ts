import 'server-only';
import type { Signal, Timeframe } from '@/core/types';
import type { Strategy } from '@/core/strategy/Strategy';
import { get as getStrategy, listLive as listLiveStrategies } from '@/core/strategy/registry';
import { getAllSymbols, getBars, getLatestBarTime, getRecentBars } from '@/core/db/bars';
import { insertSignals } from '@/core/db/signals';
import type { IndicatorCache } from '@/core/strategy/context';
import { evaluateSymbol, dropPartialToday, type ScanSymbolResult } from './scanner';
import { ScanCache } from './cache';
import { buildConsensus, type ConsensusSignal } from './consensus';
import { checkRegime } from '@/core/market/regime';
import { insertScanRun, insertDecisions, pruneOldRuns, type DecisionRow } from '@/core/db/runs';

/**
 * Cross-strategy, cross-market scanner.
 *
 * Runs every registered strategy against every symbol's latest bar.
 * Performance budget: < 10s for a 500+ symbol universe. Achieved by:
 * - loading only the trailing SCAN_BARS bars per symbol (covers MA200 warmup)
 * - module-level ScanCache keyed (symbol, timeframe, lastBarTime): bars and
 *   indicator outputs survive across scans and are invalidated only when new
 *   bars arrive
 * - one shared IndicatorCache per symbol reused by all strategies
 */

const SCAN_BARS = 600;

const dbLoader = {
  getLatestBarTime: (symbol: string, timeframe: Timeframe) =>
    getLatestBarTime(symbol, timeframe),
  loadBars: (symbol: string, timeframe: Timeframe) =>
    getRecentBars(symbol, timeframe, SCAN_BARS),
};

// Module-level singleton, same lifecycle pattern as the DB client.
// Reset on dev HMR is harmless - it is a cache.
let _scanCache: ScanCache | null = null;

function getScanCache(): ScanCache {
  if (!_scanCache) _scanCache = new ScanCache(dbLoader);
  return _scanCache;
}

export interface ScanAllOpts {
  symbols?:   string[];
  timeframe?: Timeframe;
  /** Persist signals to the DB. Default true. */
  persist?:   boolean;
  /**
   * Drop the final bar when it is dated today. Default true - a daily bar
   * fetched while the market is still open is partial and must not feed
   * signal generation. Only post-close paths (EOD cron) may pass false.
   */
  excludeToday?: boolean;
  /**
   * When set, write a scan_runs row and full decision_log (one row per
   * symbol x strategy, including no-fire holds) at the end of the run.
   * Omit for ad-hoc scans that should not appear on the session dashboard.
   */
  logRun?: { trigger: 'eod-cron' | 'manual' | 'api' };
}

export interface ScanAllResult {
  signals:    Signal[];
  rawResults: ScanSymbolResult[];
  consensus:  ConsensusSignal[];
  scanned:    number;
  totalStrategies: number;
  durationMs: number;
  /** Set when logRun was passed and the run was successfully persisted. */
  runId?: number;
}

export function scanAll(opts: ScanAllOpts = {}): ScanAllResult {
  const startedAt  = new Date().toISOString();
  const started    = Date.now();
  const timeframe  = opts.timeframe ?? '1d';
  const symbols    = opts.symbols ?? getAllSymbols().map((s) => s.symbol);
  const cache      = getScanCache();

  // Resolve strategies and pre-parse default params once, outside the loops.
  // Also pre-evaluate regime alignment per strategy (strategy-level gate).
  // listLiveStrategies() limits to the three walk-forward-validated live strategies.
  const strategies: Array<{ strategy: Strategy; parsedParams: unknown; regimeAligned: boolean }> =
    listLiveStrategies().map(({ id }) => {
      const strategy = getStrategy(id);
      let regimeAligned = true;
      if (strategy.regime) {
        try {
          const req = strategy.regime;
          const indexStored = getBars(req.index, timeframe);
          const indexBars   = opts.excludeToday === false ? indexStored : dropPartialToday(indexStored);
          regimeAligned = checkRegime(req, indexBars);
        } catch {
          regimeAligned = true; // index not ingested - neutral pass
        }
      }
      return { strategy, parsedParams: strategy.params.parse({}), regimeAligned };
    });

  const signals:      Signal[]           = [];
  const rawResults:   ScanSymbolResult[] = [];
  const decisionRows: DecisionRow[]      = [];
  let scanned = 0;

  for (const symbol of symbols) {
    let series;
    try {
      series = cache.get(symbol, timeframe);
    } catch {
      continue; // skip symbol on load error; don't abort the scan
    }
    if (!series) continue;
    scanned += 1;

    // Trimming today's partial bar invalidates the shared indicator cache
    // (outputs are aligned to the full series), so use a throwaway cache for
    // the trimmed series. dropPartialToday returns the same reference when
    // nothing is trimmed, making the check cheap.
    const bars = opts.excludeToday === false
      ? series.bars
      : dropPartialToday(series.bars);
    const indicators: IndicatorCache =
      bars === series.bars ? series.indicators : new Map();

    for (const { strategy, parsedParams, regimeAligned } of strategies) {
      if (!regimeAligned) {
        // Strategy regime precondition not met - log as hold with reason
        if (opts.logRun) {
          decisionRows.push({
            runId:      0, // filled in after insertScanRun
            symbol,
            strategyId: strategy.id,
            barTime:    bars.length > 0 ? bars[bars.length - 1].time : new Date().toISOString().slice(0, 10),
            fired:      0,
            action:     'hold',
            reason:     'regime filter blocked - market conditions not aligned',
          });
        }
        continue;
      }
      try {
        const evaluated = evaluateSymbol(bars, strategy, parsedParams, indicators);
        if (!evaluated) continue;

        const { decision } = evaluated;
        const fired = decision.action !== 'hold';

        if (opts.logRun) {
          decisionRows.push({
            runId:      0, // filled in after insertScanRun
            symbol,
            strategyId: strategy.id,
            barTime:    evaluated.barTime,
            fired:      fired ? 1 : 0,
            action:     decision.action,
            reason:     decision.reason ?? null,
          });
        }

        if (fired) {
          const side: Signal['side'] =
            decision.action === 'enter_long'  ? 'long'
            : decision.action === 'enter_short' ? 'short'
            : 'flat'; // 'exit'
          const signal: Signal = {
            symbol,
            time:       evaluated.barTime,
            side,
            reason:     decision.reason ?? '',
            strategyId: strategy.id,
          };
          signals.push(signal);
          rawResults.push({ signal, decision, bars });
        }
      } catch {
        // skip strategy on error for this symbol
      }
    }
  }

  const consensus = buildConsensus(signals, strategies.length);

  // Carry consensus strength back onto persisted signals so history queries
  // can rank without recomputing.
  const strengthByKey = new Map<string, number>();
  for (const c of consensus) strengthByKey.set(`${c.symbol}|${c.side}`, c.strength);
  for (const s of signals) {
    if (s.side === 'flat') continue;
    s.strength = strengthByKey.get(`${s.symbol}|${s.side}`) ?? s.strength;
  }

  if (opts.persist !== false && signals.length > 0) {
    insertSignals(signals);
  }

  const durationMs = Date.now() - started;

  let runId: number | undefined;

  if (opts.logRun) {
    try {
      runId = insertScanRun({
        startedAt,
        finishedAt:       new Date().toISOString(),
        timeframe,
        trigger:          opts.logRun.trigger,
        symbolsScanned:   scanned,
        strategiesCount:  strategies.length,
        evaluations:      scanned * strategies.length,
        signalsGenerated: signals.length,
        // tradesOpened / tradesClosed are updated by the caller (post-refresh)
        // after sweeping via updateScanRunCounts(runId, opened, closed).
        tradesOpened:     0,
        tradesClosed:     0,
        durationMs,
      });
      // Backfill the runId into collected decision rows
      for (const r of decisionRows) r.runId = runId;
      insertDecisions(decisionRows);
      pruneOldRuns(30);
    } catch (err) {
      // Non-fatal: run logging failure must not break the scan result
      console.error('[scan-all] run logging failed:', err);
    }
  }

  return {
    signals,
    rawResults,
    consensus,
    scanned,
    totalStrategies: strategies.length,
    durationMs,
    runId,
  };
}
