/**
 * Backtest engine.
 *
 * Correctness rules (enforced structurally, not by convention):
 *
 * 1. No look-ahead bias:
 *    Each bar's strategy.onBar() receives a frozen slice bars[0..i].
 *    The slice is created in makeContext() - bars[i+1] is structurally inaccessible.
 *
 * 2. Realistic fills:
 *    Signals fire on bar i close. Fills execute at bar i+1 open (default).
 *    slippagePct is applied adverse to fill direction for all market fills.
 *    commission is charged per fill (entry + exit = 2 * commission per trade).
 *
 * 3. Intrabar stop/target (conservative):
 *    Checked against the bar's high and low AFTER any pending fills are processed.
 *    If BOTH stop AND target are hit in the same bar, stop fills first (worst outcome
 *    for the held side). This is the conservative choice documented here explicitly.
 *
 * 4. Final-bar guard:
 *    A signal on the last bar (i = n-1) is ignored - there is no next bar to fill on.
 *    Open positions at end-of-series are closed at the final bar's close (no slippage
 *    on forced liquidation, commission still applied).
 */

import type { Bar, Timeframe } from '@/core/types';
import type { Strategy } from '../strategy/Strategy';
import { makeContext, type IndicatorCache } from '../strategy/context';
import { computeMetrics } from './metrics';
import {
  entryFillPrice,
  exitFillPrice,
  stopTargetPrices,
  realizedPnl,
  markToMarket,
  qtyForCash,
} from './fills';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TradeRecord {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryTime: string;
  entryBar: number;
  entryPrice: number;    // actual fill price (slippage applied for market fills)
  exitTime: string;
  exitBar: number;
  exitPrice: number;     // actual fill price
  qty: number;           // fractional units (equity * sizePct / entryPrice)
  pnl: number;           // net P&L in currency (after commission; slippage in prices)
  pnlPct: number;        // pnl / (entryPrice * qty) * 100
  costs: number;         // 2 * commission (explicit costs; slippage implicit in prices)
  holdingBars: number;   // exitBar - entryBar
  exitReason: 'stop' | 'target' | 'signal' | 'time' | 'end-of-series';
  entryReason: string;
}

export interface EquityPoint {
  time: string;
  equity: number;  // mark-to-market portfolio value at bar close
}

export interface BacktestMetrics {
  totalReturnPct: number;
  cagr: number;
  winRate: number;          // 0..1
  avgWinPct: number;
  avgLossPct: number;
  profitFactor: number;     // gross wins / gross losses; Infinity if no losses
  maxDrawdownPct: number;   // positive % (e.g. 15 = 15% drawdown)
  sharpe: number;           // annualised, rf=0
  exposurePct: number;      // % of bars in a position
  numTrades: number;
  avgHoldingBars: number;
}

export interface BacktestResult {
  symbol: string;
  range: { from: string; to: string };
  params: unknown;
  trades: TradeRecord[];
  equityCurve: EquityPoint[];
  metrics: BacktestMetrics;
}

export interface BacktestConfig {
  strategy: Strategy;
  bars: readonly Bar[];
  symbol?: string;
  rawParams?: unknown;
  /** Default 'next_open': signals fire on close, fill at next bar's open. */
  fillOn?: 'next_open' | 'close';
  /** Commission per fill in currency. Default 0. */
  commission?: number;
  /** Adverse slippage fraction per market fill. Default 0.0005 (0.05%). */
  slippagePct?: number;
  /** Starting equity. Default 10_000. */
  initialEquity?: number;
  /** Bars per year for Sharpe/CAGR annualisation. Default 252 (daily). */
  barsPerYear?: number;
  /**
   * Force-exit any position held this many bars (fills at the next bar's
   * open, exitReason 'time'). Combined with a strategy decision's own
   * maxHoldBars via min(). Default: none.
   */
  maxHoldBars?: number;
  timeframe?: Timeframe;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface OpenTrade {
  side: 'long' | 'short';
  entryTime: string;
  entryBar: number;
  entryFillPrice: number;
  qty: number;
  stopPrice?: number;
  targetPrice?: number;
  maxHoldBars?: number;
  entryReason: string;
}

interface PendingEntry {
  side: 'long' | 'short';
  sizePct: number;
  stopPct?: number;
  targetPct?: number;
  maxHoldBars?: number;
  reason: string;
}

interface PendingExit {
  kind: 'signal' | 'time';
  reason: string;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function runBacktest(config: BacktestConfig): BacktestResult {
  const {
    strategy,
    bars,
    symbol       = '',
    rawParams    = {},
    fillOn       = 'next_open',
    commission   = 0,
    slippagePct  = 0.0005,
    initialEquity = 10_000,
    barsPerYear  = 252,
    maxHoldBars,
  } = config;

  const n = bars.length;

  // Need at least 2 bars to fill any trade (signal on i=0, fill on i=1)
  if (n < 2) {
    return emptyResult(symbol, bars, rawParams);
  }

  // Parse params once before the hot loop
  const parsedParams: unknown = strategy.params.parse(rawParams);

  const cache: IndicatorCache = new Map();
  const trades: TradeRecord[] = [];
  const equityCurve: EquityPoint[] = [];

  let position: 'long' | 'short' | 'flat' = 'flat';
  let cash = initialEquity;
  let openTrade: OpenTrade | null = null;
  let pendingEntry: PendingEntry | null = null;
  let pendingExit: PendingExit | null = null;
  let tradeIdCounter = 0;

  // -------------------------------------------------------------------------
  // Fill helpers
  // -------------------------------------------------------------------------

  function applyLongEntry(bar: Bar, pending: PendingEntry, barIndex: number): void {
    const rawOpen = fillOn === 'next_open' ? bar.open : bar.close;
    const fillPrice = entryFillPrice('long', rawOpen, slippagePct);
    const qty = qtyForCash(cash, pending.sizePct, fillPrice);

    cash -= fillPrice * qty + commission;

    const { stopPrice, targetPrice } = stopTargetPrices(
      'long', fillPrice, pending.stopPct, pending.targetPct,
    );

    openTrade = {
      side: 'long',
      entryTime: bar.time,
      entryBar: barIndex,
      entryFillPrice: fillPrice,
      qty,
      stopPrice,
      targetPrice,
      maxHoldBars: pending.maxHoldBars,
      entryReason: pending.reason,
    };
    position = 'long';
  }

  function applyShortEntry(bar: Bar, pending: PendingEntry, barIndex: number): void {
    const rawOpen = fillOn === 'next_open' ? bar.open : bar.close;
    const fillPrice = entryFillPrice('short', rawOpen, slippagePct);
    const qty = qtyForCash(cash, pending.sizePct, fillPrice);

    // Short sale: receive proceeds, pay commission
    cash += fillPrice * qty - commission;

    const { stopPrice, targetPrice } = stopTargetPrices(
      'short', fillPrice, pending.stopPct, pending.targetPct,
    );

    openTrade = {
      side: 'short',
      entryTime: bar.time,
      entryBar: barIndex,
      entryFillPrice: fillPrice,
      qty,
      stopPrice,
      targetPrice,
      maxHoldBars: pending.maxHoldBars,
      entryReason: pending.reason,
    };
    position = 'short';
  }

  function closeLong(
    fillPrice: number,
    exitBar: number,
    exitTime: string,
    exitReason: TradeRecord['exitReason'],
    exitReasonLabel?: string,
  ): void {
    if (!openTrade || openTrade.side !== 'long') return;
    const { entryFillPrice: entryFill, qty, entryTime, entryBar, entryReason } = openTrade;

    cash += fillPrice * qty - commission;
    const { pnl, costs } = realizedPnl('long', entryFill, fillPrice, qty, commission);

    trades.push({
      id:          `trade-${++tradeIdCounter}`,
      symbol,
      side:        'long',
      entryTime,
      entryBar,
      entryPrice:  entryFill,
      exitTime,
      exitBar,
      exitPrice:   fillPrice,
      qty,
      pnl,
      pnlPct:      (pnl / (entryFill * qty)) * 100,
      costs,
      holdingBars: exitBar - entryBar,
      exitReason,
      entryReason: exitReasonLabel ?? entryReason,
    });

    openTrade = null;
    position  = 'flat';
  }

  function closeShort(
    fillPrice: number,
    exitBar: number,
    exitTime: string,
    exitReason: TradeRecord['exitReason'],
    exitReasonLabel?: string,
  ): void {
    if (!openTrade || openTrade.side !== 'short') return;
    const { entryFillPrice: entryFill, qty, entryTime, entryBar, entryReason } = openTrade;

    cash -= fillPrice * qty + commission;
    const { pnl, costs } = realizedPnl('short', entryFill, fillPrice, qty, commission);

    trades.push({
      id:          `trade-${++tradeIdCounter}`,
      symbol,
      side:        'short',
      entryTime,
      entryBar,
      entryPrice:  entryFill,
      exitTime,
      exitBar,
      exitPrice:   fillPrice,
      qty,
      pnl,
      pnlPct:      (pnl / (entryFill * qty)) * 100,
      costs,
      holdingBars: exitBar - entryBar,
      exitReason,
      entryReason: exitReasonLabel ?? entryReason,
    });

    openTrade = null;
    position  = 'flat';
  }

  // -------------------------------------------------------------------------
  // Main loop: iterate bars front-to-back
  // -------------------------------------------------------------------------

  for (let i = 0; i < n; i++) {
    const bar = bars[i];

    // A. Fill pending entry (from previous bar's signal)
    if (pendingEntry && position === 'flat') {
      if (pendingEntry.side === 'long') {
        applyLongEntry(bar, pendingEntry, i);
      } else {
        applyShortEntry(bar, pendingEntry, i);
      }
      pendingEntry = null;
    }

    // B. Fill pending exit (from previous bar's signal, before intrabar stop/target)
    if (pendingExit !== null && openTrade !== null) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const trade = openTrade as OpenTrade; // cast: closures prevent TS narrowing here
      const exit  = pendingExit as PendingExit;
      const rawOpen = fillOn === 'next_open' ? bar.open : bar.close;
      const exitReason = exit.kind === 'time' ? 'time' : 'signal';
      if (trade.side === 'long') {
        closeLong(exitFillPrice('long', rawOpen, slippagePct), i, bar.time, exitReason, exit.reason);
      } else {
        closeShort(exitFillPrice('short', rawOpen, slippagePct), i, bar.time, exitReason, exit.reason);
      }
      pendingExit = null;
    }

    // C. Intrabar stop/target check
    // Conservative rule: if BOTH stop and target are hit in the same bar, stop fills
    // first (worst outcome for the held side). This prevents over-reporting wins.
    if (openTrade !== null) {
      const { side, stopPrice, targetPrice } = openTrade;

      if (side === 'long') {
        const stopHit   = stopPrice   != null && bar.low  <= stopPrice;
        const targetHit = targetPrice != null && bar.high >= targetPrice;

        if (stopHit || targetHit) {
          // Conservative: if both, assume stop fills first
          if (stopHit) {
            closeLong(stopPrice!, i, bar.time, 'stop');
          } else {
            closeLong(targetPrice!, i, bar.time, 'target');
          }
        }
      } else {
        const stopHit   = stopPrice   != null && bar.high >= stopPrice;
        const targetHit = targetPrice != null && bar.low  <= targetPrice;

        if (stopHit || targetHit) {
          if (stopHit) {
            closeShort(stopPrice!, i, bar.time, 'stop');
          } else {
            closeShort(targetPrice!, i, bar.time, 'target');
          }
        }
      }
    }

    // C2. Time stop: position has reached its max hold - queue a forced exit
    // that fills at the NEXT bar's open (same mechanics as a signal exit).
    // Runs after the intrabar stop/target check so a stop or target hit on
    // this same bar keeps precedence (conservative invariant).
    // Uses only i - entryBar: no look-ahead surface.
    if (openTrade !== null && pendingExit === null) {
      const trade = openTrade as OpenTrade; // cast: closures prevent TS narrowing here
      // Queue one bar early: the exit fills at the NEXT bar's open, so the
      // realized holdingBars (exitBar - entryBar) lands exactly at the cap.
      if (trade.maxHoldBars != null && i - trade.entryBar >= trade.maxHoldBars - 1) {
        pendingExit = {
          kind:   'time',
          reason: `max hold ${trade.maxHoldBars} bars reached`,
        };
      }
    }

    // D. Mark-to-market equity at bar close
    let equityNow: number;
    if (openTrade) {
      const { side, qty } = openTrade; // destructure immediately - TS closure narrowing
      equityNow = markToMarket(side, cash, qty, bar.close);
    } else {
      equityNow = cash;
    }
    equityCurve.push({ time: bar.time, equity: equityNow });

    // E. Build causal context (position reflects state AFTER all fills above)
    const ctx = makeContext(bars, i, position, cache);

    // F. Call strategy
    const decision = strategy.onBar(ctx, parsedParams);

    // G. Queue pending fills for next bar
    // Final-bar guard: if i === n-1 there is no next bar to fill on; ignore entry signals.
    if (i < n - 1) {
      if (
        (decision.action === 'enter_long' || decision.action === 'enter_short') &&
        position === 'flat'
      ) {
        // Effective hold cap = the tighter of strategy decision and engine config
        const capCandidates = [decision.maxHoldBars, maxHoldBars]
          .filter((v): v is number => v != null && v > 0);
        pendingEntry = {
          side:      decision.action === 'enter_long' ? 'long' : 'short',
          sizePct:   decision.sizePct   ?? 1,
          stopPct:   decision.stopPct,
          targetPct: decision.targetPct,
          maxHoldBars: capCandidates.length > 0 ? Math.min(...capCandidates) : undefined,
          reason:    decision.reason ?? '',
        };
      }
    }

    if (decision.action === 'exit' && position !== 'flat') {
      // A strategy exit overrides a queued time exit - same fill, clearer reason
      pendingExit = { kind: 'signal', reason: decision.reason ?? '' };
    }
  }

  // -------------------------------------------------------------------------
  // End-of-series: close any open position at final bar's close
  // Conservative choice: no slippage on forced liquidation (it's hypothetical),
  // but commission still applied. Documented explicitly.
  // -------------------------------------------------------------------------
  if (openTrade !== null) {
    const lastBar   = bars[n - 1];
    const fillPrice = lastBar.close;
    const trade     = openTrade as OpenTrade; // cast: closures prevent TS narrowing here

    if (trade.side === 'long') {
      closeLong(fillPrice, n - 1, lastBar.time, 'end-of-series');
    } else {
      closeShort(fillPrice, n - 1, lastBar.time, 'end-of-series');
    }

    // Update final equity curve point to reflect closed position
    equityCurve[n - 1] = { time: lastBar.time, equity: cash };
  }

  // -------------------------------------------------------------------------
  // Compute metrics and return
  // -------------------------------------------------------------------------
  const metrics = computeMetrics(
    trades,
    equityCurve,
    n,
    initialEquity,
    barsPerYear,
  );

  return {
    symbol,
    range: { from: bars[0].time, to: bars[n - 1].time },
    params: parsedParams,
    trades,
    equityCurve,
    metrics,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyResult(
  symbol: string,
  bars: readonly Bar[],
  params: unknown,
): BacktestResult {
  return {
    symbol,
    range: {
      from: bars[0]?.time ?? '',
      to:   bars[bars.length - 1]?.time ?? '',
    },
    params,
    trades:       [],
    equityCurve:  [],
    metrics: {
      totalReturnPct: 0,
      cagr:           0,
      winRate:        0,
      avgWinPct:      0,
      avgLossPct:     0,
      profitFactor:   0,
      maxDrawdownPct: 0,
      sharpe:         0,
      exposurePct:    0,
      numTrades:      0,
      avgHoldingBars: 0,
    },
  };
}
