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
import { buildRegimeMap, lookupRegime } from '../market/regime';
import {
  entryFillPrice,
  exitFillPrice,
  stopTargetPrices,
  realizedPnl,
  markToMarket,
  qtyForCash,
  type SlippageFn,
} from './fills';
import { compute as computeIndicator } from '../indicators/registry';

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
  sharpe: number;           // annualised, rf=0, computed over ALL bars (incl. flat)
  /**
   * Sharpe computed over in-market bars only (bars where a position was open).
   * Avoids the flat-bar bias that inflates Sharpe for part-time strategies by
   * including zero-return days in the std denominator.
   * NaN when exposure is zero (no trades held for at least 2 bars).
   */
  exposureSharpe: number;
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
  /** Flat adverse slippage fraction per market fill. Default 0.0005 (0.05%). Ignored when slippageFn is set. */
  slippagePct?: number;
  /**
   * Optional volatility-scaled slippage function. Overrides slippagePct when provided.
   * Receives the fill bar and ATR% (ATR/close). Use fills.atrScaledSlippage() or custom.
   */
  slippageFn?: SlippageFn;
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
  /**
   * Index bar series keyed by symbol (e.g. { '^GSPC': [...] }).
   * Required to backtest a strategy that declares a regime requirement.
   * When provided, entry signals are suppressed on bars where the regime
   * precondition is not met - the same gate applied by the live scanner.
   * Omitting this map disables regime filtering in the backtest.
   */
  regimeBars?: Record<string, readonly Bar[]>;

  /**
   * Engine-level improvement overrides. When set, these take precedence over
   * the same fields in StrategyDecision, so they can be applied globally
   * without touching individual strategy implementations.
   */

  // Imp 1: trailing stop
  /** Arm trailing stop once trade is up this fraction (e.g. 0.03 = 3%). */
  trailingStopActivationPct?: number;
  /** Trail stop this fraction below running peak (e.g. 0.015 = 1.5%). */
  trailingStopDistancePct?: number;

  // Imp 2: gap filter
  /** Skip long entry if next-bar open gaps up more than this vs signal close. */
  maxEntrySlippagePct?: number;
  /** Widen stop if next-bar open gaps down more than this vs signal close. */
  gapDownWidenPct?: number;

  // Imp 3: dynamic sizing
  /**
   * Enable signal-strength-based dynamic sizing. Requires strategy.signalStrength().
   * When true, position size scales 0.5x..2x around base sizePct.
   */
  dynamicSizing?: boolean;

  // Imp 5: partial exit
  /** Fraction of qty to close at partial target (e.g. 0.5 = half). */
  partialExitFraction?: number;
  /** Fraction of target distance to trigger partial exit (e.g. 0.5 = halfway). */
  partialExitAtTargetPct?: number;
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
  // Imp 1: trailing stop state
  trailActivationPct?: number;  // arm when unrealized gain >= this fraction
  trailDistancePct?: number;    // trail stop this fraction below running peak
  trailActive: boolean;         // whether trailing stop has been armed
  peakPrice: number;            // running peak (high for long, low for short)
  // Imp 5: partial exit state
  partialExitFraction?: number;    // fraction of qty to close at partial target
  partialExitAtTargetPct?: number; // fraction of target distance to trigger partial
  partialTaken: boolean;           // whether partial exit has fired
  originalQty: number;             // qty at entry (before any partial exit)
}

interface PendingEntry {
  side: 'long' | 'short';
  sizePct: number;
  stopPct?: number;
  targetPct?: number;
  maxHoldBars?: number;
  reason: string;
  signalClose: number;           // Imp 2: close price at signal bar for gap detection
  // Imp 1
  trailingStopActivationPct?: number;
  trailingStopDistancePct?: number;
  // Imp 2
  maxEntrySlippagePct?: number;
  gapDownWidenPct?: number;
  // Imp 5
  partialExitFraction?: number;
  partialExitAtTargetPct?: number;
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
    regimeBars,
    slippageFn,
    // Improvement config-level overrides
    trailingStopActivationPct: cfgTrailAct,
    trailingStopDistancePct:   cfgTrailDist,
    maxEntrySlippagePct:       cfgMaxSlip,
    gapDownWidenPct:           cfgGapDn,
    dynamicSizing:             cfgDynSize = false,
    partialExitFraction:       cfgPartialFrac,
    partialExitAtTargetPct:    cfgPartialAt,
  } = config;

  // Pre-compute ATR% for each bar when a slippageFn is provided (O(n) once).
  // atrPctArr[i] = ATR(14)[i] / bars[i].close, or 0 when NaN (warm-up).
  const atrPctArr: number[] | null = slippageFn
    ? (() => {
        const atr = computeIndicator('atr', bars as Bar[], { period: 14 }) as number[];
        return atr.map((v, i) => {
          const close = bars[i].close;
          return Number.isFinite(v) && close > 0 ? v / close : 0;
        });
      })()
    : null;

  /** Resolve the effective slippage fraction at bar i */
  function slippageAt(i: number): number {
    if (slippageFn && atrPctArr) return slippageFn(bars[i] as Bar, atrPctArr[i]);
    return slippagePct;
  }

  const n = bars.length;

  // Need at least 2 bars to fill any trade (signal on i=0, fill on i=1)
  if (n < 2) {
    return emptyResult(symbol, bars, rawParams);
  }

  // Parse params once before the hot loop
  const parsedParams: unknown = strategy.params.parse(rawParams);

  // Pre-compute regime map (O(n)) when the strategy declares a precondition
  // and the caller supplied index bars. Regime is checked at entry time only.
  let regimeMap: Map<string, boolean> | null = null;
  let regimeSortedDates: string[] | null = null;
  if (strategy.regime && regimeBars) {
    const req = strategy.regime;
    const idxBars = regimeBars[req.index];
    if (idxBars && idxBars.length > 0) {
      regimeMap = buildRegimeMap(req, idxBars);
      regimeSortedDates = Array.from(regimeMap.keys()).sort();
    }
  }

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

    // Imp 2a: gap-up filter - skip long entry when overnight gap exceeds threshold
    if (pending.signalClose > 0 && pending.maxEntrySlippagePct != null) {
      const gapUp = (rawOpen - pending.signalClose) / pending.signalClose;
      if (gapUp > pending.maxEntrySlippagePct) {
        // Trade skipped; pendingEntry was cleared by the caller before this call
        return;
      }
    }

    const fillPrice = entryFillPrice('long', rawOpen, slippageAt(barIndex));
    const qty = qtyForCash(cash, pending.sizePct, fillPrice);

    cash -= fillPrice * qty + commission;

    let { stopPrice, targetPrice } = stopTargetPrices(
      'long', fillPrice, pending.stopPct, pending.targetPct,
    );

    // Imp 2b: gap-down stop widening - if price gapped below signal close, re-base
    // the stop from the fill price so the gap itself does not trigger an immediate stop-out.
    if (
      pending.signalClose > 0 &&
      pending.gapDownWidenPct != null &&
      stopPrice != null &&
      pending.stopPct != null
    ) {
      const gapDown = (pending.signalClose - rawOpen) / pending.signalClose;
      if (gapDown > pending.gapDownWidenPct) {
        // Recompute stop from fill price (already gapped down) - same stopPct distance
        stopPrice = fillPrice * (1 - pending.stopPct);
      }
    }

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
      // Imp 1
      trailActivationPct: pending.trailingStopActivationPct,
      trailDistancePct:   pending.trailingStopDistancePct,
      trailActive: false,
      peakPrice: bar.open,   // initialise to fill bar open; updated each bar
      // Imp 5
      partialExitFraction:    pending.partialExitFraction,
      partialExitAtTargetPct: pending.partialExitAtTargetPct,
      partialTaken: false,
      originalQty: qty,
    };
    position = 'long';
  }

  function applyShortEntry(bar: Bar, pending: PendingEntry, barIndex: number): void {
    const rawOpen = fillOn === 'next_open' ? bar.open : bar.close;

    // Imp 2a: gap-down filter for short - skip if price gapped down hard (already sold off)
    if (pending.signalClose > 0 && pending.maxEntrySlippagePct != null) {
      const gapDown = (pending.signalClose - rawOpen) / pending.signalClose;
      if (gapDown > pending.maxEntrySlippagePct) {
        return;
      }
    }

    const fillPrice = entryFillPrice('short', rawOpen, slippageAt(barIndex));
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
      // Imp 1
      trailActivationPct: pending.trailingStopActivationPct,
      trailDistancePct:   pending.trailingStopDistancePct,
      trailActive: false,
      peakPrice: bar.open,
      // Imp 5
      partialExitFraction:    pending.partialExitFraction,
      partialExitAtTargetPct: pending.partialExitAtTargetPct,
      partialTaken: false,
      originalQty: qty,
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

  /**
   * Imp 5: Partial exit - close a fraction of the position without going flat.
   * Pushes a trade record for the closed leg; reduces openTrade.qty; marks
   * partialTaken. openTrade and position remain live.
   */
  function closePartialLong(fillPrice: number, exitBar: number, exitTime: string): void {
    if (!openTrade || openTrade.side !== 'long' || openTrade.partialTaken) return;
    const { entryFillPrice: entryFill, qty, entryTime, entryBar, entryReason,
            partialExitFraction } = openTrade;
    const frac   = partialExitFraction ?? 0.5;
    const partQty = qty * frac;

    cash += fillPrice * partQty - commission;
    const { pnl, costs } = realizedPnl('long', entryFill, fillPrice, partQty, commission);

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
      qty:         partQty,
      pnl,
      pnlPct:      (pnl / (entryFill * partQty)) * 100,
      costs,
      holdingBars: exitBar - entryBar,
      exitReason:  'target',
      entryReason: `${entryReason} [partial-${Math.round(frac * 100)}%]`,
    });

    // Reduce qty; keep position open
    openTrade.qty -= partQty;
    openTrade.partialTaken = true;
    // The runner no longer has a fixed target - let trailing stop handle it
    openTrade.targetPrice = undefined;
  }

  function closePartialShort(fillPrice: number, exitBar: number, exitTime: string): void {
    if (!openTrade || openTrade.side !== 'short' || openTrade.partialTaken) return;
    const { entryFillPrice: entryFill, qty, entryTime, entryBar, entryReason,
            partialExitFraction } = openTrade;
    const frac    = partialExitFraction ?? 0.5;
    const partQty = qty * frac;

    cash -= fillPrice * partQty + commission;
    const { pnl, costs } = realizedPnl('short', entryFill, fillPrice, partQty, commission);

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
      qty:         partQty,
      pnl,
      pnlPct:      (pnl / (entryFill * partQty)) * 100,
      costs,
      holdingBars: exitBar - entryBar,
      exitReason:  'target',
      entryReason: `${entryReason} [partial-${Math.round(frac * 100)}%]`,
    });

    openTrade.qty -= partQty;
    openTrade.partialTaken = true;
    openTrade.targetPrice = undefined;
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
        closeLong(exitFillPrice('long', rawOpen, slippageAt(i)), i, bar.time, exitReason, exit.reason);
      } else {
        closeShort(exitFillPrice('short', rawOpen, slippageAt(i)), i, bar.time, exitReason, exit.reason);
      }
      pendingExit = null;
    }

    // C. Intrabar stop/target check
    // Conservative rule: if BOTH stop and target are hit in the same bar, stop fills
    // first (worst outcome for the held side). This prevents over-reporting wins.
    //
    // Stop fills: apply adverse slippage to the stop price - real stops gap through
    // the level on fast moves / gap opens. Targets fill at the exact price (limit-
    // order equivalent; no slippage applied is already conservative for limit orders).
    //
    // Imp 5 (partial exit): checked only when stop is NOT hit. Conservative: a stop
    // hit on the same bar as a partial target closes the full position at the stop.
    if (openTrade !== null) {
      const trade = openTrade as OpenTrade;
      const { side, stopPrice, targetPrice } = trade;

      if (side === 'long') {
        const stopHit   = stopPrice   != null && bar.low  <= stopPrice;
        const targetHit = targetPrice != null && bar.high >= targetPrice;

        // Imp 5: partial exit target (below full target)
        const partialTargetPrice = (
          !trade.partialTaken &&
          trade.partialExitFraction != null &&
          trade.partialExitAtTargetPct != null &&
          trade.targetPrice != null
        )
          ? trade.entryFillPrice * (1 + (trade.targetPrice / trade.entryFillPrice - 1) * trade.partialExitAtTargetPct)
          : null;
        const partialHit = partialTargetPrice != null && bar.high >= partialTargetPrice;

        if (stopHit) {
          closeLong(exitFillPrice('long', stopPrice!, slippageAt(i)), i, bar.time, 'stop');
        } else if (targetHit) {
          closeLong(targetPrice!, i, bar.time, 'target');
        } else if (partialHit) {
          closePartialLong(partialTargetPrice!, i, bar.time);
        }
      } else {
        const stopHit   = stopPrice   != null && bar.high >= stopPrice;
        const targetHit = targetPrice != null && bar.low  <= targetPrice;

        const partialTargetPrice = (
          !trade.partialTaken &&
          trade.partialExitFraction != null &&
          trade.partialExitAtTargetPct != null &&
          trade.targetPrice != null
        )
          ? trade.entryFillPrice + (trade.targetPrice! - trade.entryFillPrice) * trade.partialExitAtTargetPct
          : null;
        const partialHit = partialTargetPrice != null && bar.low <= partialTargetPrice;

        if (stopHit) {
          closeShort(exitFillPrice('short', stopPrice!, slippageAt(i)), i, bar.time, 'stop');
        } else if (targetHit) {
          closeShort(targetPrice!, i, bar.time, 'target');
        } else if (partialHit) {
          closePartialShort(partialTargetPrice!, i, bar.time);
        }
      }
    }

    // C1.5. Imp 1: Trailing stop ratchet.
    // Runs AFTER intrabar stop/target (only if position still open).
    // Updates the running peak from bar i's high/low, arms the trail on first
    // activation, then ratchets stopPrice upward. The new stopPrice is evaluated
    // by section C on bar i+1 - no look-ahead.
    if (openTrade !== null) {
      const trade = openTrade as OpenTrade;
      if (trade.trailDistancePct != null && trade.trailActivationPct != null) {
        if (trade.side === 'long') {
          // Update peak from bar high
          if (bar.high > trade.peakPrice) trade.peakPrice = bar.high;
          // Arm trail once unrealised gain >= activation threshold
          const unrealised = (trade.peakPrice - trade.entryFillPrice) / trade.entryFillPrice;
          if (!trade.trailActive && unrealised >= trade.trailActivationPct) {
            trade.trailActive = true;
          }
          // Ratchet: stop rises but never falls
          if (trade.trailActive) {
            const trailStop = trade.peakPrice * (1 - trade.trailDistancePct);
            trade.stopPrice = trade.stopPrice != null
              ? Math.max(trade.stopPrice, trailStop)
              : trailStop;
          }
        } else {
          // Short: peak tracks bar low (running trough)
          if (bar.low < trade.peakPrice) trade.peakPrice = bar.low;
          const unrealised = (trade.entryFillPrice - trade.peakPrice) / trade.entryFillPrice;
          if (!trade.trailActive && unrealised >= trade.trailActivationPct) {
            trade.trailActive = true;
          }
          if (trade.trailActive) {
            const trailStop = trade.peakPrice * (1 + trade.trailDistancePct);
            trade.stopPrice = trade.stopPrice != null
              ? Math.min(trade.stopPrice, trailStop)
              : trailStop;
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
      // Regime gate: suppress entry when the strategy's precondition is not met.
      // Uses the regime state at bar i (the signal bar), looked up from the
      // pre-computed map. Exits are never suppressed by regime.
      const regimeOk = regimeMap == null
        ? true
        : lookupRegime(regimeMap, bar.time, regimeSortedDates ?? undefined);

      if (
        regimeOk &&
        (decision.action === 'enter_long' || decision.action === 'enter_short') &&
        position === 'flat'
      ) {
        // Effective hold cap = the tighter of strategy decision and engine config
        const capCandidates = [decision.maxHoldBars, maxHoldBars]
          .filter((v): v is number => v != null && v > 0);

        // Imp 3: dynamic sizing via signalStrength (0..1 -> 0.5x..2x multiplier)
        // Enabled by cfgDynSize (config-level) OR when strategy returns signalStrength.
        let effectiveSizePct = decision.sizePct ?? 1;
        if (cfgDynSize && strategy.signalStrength) {
          const strength = strategy.signalStrength(ctx, parsedParams);
          // Linear map: strength 0 -> 0.5x, 0.5 -> 1x, 1 -> 2x
          const multiplier = 0.5 + Math.max(0, Math.min(1, strength)) * 1.5;
          effectiveSizePct = Math.min(1, effectiveSizePct * multiplier);
        }

        // Config-level overrides take precedence over decision fields
        pendingEntry = {
          side:        decision.action === 'enter_long' ? 'long' : 'short',
          sizePct:     effectiveSizePct,
          stopPct:     decision.stopPct,
          targetPct:   decision.targetPct,
          maxHoldBars: capCandidates.length > 0 ? Math.min(...capCandidates) : undefined,
          reason:      decision.reason ?? '',
          signalClose: bar.close,
          // Imp 1: config override > decision field
          trailingStopActivationPct: cfgTrailAct ?? decision.trailingStopActivationPct,
          trailingStopDistancePct:   cfgTrailDist ?? decision.trailingStopDistancePct,
          // Imp 2: config override > decision field
          maxEntrySlippagePct: cfgMaxSlip ?? decision.maxEntrySlippagePct,
          gapDownWidenPct:     cfgGapDn   ?? decision.gapDownWidenPct,
          // Imp 5: config override > decision field
          partialExitFraction:    cfgPartialFrac ?? decision.partialExitFraction,
          partialExitAtTargetPct: cfgPartialAt   ?? decision.partialExitAtTargetPct,
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
      exposureSharpe: NaN,
      exposurePct:    0,
      numTrades:      0,
      avgHoldingBars: 0,
    },
  };
}
