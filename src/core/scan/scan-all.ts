import 'server-only';
import type { Signal, Timeframe } from '@/core/types';
import type { Strategy } from '@/core/strategy/Strategy';
import { get as getStrategy, list as listStrategies } from '@/core/strategy/registry';
import { getAllSymbols, getLatestBarTime, getRecentBars } from '@/core/db/bars';
import { insertSignals } from '@/core/db/signals';
import type { IndicatorCache } from '@/core/strategy/context';
import { scanSymbol, dropPartialToday, type ScanSymbolResult } from './scanner';
import { ScanCache } from './cache';
import { buildConsensus, type ConsensusSignal } from './consensus';

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
}

export interface ScanAllResult {
  signals:    Signal[];
  rawResults: ScanSymbolResult[];
  consensus:  ConsensusSignal[];
  scanned:    number;
  totalStrategies: number;
  durationMs: number;
}

export function scanAll(opts: ScanAllOpts = {}): ScanAllResult {
  const started   = Date.now();
  const timeframe = opts.timeframe ?? '1d';
  const symbols   = opts.symbols ?? getAllSymbols().map((s) => s.symbol);
  const cache     = getScanCache();

  // Resolve strategies and pre-parse default params once, outside the loops.
  const strategies: Array<{ strategy: Strategy; parsedParams: unknown }> =
    listStrategies().map(({ id }) => {
      const strategy = getStrategy(id);
      return { strategy, parsedParams: strategy.params.parse({}) };
    });

  const signals:    Signal[]           = [];
  const rawResults: ScanSymbolResult[] = [];
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

    for (const { strategy, parsedParams } of strategies) {
      try {
        const result = scanSymbol(
          symbol,
          bars,
          strategy,
          parsedParams,
          indicators,
        );
        if (result) {
          signals.push(result.signal);
          rawResults.push(result);
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

  return {
    signals,
    rawResults,
    consensus,
    scanned,
    totalStrategies: strategies.length,
    durationMs: Date.now() - started,
  };
}
