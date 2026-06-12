import 'server-only';
import type { AssetClass } from '@/core/types';
import { getEdgeStats } from '@/core/db/edge';
import { symScope, classScope, GLOBAL_SCOPE, type EdgeStats } from './types';
import { edgeScore, type EdgeTier } from './score';

/**
 * Compact edge summary attached to API responses for inline display.
 * scopeUsed tells the UI which level the stats came from so it can label
 * "(class)" or "(global)" when per-symbol data was too thin.
 */
export interface EdgeSummary {
  scopeUsed:    'sym' | 'class' | 'global';
  winRate:      number;
  avgWinPct:    number;
  avgLossPct:   number;
  profitFactor: number;
  numTrades:    number;
  testedFrom:   string;
  testedTo:     string;
  tier:         EdgeTier;
  score:        number;
}

/** Minimum sym-scope trades before per-symbol stats are preferred for display. */
const MIN_SYM_TRADES = 5;

/**
 * In-memory index over the strategy_edge table, built once per request.
 * One SELECT loads all rows (~3 per strategy x symbol universe); lookups are
 * then O(1) per signal/idea.
 */
export class EdgeIndex {
  private readonly map: Map<string, EdgeStats>;

  private constructor(rows: EdgeStats[]) {
    this.map = new Map(rows.map((r) => [`${r.strategyId}|${r.scope}`, r]));
  }

  static load(): EdgeIndex {
    return new EdgeIndex(getEdgeStats());
  }

  get(strategyId: string, scope: string): EdgeStats | null {
    return this.map.get(`${strategyId}|${scope}`) ?? null;
  }

  /**
   * Resolve display stats for (strategy, symbol): sym scope if it has enough
   * trades, else class scope, else global, else null.
   */
  resolve(
    strategyId: string,
    symbol: string,
    assetClass: AssetClass | null,
  ): EdgeSummary | null {
    const sym = this.get(strategyId, symScope(symbol));
    if (sym && sym.numTrades >= MIN_SYM_TRADES) return toSummary(sym, 'sym');

    if (assetClass) {
      const cls = this.get(strategyId, classScope(assetClass));
      if (cls && cls.numTrades > 0) return toSummary(cls, 'class');
    }

    const glob = this.get(strategyId, GLOBAL_SCOPE);
    if (glob && glob.numTrades > 0) return toSummary(glob, 'global');

    return null;
  }
}

function toSummary(e: EdgeStats, scopeUsed: EdgeSummary['scopeUsed']): EdgeSummary {
  const { score, tier } = edgeScore(e);
  return {
    scopeUsed,
    winRate:      e.winRate,
    avgWinPct:    e.avgWinPct,
    avgLossPct:   e.avgLossPct,
    profitFactor: e.profitFactor,
    numTrades:    e.numTrades,
    testedFrom:   e.testedFrom,
    testedTo:     e.testedTo,
    tier,
    score,
  };
}
