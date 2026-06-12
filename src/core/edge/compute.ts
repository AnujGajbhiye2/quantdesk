import 'server-only';
import type { AssetClass, Timeframe } from '@/core/types';
import { get as getStrategy, list as listStrategies } from '@/core/strategy/registry';
import { runBacktest } from '@/core/backtest/engine';
import { maxHoldBars } from '@/core/config';
import { getAllSymbols, getLatestBarTime, getRecentBars } from '@/core/db/bars';
import { upsertEdgeStats } from '@/core/db/edge';
import { aggregateEdge, type SlimTrade } from './aggregate';
import { classScope, symScope, GLOBAL_SCOPE, type EdgeStats } from './types';

/**
 * Compute backtested edge for every (strategy x symbol) pair over a trailing
 * ~2y window and persist per-symbol, per-asset-class, and global rows.
 *
 * Heavy (full backtests) - runs at EOD refresh or on demand, never in the
 * <10s scan path. Incremental: per-symbol trade lists are cached in memory
 * keyed by lastBarTime, so a re-run after no new bars only re-pools.
 */

// 504 trading days = ~2y window + 100 bars indicator warmup.
const EDGE_BARS  = 604;
const MIN_BARS   = 120;
const TIMEFRAME: Timeframe = '1d';

interface CachedTrades {
  lastBarTime: string;
  trades:      SlimTrade[];
  testedFrom:  string;
  testedTo:    string;
}

// strategyId|symbol -> cached slim trades, validated by lastBarTime
const _tradesCache = new Map<string, CachedTrades>();

export interface ComputeEdgeResult {
  symbols:    number;
  strategies: number;
  rows:       number;
  recomputed: number;
  durationMs: number;
}

export function computeEdgeForUniverse(opts: { symbols?: string[] } = {}): ComputeEdgeResult {
  const started = Date.now();
  const metas   = getAllSymbols();
  const wanted  = opts.symbols ? new Set(opts.symbols) : null;
  const universe = wanted ? metas.filter((m) => wanted.has(m.symbol)) : metas;

  const strategies = listStrategies().map(({ id }) => getStrategy(id));
  const computedAt = new Date().toISOString();
  const rows: EdgeStats[] = [];
  let recomputed = 0;

  for (const strategy of strategies) {
    const parsedParams = strategy.params.parse({});

    // Pools for class/global rows - real trade lists, not average-of-averages
    const classPools = new Map<AssetClass, SlimTrade[]>();
    const globalPool: SlimTrade[] = [];
    let testedFrom = '';
    let testedTo   = '';

    for (const meta of universe) {
      const lastBarTime = getLatestBarTime(meta.symbol, TIMEFRAME);
      if (!lastBarTime) continue;

      const cacheKey = `${strategy.id}|${meta.symbol}`;
      let entry = _tradesCache.get(cacheKey);

      if (!entry || entry.lastBarTime !== lastBarTime) {
        const bars = getRecentBars(meta.symbol, TIMEFRAME, EDGE_BARS);
        if (bars.length < MIN_BARS) continue;
        let trades: SlimTrade[];
        try {
          const result = runBacktest({
            strategy,
            bars,
            symbol:      meta.symbol,
            timeframe:   TIMEFRAME,
            rawParams:   parsedParams,
            // Swing hold cap: edge stats must reflect the same constraint the
            // user trades under, or medianWinHoldBars and win rates lie.
            maxHoldBars: maxHoldBars(),
          });
          trades = result.trades.map((t) => ({
            pnl:         t.pnl,
            pnlPct:      t.pnlPct,
            holdingBars: t.holdingBars,
          }));
        } catch {
          continue; // skip symbol on engine error
        }
        entry = {
          lastBarTime,
          trades,
          testedFrom: bars[0].time,
          testedTo:   lastBarTime,
        };
        _tradesCache.set(cacheKey, entry);
        recomputed += 1;
      }

      if (!testedFrom || entry.testedFrom < testedFrom) testedFrom = entry.testedFrom;
      if (entry.testedTo > testedTo) testedTo = entry.testedTo;

      const base = aggregateEdge(entry.trades);
      rows.push({
        strategyId: strategy.id,
        scope:      symScope(meta.symbol),
        symbol:     meta.symbol,
        assetClass: meta.assetClass,
        ...base,
        testedFrom: entry.testedFrom,
        testedTo:   entry.testedTo,
        computedAt,
      });

      const pool = classPools.get(meta.assetClass) ?? [];
      pool.push(...entry.trades);
      classPools.set(meta.assetClass, pool);
      globalPool.push(...entry.trades);
    }

    for (const [assetClass, pool] of classPools) {
      rows.push({
        strategyId: strategy.id,
        scope:      classScope(assetClass),
        symbol:     null,
        assetClass,
        ...aggregateEdge(pool),
        testedFrom,
        testedTo,
        computedAt,
      });
    }
    rows.push({
      strategyId: strategy.id,
      scope:      GLOBAL_SCOPE,
      symbol:     null,
      assetClass: null,
      ...aggregateEdge(globalPool),
      testedFrom,
      testedTo,
      computedAt,
    });
  }

  upsertEdgeStats(rows);

  return {
    symbols:    universe.length,
    strategies: strategies.length,
    rows:       rows.length,
    recomputed,
    durationMs: Date.now() - started,
  };
}
