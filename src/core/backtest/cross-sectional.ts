/**
 * Cross-sectional momentum portfolio backtest.
 *
 * Parallel to (and independent of) the single-symbol engine in `engine.ts` -
 * that engine and the `Strategy` interface are strictly single-symbol,
 * single-position and cannot express "rank a whole universe, hold the top N."
 * This file adds that capability alongside, reusing the same fill-math
 * primitives (`fills.ts`) and metrics computation (`metrics.ts`) so results
 * are directly comparable to the single-symbol strategies.
 *
 * Signal calculation (momentum.ts) works on each symbol's own native bar
 * array - no calendar alignment needed there. A UNION CALENDAR (sorted
 * unique dates across the universe) is used only for: stepping rebalance
 * dates, building the daily portfolio equity curve, and assigning the
 * entryBar/exitBar indices computeMetrics() expects.
 *
 * Rebalance mechanics: signal evaluated at a calendar date's close, filled
 * at each symbol's own next bar strictly after that date (mirrors engine.ts's
 * next-open convention - no look-ahead). Incremental turnover: only symbols
 * leaving/entering the top-N are traded; the held/target intersection is left
 * alone. Momentum has ~70-80% monthly name persistence, so this avoids
 * round-tripping costs on names that would be immediately rebought - more
 * cost-realistic than a full close/reopen every rebalance.
 *
 * Long-only. Equal-weight across the current target set.
 *
 * NOTE on computeMetrics() output: exposurePct/exposureSharpe were written
 * for a single concurrent position (engine.ts). With N concurrent holdings,
 * exposurePct sums holdingBars across all of them and can read > 100%, and
 * "in-market bars" is nearly always "all bars" - these two fields are not
 * meaningful here. Treat sharpe (all-bar), cagr, and maxDrawdownPct - all
 * computed straight off the portfolio equity curve - as the headline numbers.
 *
 * SURVIVORSHIP BIAS: if the caller's universe is sourced from a present-day
 * constituent list (e.g. scripts/universe/sp500.json) applied retroactively,
 * delisted/failed names are structurally excluded and returns are inflated.
 * Passing `membership` (point-in-time index membership, see
 * core/data/pit-membership.ts) removes the SELECTION half of that bias: at
 * each rebalance only symbols that were actually index members on that date
 * are ranked. The PRICE half remains on free data - names that delisted
 * before today usually have no Yahoo history at all, so they still cannot
 * be held even with membership filtering. Callers must surface whichever
 * mode ran explicitly to the reader.
 */
import type { Bar } from '@/core/types';
import type { TradeRecord, EquityPoint, BacktestMetrics } from './engine';
import type { MembershipChange } from '@/core/data/pit-membership';
import { membershipAsOf } from '@/core/data/pit-membership';
import { computeMetrics } from './metrics';
import { entryFillPrice, exitFillPrice, realizedPnl, qtyForCash } from './fills';
import { momentumScore, indexAsOf } from './momentum';

export interface CrossSectionalConfig {
  /** symbol -> ascending daily bars, each symbol's own native index. */
  bars: Record<string, Bar[]>;
  /** Trading days between rebalances. Default 21 (~monthly). */
  rebalanceDays?: number;
  /** Momentum lookback window in bars. Default 252 (~12 months). */
  lookbackBars?: number;
  /** Bars excluded from the end of the lookback (reversal guard). Default 21 (~1 month). */
  skipBars?: number;
  /** Number of names to hold. Ignored if topPct is set. Default 20. */
  topN?: number;
  /** Fraction of the eligible set to hold (e.g. 0.1 = top 10%). Overrides topN. */
  topPct?: number;
  /** Per-fill commission in currency. Default 0. */
  commission?: number;
  /** Flat adverse slippage fraction per fill. Default 0.0005 (5bps). */
  slippagePct?: number;
  /** Starting equity. Default 10_000. */
  initialEquity?: number;
  /** Bars per year for Sharpe/CAGR annualisation. Default 252. */
  barsPerYear?: number;
  /** Minimum eligible names required to rebalance at all. Default 5. */
  minNamesToTrade?: number;
  /**
   * Force-close a held name if it has no fresh native bar within this many
   * calendar steps (delisting guard - a forward-filled frozen price cannot
   * fabricate P&L indefinitely). Default 5.
   */
  staleBars?: number;
  /** ISO date; rebalances/equity curve start here. Bars before are warmup-only. */
  activeFrom?: string;
  /** ISO date; rebalances/equity curve stop here (inclusive). */
  activeTo?: string;
  /**
   * Point-in-time index membership. When set, each rebalance only ranks
   * symbols that were members of the index on that rebalance date
   * (reconstructed by replaying `changes` backward from `currentMembers` -
   * see core/data/pit-membership.ts). Omit to rank the full bars universe
   * (survivorship-biased when that universe is a present-day snapshot).
   */
  membership?: {
    currentMembers: readonly string[];
    changes:        readonly MembershipChange[];
  };
}

export interface RebalanceLog {
  date:   string;
  held:   string[];
  scores: Record<string, number>;
}

export interface CrossSectionalResult {
  range:      { from: string; to: string };
  params: {
    rebalanceDays: number;
    lookbackBars:  number;
    skipBars:      number;
    topN:          number;
    commission:    number;
    slippagePct:   number;
  };
  trades:      TradeRecord[];
  equityCurve: EquityPoint[];
  metrics:     BacktestMetrics;
  rebalances:  RebalanceLog[];
}

interface Holding {
  symbol:     string;
  qty:        number;
  entryFill:  number;
  entryTime:  string;
  entryBar:   number; // union-calendar index
  staleSince: number; // count of consecutive calendar steps with no fresh native bar
}

/** Resolve topN from either topN or topPct against the eligible-set size. */
function resolveTopN(eligible: number, cfg: CrossSectionalConfig): number {
  if (cfg.topPct != null) return Math.max(1, Math.ceil(cfg.topPct * eligible));
  return cfg.topN ?? 20;
}

export function runCrossSectional(config: CrossSectionalConfig): CrossSectionalResult {
  const rebalanceDays  = config.rebalanceDays  ?? 21;
  const lookbackBars   = config.lookbackBars   ?? 252;
  const skipBars       = config.skipBars       ?? 21;
  const commission     = config.commission     ?? 0;
  const slippagePct    = config.slippagePct    ?? 0.0005;
  const initialEquity  = config.initialEquity  ?? 10_000;
  const barsPerYear    = config.barsPerYear    ?? 252;
  const minNamesToTrade = config.minNamesToTrade ?? 5;
  const staleBarsLimit  = config.staleBars       ?? 5;

  const symbols = Object.keys(config.bars).filter((s) => config.bars[s].length > 0);

  // ---------------------------------------------------------------------
  // 1. Union calendar
  // ---------------------------------------------------------------------
  const dateSet = new Set<string>();
  for (const sym of symbols) {
    for (const b of config.bars[sym]) dateSet.add(b.time);
  }
  const allDates = Array.from(dateSet).sort();

  const activeFromIdx = config.activeFrom
    ? allDates.findIndex((d) => d >= config.activeFrom!)
    : 0;
  const activeToIdxRaw = config.activeTo
    ? (() => {
        let last = -1;
        for (let i = 0; i < allDates.length; i++) if (allDates[i] <= config.activeTo!) last = i;
        return last;
      })()
    : allDates.length - 1;

  if (activeFromIdx < 0 || activeToIdxRaw < activeFromIdx || allDates.length === 0) {
    // Nothing to run in this window - return an empty, well-formed result.
    const emptyMetrics = computeMetrics([], [], 0, initialEquity, barsPerYear);
    return {
      range: { from: config.activeFrom ?? '', to: config.activeTo ?? '' },
      params: { rebalanceDays, lookbackBars, skipBars, topN: config.topN ?? 20, commission, slippagePct },
      trades: [],
      equityCurve: [],
      metrics: emptyMetrics,
      rebalances: [],
    };
  }

  const masterDates = allDates.slice(activeFromIdx, activeToIdxRaw + 1);

  // ---------------------------------------------------------------------
  // 2. Forward-filled close per symbol, aligned to masterDates, for O(1) MTM.
  // ---------------------------------------------------------------------
  const alignedClose: Record<string, number[]> = {};
  for (const sym of symbols) {
    const bars = config.bars[sym];
    const arr  = new Array<number>(masterDates.length).fill(NaN);
    let bi = 0;
    let lastClose = NaN;
    for (let k = 0; k < masterDates.length; k++) {
      const d = masterDates[k];
      while (bi < bars.length && bars[bi].time <= d) {
        lastClose = bars[bi].close;
        bi++;
      }
      arr[k] = lastClose;
    }
    alignedClose[sym] = arr;
  }

  // ---------------------------------------------------------------------
  // 3. Rebalance dates: step every rebalanceDays once minNamesToTrade names
  //    have enough native history.
  // ---------------------------------------------------------------------

  // Point-in-time membership check, memoized per date (the replay walks the
  // whole change ledger each call). No membership config = everyone passes.
  const membershipCache = new Map<string, Set<string>>();
  function isMemberOn(sym: string, date: string): boolean {
    if (!config.membership) return true;
    let members = membershipCache.get(date);
    if (!members) {
      members = membershipAsOf(config.membership.currentMembers, config.membership.changes, date);
      membershipCache.set(date, members);
    }
    return members.has(sym);
  }

  function eligibleCountAt(masterIdx: number): number {
    const d = masterDates[masterIdx];
    let n = 0;
    for (const sym of symbols) {
      if (!isMemberOn(sym, d)) continue;
      const nativeIdx = indexAsOf(config.bars[sym], d);
      if (nativeIdx >= 0 && Number.isFinite(momentumScore(config.bars[sym], nativeIdx, lookbackBars, skipBars))) {
        n++;
      }
    }
    return n;
  }

  let firstRebalanceIdx = -1;
  for (let k = 0; k < masterDates.length; k++) {
    if (eligibleCountAt(k) >= minNamesToTrade) { firstRebalanceIdx = k; break; }
  }

  const rebalanceIndices: number[] = [];
  if (firstRebalanceIdx >= 0) {
    for (let k = firstRebalanceIdx; k < masterDates.length; k += rebalanceDays) {
      rebalanceIndices.push(k);
    }
  }

  // ---------------------------------------------------------------------
  // 4-6. Walk the calendar: rebalance on scheduled dates, mark-to-market daily.
  // ---------------------------------------------------------------------
  const trades: TradeRecord[] = [];
  const equityCurve: EquityPoint[] = [];
  const rebalanceLog: RebalanceLog[] = [];
  const held = new Map<string, Holding>();
  let cash = initialEquity;
  let tradeSeq = 0;

  /** Find each symbol's own next native bar strictly after masterDates[signalIdx]. */
  function nextNativeFill(sym: string, signalIdx: number): { price: number; time: string } | null {
    const signalDate = masterDates[signalIdx];
    const bars = config.bars[sym];
    const asOf = indexAsOf(bars, signalDate);
    const fillIdx = asOf + 1; // first bar strictly after the signal date
    if (fillIdx < 0 || fillIdx >= bars.length) return null;
    return { price: bars[fillIdx].open, time: bars[fillIdx].time };
  }

  function closeHolding(h: Holding, exitFill: number, exitTime: string, exitBar: number, reason: TradeRecord['exitReason']): void {
    cash += exitFill * h.qty - commission;
    const { pnl, costs } = realizedPnl('long', h.entryFill, exitFill, h.qty, commission);
    trades.push({
      id:         `xs-${tradeSeq++}`,
      symbol:     h.symbol,
      side:       'long',
      entryTime:  h.entryTime,
      entryBar:   h.entryBar,
      entryPrice: h.entryFill,
      exitTime,
      exitBar,
      exitPrice:  exitFill,
      qty:        h.qty,
      pnl,
      pnlPct:     (pnl / (h.entryFill * h.qty)) * 100,
      costs,
      holdingBars: exitBar - h.entryBar,
      exitReason: reason,
      entryReason: 'cross-sectional-momentum rebalance',
    });
    held.delete(h.symbol);
  }

  let rebalancePtr = 0;
  for (let k = 0; k < masterDates.length; k++) {
    // --- Stale-holding guard: force-close names with no fresh native bar ---
    for (const h of Array.from(held.values())) {
      const price = alignedClose[h.symbol][k];
      const bars  = config.bars[h.symbol];
      const nativeIdx = indexAsOf(bars, masterDates[k]);
      const isFreshToday = nativeIdx >= 0 && bars[nativeIdx].time === masterDates[k];
      h.staleSince = isFreshToday ? 0 : h.staleSince + 1;
      if (h.staleSince >= staleBarsLimit && Number.isFinite(price)) {
        closeHolding(h, price, masterDates[k], k, 'end-of-series');
      }
    }

    // --- Rebalance ---
    if (rebalancePtr < rebalanceIndices.length && rebalanceIndices[rebalancePtr] === k) {
      rebalancePtr++;
      const d = masterDates[k];

      const scored: { symbol: string; score: number }[] = [];
      for (const sym of symbols) {
        if (!isMemberOn(sym, d)) continue; // not in the index on this date - PIT filter
        const nativeIdx = indexAsOf(config.bars[sym], d);
        if (nativeIdx < 0) continue;
        const score = momentumScore(config.bars[sym], nativeIdx, lookbackBars, skipBars);
        if (Number.isFinite(score)) scored.push({ symbol: sym, score });
      }

      if (scored.length >= minNamesToTrade) {
        scored.sort((a, b) => b.score - a.score);
        const n = resolveTopN(scored.length, config);
        const targetSet = new Set(scored.slice(0, n).map((s) => s.symbol));
        const heldSet = new Set(held.keys());

        const toClose = Array.from(heldSet).filter((s) => !targetSet.has(s));
        const toOpen  = Array.from(targetSet).filter((s) => !heldSet.has(s));

        // Close names falling out of the target set first, freeing cash.
        for (const sym of toClose) {
          const fill = nextNativeFill(sym, k);
          const h = held.get(sym)!;
          if (!fill) {
            // No more native bars at all (delisted right at rebalance) - close
            // at the last known aligned close instead.
            const price = alignedClose[sym][k];
            if (Number.isFinite(price)) closeHolding(h, price, d, k, 'end-of-series');
            continue;
          }
          const exitFillPx = exitFillPrice('long', fill.price, slippagePct);
          const fillBar = k; // approximate on the union calendar; exact date kept in exitTime
          closeHolding(h, exitFillPx, fill.time, fillBar, 'signal');
        }

        // Snapshot portfolio equity after closes, before opening new names.
        // Aspirational per-name target is equity/N (equal weight across the
        // full target set), but the intersection (still-held names, left
        // untouched) already carries its own share of that equity - only
        // `cash` on hand is actually spendable on toOpen names. Clamping
        // spend to available cash (never negative) is what prevents this
        // from turning into implicit, unmodeled leverage: without the clamp,
        // perNameCash * toOpen.length can exceed cash whenever the
        // intersection has grown large, silently buying on margin.
        let equityNow = cash;
        for (const h of held.values()) {
          const price = alignedClose[h.symbol][k];
          if (Number.isFinite(price)) equityNow += price * h.qty;
        }
        const aspirationalPerName = targetSet.size > 0 ? equityNow / targetSet.size : 0;
        const perNameCash = toOpen.length > 0
          ? Math.min(aspirationalPerName, Math.max(0, cash) / toOpen.length)
          : 0;

        for (const sym of toOpen) {
          const fill = nextNativeFill(sym, k);
          if (!fill) continue; // no tradable bar left - skip this rebalance for this name
          const entryFillPx = entryFillPrice('long', fill.price, slippagePct);
          const qty = qtyForCash(perNameCash, 1, entryFillPx);
          if (qty <= 0) continue;
          const cost = entryFillPx * qty + commission;
          if (cost > cash) continue; // hard guard: never let a fill push cash negative
          cash -= cost;
          held.set(sym, {
            symbol: sym, qty, entryFill: entryFillPx, entryTime: fill.time,
            entryBar: k, staleSince: 0,
          });
        }

        rebalanceLog.push({
          date: d,
          held: Array.from(held.keys()),
          scores: Object.fromEntries(scored.map((s) => [s.symbol, s.score])),
        });
      }
    }

    // --- Daily mark-to-market ---
    let equity = cash;
    for (const h of held.values()) {
      const price = alignedClose[h.symbol][k];
      if (Number.isFinite(price)) equity += price * h.qty;
    }
    equityCurve.push({ time: masterDates[k], equity });
  }

  // ---------------------------------------------------------------------
  // 7. End-of-series: close everything at the final date's close.
  // ---------------------------------------------------------------------
  if (held.size > 0 && masterDates.length > 0) {
    const lastIdx = masterDates.length - 1;
    for (const h of Array.from(held.values())) {
      const price = alignedClose[h.symbol][lastIdx];
      if (Number.isFinite(price)) {
        closeHolding(h, price, masterDates[lastIdx], lastIdx, 'end-of-series');
      }
    }
    equityCurve[lastIdx] = { time: masterDates[lastIdx], equity: cash };
  }

  const metrics = computeMetrics(trades, equityCurve, masterDates.length, initialEquity, barsPerYear);

  return {
    range: {
      from: masterDates.length > 0 ? masterDates[0] : '',
      to:   masterDates.length > 0 ? masterDates[masterDates.length - 1] : '',
    },
    params: {
      rebalanceDays, lookbackBars, skipBars,
      topN: config.topPct != null ? resolveTopN(symbols.length, config) : (config.topN ?? 20),
      commission, slippagePct,
    },
    trades,
    equityCurve,
    metrics,
    rebalances: rebalanceLog,
  };
}
