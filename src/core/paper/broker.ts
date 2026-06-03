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
} from '@/core/db/paper';
import { getBars, getLatestClose } from '@/core/db/bars';
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
}

/**
 * Open a paper trade. Applies entry slippage. Commission is booked at close
 * (round-trip = 2 * commission) to match the backtest engine's convention.
 */
export function openPaperTrade(input: OpenTradeInput): PaperTrade {
  const {
    strategyId,
    symbol,
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

  void commission; // stored at close; declared here for interface completeness

  const fillPrice                 = entryFillPrice(side, rawEntryPrice, slippagePct);
  const qty                       = qtyForCash(equity, sizePct, fillPrice);
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
