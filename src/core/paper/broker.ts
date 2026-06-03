import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PaperTrade, Timeframe } from '@/core/types';
import {
  entryFillPrice,
  exitFillPrice,
  stopTargetPrices,
  realizedPnl,
  markToMarket,
  qtyForCash,
} from '@/core/backtest/fills';
import {
  insertPaperTrade,
  updatePaperTrade,
  getPaperTrade,
  getPaperTrades,
  getOpenPaperTradeBySymbol,
} from '@/core/db/paper';
import { getAllSymbols, getBars, getLatestBarTime, getLatestClose } from '@/core/db/bars';
import { get as getProvider } from '@/core/data/registry';
import { runBacktest } from '@/core/backtest/engine';
import type { Strategy, StrategyContext, StrategyDecision } from '@/core/strategy/Strategy';

// ---------------------------------------------------------------------------
// Open
// ---------------------------------------------------------------------------

export interface OpenTradeInput {
  strategyId:   string;
  symbol:       string;
  side:         'long' | 'short';
  /** Pre-slippage entry price (typically the bar close at signal time). */
  entryPrice:   number;
  entryTime:    string;
  /** Fraction of notional equity to size position. Default 1.0. */
  sizePct?:     number;
  stopPct?:     number;
  targetPct?:   number;
  /** Notional portfolio equity for sizing. Default 10_000. */
  equity?:      number;
  commission?:  number;
  slippagePct?: number;
  notes?:       string;
  /** Directly override qty (skips sizePct/equity-based sizing). */
  _overrideQty?: number;
}

export class DuplicateOpenTradeError extends Error {
  readonly symbol: string;
  readonly existingTradeId: string;

  constructor(symbol: string, existingTradeId: string) {
    super(`An open paper trade already exists for ${symbol}. Close it before opening another.`);
    this.name = 'DuplicateOpenTradeError';
    this.symbol = symbol;
    this.existingTradeId = existingTradeId;
  }
}

/**
 * Open a paper trade. Applies entry slippage. Commission is booked at close
 * (round-trip = 2 * commission) to match the backtest engine's convention.
 */
export function openPaperTrade(input: OpenTradeInput): PaperTrade {
  const {
    strategyId,
    symbol: rawSymbol,
    side,
    entryPrice:  rawEntryPrice,
    entryTime,
    sizePct     = 1,
    stopPct,
    targetPct,
    equity      = 10_000,
    commission  = 0,
    slippagePct = 0.0005,
    notes,
  } = input;

  const symbol = rawSymbol.toUpperCase();
  const existing = getOpenPaperTradeBySymbol(symbol);
  if (existing) {
    throw new DuplicateOpenTradeError(symbol, existing.id);
  }

  void commission; // stored at close; declared here for interface completeness

  const fillPrice = entryFillPrice(side, rawEntryPrice, slippagePct);
  const qty       = input._overrideQty != null
    ? input._overrideQty
    : qtyForCash(equity, sizePct, fillPrice);
  const { stopPrice, targetPrice } = stopTargetPrices(side, fillPrice, stopPct, targetPct);

  const trade: PaperTrade = {
    id:          randomUUID(),
    strategyId,
    symbol,
    side,
    qty,
    entryTime,
    entryPrice:  fillPrice,
    stopPrice,
    targetPrice,
    status:      'open',
    costs:       0,
    notes,
  };

  insertPaperTrade(trade);
  return trade;
}

// ---------------------------------------------------------------------------
// Close
// ---------------------------------------------------------------------------

export interface CloseTradeInput {
  /** Pre-slippage exit price (typically the next bar's open). */
  exitPrice:    number;
  exitTime:     string;
  commission?:  number;
  slippagePct?: number;
}

/** Close an open paper trade. Applies exit slippage and books commission. */
export function closePaperTrade(id: string, exit: CloseTradeInput): PaperTrade {
  const trade = getPaperTrade(id);
  if (!trade) throw new Error(`Paper trade '${id}' not found.`);
  if (trade.status === 'closed') throw new Error(`Trade '${id}' is already closed.`);

  const {
    exitPrice:   rawExitPrice,
    exitTime,
    commission  = 0,
    slippagePct = 0.0005,
  } = exit;

  const fillPrice        = exitFillPrice(trade.side, rawExitPrice, slippagePct);
  const { pnl, costs }   = realizedPnl(trade.side, trade.entryPrice, fillPrice, trade.qty, commission);
  const pnlPct           = (pnl / (trade.entryPrice * trade.qty)) * 100;

  const updated: PaperTrade = {
    ...trade,
    exitTime,
    exitPrice: fillPrice,
    pnl,
    pnlPct,
    costs,
    status: 'closed',
  };

  updatePaperTrade(updated);
  return updated;
}

// ---------------------------------------------------------------------------
// Mark-to-market
// ---------------------------------------------------------------------------

export interface MarkResult {
  trade:              PaperTrade;
  markPrice:          number;
  unrealizedPnl:      number;
  unrealizedPnlPct:   number;
}

/**
 * Mark all open paper trades against the latest stored bar close.
 * Fully offline and deterministic - no network calls.
 */
export function markOpenTrades(timeframe: Timeframe = '1d'): MarkResult[] {
  const openTrades = getPaperTrades({ status: 'open' });

  return openTrades.map((trade) => {
    const markPrice = getLatestClose(trade.symbol, timeframe) ?? trade.entryPrice;

    // Unrealized P&L using same formula as engine's mark-to-market:
    // markToMarket(side, 0, qty, markPrice) gives the position's market value,
    // subtracting the entry cost gives unrealized P&L.
    const positionValue  = markToMarket(trade.side, 0, trade.qty, markPrice);
    const entryCost      = trade.side === 'long'
      ? trade.entryPrice * trade.qty
      : -(trade.entryPrice * trade.qty);
    const unrealizedPnl  = positionValue - entryCost;
    const unrealizedPnlPct = (unrealizedPnl / (trade.entryPrice * trade.qty)) * 100;

    return { trade, markPrice, unrealizedPnl, unrealizedPnlPct };
  });
}

/**
 * Mark open trades against current provider quotes when available; otherwise
 * fall back to the latest stored bar close.
 */
export async function markOpenTradesWithQuotes(timeframe: Timeframe = '1d'): Promise<MarkResult[]> {
  const deterministic = markOpenTrades(timeframe);
  const metaBySymbol = new Map(getAllSymbols().map((m) => [m.symbol, m]));

  return Promise.all(deterministic.map(async (mark) => {
    const meta = metaBySymbol.get(mark.trade.symbol);
    if (!meta) return mark;
    const provider = getProvider(meta.providerId);
    if (typeof provider.getQuote !== 'function') return mark;

    const quote = await provider.getQuote(mark.trade.symbol);
    const latestBarTime = getLatestBarTime(mark.trade.symbol, timeframe);
    if (!quote || !isFinite(quote.price) || (latestBarTime && quote.time.slice(0, 10) < latestBarTime)) {
      return mark;
    }

    const positionValue = markToMarket(mark.trade.side, 0, mark.trade.qty, quote.price);
    const entryCost = mark.trade.side === 'long'
      ? mark.trade.entryPrice * mark.trade.qty
      : -(mark.trade.entryPrice * mark.trade.qty);
    const unrealizedPnl = positionValue - entryCost;
    const unrealizedPnlPct = (unrealizedPnl / (mark.trade.entryPrice * mark.trade.qty)) * 100;

    return {
      trade: mark.trade,
      markPrice: quote.price,
      unrealizedPnl,
      unrealizedPnlPct,
    };
  }));
}

// ---------------------------------------------------------------------------
// EOD sweep - check all open trades against daily bars for stop/target hits
// ---------------------------------------------------------------------------

export interface SweepResult {
  trade:     PaperTrade;
  action:    'stopped' | 'targeted' | 'still-open';
  exitPrice?: number;
  exitTime?:  string;
}

/**
 * Check all open paper trades against daily bars stored after the entry date.
 * For each bar after entry:
 *   - Long: low <= stopPrice  -> stopped out (conservative: stop before target same bar)
 *           high >= targetPrice -> target hit
 *   - Short: high >= stopPrice -> stopped out
 *            low <= targetPrice -> target hit
 *
 * Conservative rule (project invariant): if both stop and target are within the same
 * bar, assume the stop was hit first (worst outcome).
 *
 * Calls closePaperTrade() which books slippage/commission identically to the engine.
 * Returns a SweepResult per open trade.
 */
export function sweepOpenTrades(
  timeframe:   Timeframe = '1d',
  commission:  number = 0,
  slippagePct: number = 0.0005,
): SweepResult[] {
  const openTrades = getPaperTrades({ status: 'open' });
  const results:   SweepResult[] = [];

  for (const trade of openTrades) {
    // Must have a stop price to sweep (target-only trades stay open until manual close)
    if (trade.stopPrice == null && trade.targetPrice == null) {
      results.push({ trade, action: 'still-open' });
      continue;
    }

    const allBars   = getBars(trade.symbol, timeframe);
    // Only look at bars strictly after the entry time
    const postBars  = allBars.filter((b) => b.time > trade.entryTime);

    let closed = false;
    for (const bar of postBars) {
      const { stopPrice, targetPrice } = trade;

      if (trade.side === 'long') {
        const stopHit   = stopPrice   != null && bar.low  <= stopPrice;
        const targetHit = targetPrice != null && bar.high >= targetPrice;

        if (stopHit) {
          // Conservative: stop first even if target also hit
          const closed_ = closePaperTrade(trade.id, {
            exitPrice:   stopPrice!,
            exitTime:    bar.time,
            commission,
            slippagePct,
          });
          results.push({ trade: closed_, action: 'stopped', exitPrice: stopPrice!, exitTime: bar.time });
          closed = true;
          break;
        }
        if (targetHit) {
          const closed_ = closePaperTrade(trade.id, {
            exitPrice:   targetPrice!,
            exitTime:    bar.time,
            commission,
            slippagePct,
          });
          results.push({ trade: closed_, action: 'targeted', exitPrice: targetPrice!, exitTime: bar.time });
          closed = true;
          break;
        }
      } else {
        // Short position: stop is above entry, target is below
        const stopHit   = stopPrice   != null && bar.high >= stopPrice;
        const targetHit = targetPrice != null && bar.low  <= targetPrice;

        if (stopHit) {
          const closed_ = closePaperTrade(trade.id, {
            exitPrice:   stopPrice!,
            exitTime:    bar.time,
            commission,
            slippagePct,
          });
          results.push({ trade: closed_, action: 'stopped', exitPrice: stopPrice!, exitTime: bar.time });
          closed = true;
          break;
        }
        if (targetHit) {
          const closed_ = closePaperTrade(trade.id, {
            exitPrice:   targetPrice!,
            exitTime:    bar.time,
            commission,
            slippagePct,
          });
          results.push({ trade: closed_, action: 'targeted', exitPrice: targetPrice!, exitTime: bar.time });
          closed = true;
          break;
        }
      }
    }

    if (!closed) {
      results.push({ trade, action: 'still-open' });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Project trade (replays history via runBacktest for exact P&L parity)
// ---------------------------------------------------------------------------

export interface ProjectTradeOpts {
  symbol:       string;
  /** ISO date 'YYYY-MM-DD'. Bar at or after this date is the entry bar. */
  entryDate:    string;
  /** Number of bars to hold (daily timeframe = approximately calendar days minus weekends). */
  holdingBars:  number;
  strategyId?:  string;
  timeframe?:   string;
  commission?:  number;
  slippagePct?: number;
}

export type ProjectTradeResult =
  | { status: 'no-data'; trade: null }
  | { status: 'open';    trade: null }
  | { status: 'closed';  trade: import('@/core/backtest/engine').TradeRecord };

/**
 * Simulate "if I buy X on entryDate and hold for holdingBars bars, what happens?"
 *
 * Uses runBacktest internally so projected P&L is guaranteed identical to backtest P&L
 * for the same inputs. No math is duplicated.
 *
 * Returns status='open' when there are not enough forward bars in the DB yet.
 */
export function projectTrade(opts: ProjectTradeOpts): ProjectTradeResult {
  const {
    symbol,
    entryDate,
    holdingBars,
    timeframe   = '1d',
    commission  = 0,
    slippagePct = 0.0005,
  } = opts;

  const allBars  = getBars(symbol, timeframe as Timeframe);
  const startIdx = allBars.findIndex((b) => b.time >= entryDate);

  if (startIdx === -1) return { status: 'no-data', trade: null };

  // Need: signal bar (startIdx) + holdingBars to hold + 1 fill bar for exit.
  // Engine fills entry at startIdx+1, exit signal at startIdx+holdingBars fills at startIdx+holdingBars+1.
  const needed = holdingBars + 2;
  const slice  = allBars.slice(startIdx, startIdx + needed);

  if (slice.length < needed) return { status: 'open', trade: null };

  const strategy = makeFixedHoldStrategy(holdingBars);
  const result   = runBacktest({
    strategy,
    bars:       slice,
    symbol,
    rawParams:  {},
    commission,
    slippagePct,
  });

  const trade = result.trades[0] ?? null;
  if (!trade) return { status: 'open', trade: null };

  return { status: 'closed', trade };
}

// ---------------------------------------------------------------------------
// Internal: fixed-hold strategy used by projectTrade
// ---------------------------------------------------------------------------

function makeFixedHoldStrategy(holdingBars: number): Strategy {
  const schema = z.object({});
  return {
    id:          'fixed-hold',
    name:        'Fixed Hold',
    description: `Enter long on first bar, hold for ${holdingBars} bars.`,
    params:      schema,
    onBar(ctx: StrategyContext): StrategyDecision {
      if (ctx.i === 0 && ctx.position === 'flat')   return { action: 'enter_long', reason: 'project-entry' };
      if (ctx.i >= holdingBars && ctx.position !== 'flat') return { action: 'exit', reason: 'project-exit' };
      return { action: 'hold' };
    },
  };
}
