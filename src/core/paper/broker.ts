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
  fillPendingPaperTrade,
  getPaperTrade,
  getPaperTrades,
  getOpenPaperTradeBySymbol,
  getActivePaperTradeBySymbol,
} from '@/core/db/paper';
import { sendTelegram, telegramConfigured } from '@/core/notify/telegram';
import { fmtMoney } from '@/core/format/currency';
import { getAllSymbols, getBars, getLatestBarTime, getLatestClose } from '@/core/db/bars';
import { get as getProvider } from '@/core/data/registry';
import { runBacktest } from '@/core/backtest/engine';
import { maxHoldBars } from '@/core/config';
import { computeCashAccount, buildAccountSummary } from './account';
import { insertJournalWhy, recordJournalOutcome } from '@/core/db/journal';
import { checkRisk, riskLimitsFromEnv, type RiskRule } from '@/core/risk/checks';
import { openPositionsUSD } from '@/core/risk/exposure';
import { toUSD } from '@/core/format/fx';
import type { Strategy, StrategyContext, StrategyDecision } from '@/core/strategy/Strategy';
import { isTradingHalted } from '@/core/paper/halt';

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
  /**
   * Optional WHY snapshot for the trade journal (signal reason, conviction,
   * edge stats...). Display-only - never read back into trading logic.
   */
  journalWhy?:  Record<string, unknown>;
}

export class DuplicateOpenTradeError extends Error {
  readonly symbol: string;
  readonly existingTradeId: string;

  constructor(symbol: string, existingTradeId: string) {
    super(`An active paper trade (open or pending) already exists for ${symbol}. Close or cancel it before opening another.`);
    this.name = 'DuplicateOpenTradeError';
    this.symbol = symbol;
    this.existingTradeId = existingTradeId;
  }
}

export class InsufficientFundsError extends Error {
  constructor(costUSD: number, cashUSD: number) {
    super(
      `Insufficient funds: this trade needs $${costUSD.toFixed(2)} but only ` +
      `$${cashUSD.toFixed(2)} cash is available. Reduce size or close a position.`,
    );
    this.name = 'InsufficientFundsError';
  }
}

export class BankruptError extends Error {
  constructor(equityUSD: number) {
    super(
      `BANKRUPT: account equity is $${equityUSD.toFixed(2)}. The system failed ` +
      `with this budget - set a new budget to restart.`,
    );
    this.name = 'BankruptError';
  }
}

export class RiskCheckError extends Error {
  readonly rule: RiskRule;
  constructor(rule: RiskRule, message: string) {
    super(message);
    this.name = 'RiskCheckError';
    this.rule = rule;
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
  const existing = getActivePaperTradeBySymbol(symbol);
  if (existing) {
    throw new DuplicateOpenTradeError(symbol, existing.id);
  }

  // Backstop: manual halt switch blocks all new entries regardless of caller.
  // Exits/sweeps/closes are intentionally unaffected.
  const haltState = isTradingHalted();
  if (haltState.halted) {
    throw new RiskCheckError(
      'manual-halt',
      `Trading halted: ${haltState.reason ?? 'manual halt active'}. Send /resume via Telegram or clear via the DB to lift.`,
    );
  }

  void commission; // stored at close; declared here for interface completeness

  const fillPrice = entryFillPrice(side, rawEntryPrice, slippagePct);
  const qty       = input._overrideQty != null
    ? input._overrideQty
    : qtyForCash(equity, sizePct, fillPrice);
  const { stopPrice, targetPrice } = stopTargetPrices(side, fillPrice, stopPct, targetPct);

  // Budget enforcement (only when a budget is set): the entry notional is
  // reserved from cash for BOTH sides (no margin model); equity <= 0 blocks
  // everything - that is the bankruptcy signal the user asked for.
  const cashAccount = computeCashAccount();
  if (cashAccount) {
    const unrealizedUSD = markOpenTrades().reduce(
      (sum, m) => sum + toUSD(m.unrealizedPnl, m.trade.currency),
      0,
    );
    const summary = buildAccountSummary(cashAccount, unrealizedUSD);
    if (summary.bankrupt) {
      throw new BankruptError(summary.equity);
    }
    const currency = getAllSymbols().find((m) => m.symbol === symbol)?.currency;
    const costUSD  = toUSD(fillPrice * qty, currency);
    if (costUSD > summary.cash) {
      throw new InsufficientFundsError(costUSD, summary.cash);
    }

    // Risk management rules (concentration, open risk, trade count, drawdown halt,
    // correlated-cluster). Pass candidate bars so correlation can be computed.
    const candidateStop = stopTargetPrices(side, fillPrice, stopPct, targetPct).stopPrice;
    let candidateBars: ReturnType<typeof getBars> | undefined;
    try { candidateBars = getBars(symbol, '1d'); } catch { /* no bars - skip corr */ }
    const risk = checkRisk(
      { startingBalance: summary.startingBalance, equity: summary.equity },
      openPositionsUSD(candidateBars),
      {
        symbol,
        costUSD,
        stopRiskUSD:
          candidateStop != null
            ? toUSD(Math.abs(fillPrice - candidateStop) * qty, currency)
            : null,
      },
      riskLimitsFromEnv(),
    );
    if (!risk.ok) {
      throw new RiskCheckError(risk.rule, risk.message);
    }
  }

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

  // Journal the WHY at the moment of decision - hindsight cannot edit this
  insertJournalWhy(trade.id, {
    symbol,
    strategyId,
    side,
    entryPrice: fillPrice,
    qty,
    stopPrice,
    targetPrice,
    notes,
    ...input.journalWhy,
  });

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
  /** How the exit happened - journaled with the outcome. Default 'manual'. */
  exitReason?:  'manual' | 'stop' | 'target' | 'time';
}

/** Close an open paper trade. Applies exit slippage and books commission. */
export function closePaperTrade(id: string, exit: CloseTradeInput): PaperTrade {
  const trade = getPaperTrade(id);
  if (!trade) throw new Error(`Paper trade '${id}' not found.`);
  if (trade.status === 'closed') throw new Error(`Trade '${id}' is already closed.`);
  if (trade.status === 'pending') throw new Error(`Trade '${id}' is pending - cancel it instead of closing.`);

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

  // Journal the outcome - completes the open-time WHY snapshot
  const heldDays = Math.round(
    (new Date(exitTime).getTime() - new Date(trade.entryTime).getTime()) / 86_400_000,
  );
  recordJournalOutcome(trade.id, {
    exitReason: exit.exitReason ?? 'manual',
    exitPrice:  fillPrice,
    exitTime,
    pnl,
    pnlPct,
    heldDays,
  });

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
// Pending limit orders - create, fill, sweep
// ---------------------------------------------------------------------------

/** Telegram message sent when a resting limit order fills. */
function pendingFillText(trade: PaperTrade, limitPrice: number): string {
  const cur = trade.currency ?? 'USD';
  const head = `${trade.symbol} LIMIT FILLED - ${trade.side.toUpperCase()} ${trade.strategyId}`;
  const priceLine = `filled @ ${fmtMoney(trade.entryPrice, cur)} (limit was ${fmtMoney(limitPrice, cur)})`;
  const levels = [
    trade.stopPrice   != null ? `stop ${fmtMoney(trade.stopPrice,   cur)}` : null,
    trade.targetPrice != null ? `target ${fmtMoney(trade.targetPrice, cur)}` : null,
  ].filter(Boolean).join(' | ');
  return [
    head,
    priceLine,
    levels || 'no stop/target set',
    `qty ${trade.qty.toFixed(4)}`,
    'Paper trade - research tool, not financial advice.',
  ].join('\n');
}

/**
 * Create a resting limit order (status: 'pending'). Capital is NOT committed
 * until the market trades through the entry price.
 *
 * Slippage is applied at fill time, not creation. Stop/target prices are
 * stored as-is and kept on fill.
 */
export function createPendingTrade(input: OpenTradeInput): PaperTrade {
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
    notes,
  } = input;

  const symbol = rawSymbol.toUpperCase();

  // Block duplicate active (open OR pending) positions for the same symbol
  const existing = getActivePaperTradeBySymbol(symbol);
  if (existing) {
    throw new DuplicateOpenTradeError(symbol, existing.id);
  }

  // Size from desired entry; stop/target from desired entry (kept unchanged on fill)
  const qty = input._overrideQty != null
    ? input._overrideQty
    : qtyForCash(equity, sizePct, rawEntryPrice);
  const { stopPrice, targetPrice } = stopTargetPrices(side, rawEntryPrice, stopPct, targetPct);

  const trade: PaperTrade = {
    id:         randomUUID(),
    strategyId,
    symbol,
    side,
    qty,
    entryTime,         // request date; overwritten with fill date on fill
    entryPrice:        rawEntryPrice, // desired limit; overwritten with fill price on fill
    stopPrice,
    targetPrice,
    status:            'pending',
    costs:             0,
    notes,
  };

  insertPaperTrade(trade);

  insertJournalWhy(trade.id, {
    symbol,
    strategyId,
    side,
    entryPrice:  rawEntryPrice,
    qty,
    stopPrice,
    targetPrice,
    orderType:   'limit',
    notes,
    ...input.journalWhy,
  });

  return trade;
}

export interface PendingFillResult {
  trade:       PaperTrade;
  action:      'filled' | 'fill-blocked' | 'still-pending';
  fillPrice?:  number;
  fillTime?:   string;
  // diagnostic fields - populated by fillPendingTradesWithQuotes (live-quote path)
  quotePrice?: number;   // live quote price seen during this check
  limitPrice?: number;   // trade.entryPrice (the resting limit)
  crossed?:    boolean;  // did the quote cross the limit this check
  reason?:     string;   // human-readable note: 'resting - 2.1% away', 'crossed - filled at limit', etc.
}

/**
 * Attempt to convert a pending trade to open.
 *
 * Applies slippage to rawFillPrice, runs the same budget + risk checks as
 * openPaperTrade. On success: updates DB and sends Telegram. On failure
 * (budget/risk): leaves the trade pending and logs a warning.
 */
export function fillPendingTrade(
  trade:        PaperTrade,
  rawFillPrice: number,
  fillTime:     string,
): PaperTrade | null {
  const slippagePct = 0.0005;
  const fillPrice   = entryFillPrice(trade.side, rawFillPrice, slippagePct);
  const limitPrice  = trade.entryPrice; // original desired entry for the notification

  // Budget + risk checks (same gates as openPaperTrade, broker.ts ~line 138)
  const cashAccount = computeCashAccount();
  if (cashAccount) {
    const unrealizedUSD = markOpenTrades().reduce(
      (sum, m) => sum + toUSD(m.unrealizedPnl, m.trade.currency),
      0,
    );
    const summary = buildAccountSummary(cashAccount, unrealizedUSD);
    if (summary.bankrupt) {
      console.warn(`[pending fill] ${trade.symbol}: account bankrupt, leaving pending`);
      return null;
    }
    const currency = getAllSymbols().find((m) => m.symbol === trade.symbol)?.currency;
    const costUSD  = toUSD(fillPrice * trade.qty, currency);
    if (costUSD > summary.cash) {
      console.warn(
        `[pending fill] ${trade.symbol}: insufficient funds ` +
        `($${costUSD.toFixed(2)} needed, $${summary.cash.toFixed(2)} available) - leaving pending`,
      );
      return null;
    }
    const risk = checkRisk(
      { startingBalance: summary.startingBalance, equity: summary.equity },
      openPositionsUSD(),
      {
        symbol:      trade.symbol,
        costUSD,
        stopRiskUSD: trade.stopPrice != null
          ? toUSD(Math.abs(fillPrice - trade.stopPrice) * trade.qty, currency)
          : null,
      },
      riskLimitsFromEnv(),
    );
    if (!risk.ok) {
      console.warn(`[pending fill] ${trade.symbol}: risk check failed (${risk.message}) - leaving pending`);
      return null;
    }
  }

  fillPendingPaperTrade(trade.id, { entryPrice: fillPrice, entryTime: fillTime });

  const filled: PaperTrade = {
    ...trade,
    entryPrice: fillPrice,
    entryTime:  fillTime,
    status:     'open',
  };

  if (telegramConfigured()) {
    void sendTelegram(pendingFillText(filled, limitPrice));
  }

  return filled;
}

/**
 * EOD pending-fill sweep: check all resting limit orders against daily bars
 * since the order date and fill any whose limit was crossed.
 *
 * Long limit: bar.low <= entryPrice  -> fill at min(bar.open, entryPrice)
 * Short limit: bar.high >= entryPrice -> fill at max(bar.open, entryPrice)
 *
 * Must be called BEFORE sweepOpenTrades() in post-refresh so a trade that
 * fills and then immediately hits its stop/target is handled in one pass.
 */
export function sweepPendingTrades(timeframe: Timeframe = '1d'): PendingFillResult[] {
  const pendingTrades = getPaperTrades({ status: 'pending' });
  const results: PendingFillResult[] = [];

  for (const trade of pendingTrades) {
    const allBars  = getBars(trade.symbol, timeframe);
    const postBars = allBars.filter((b) => b.time > trade.entryTime);
    const limit    = trade.entryPrice;
    let filled     = false;

    for (const bar of postBars) {
      let rawFill: number | undefined;

      if (trade.side === 'long') {
        // Buy when price comes down to the limit (or gaps through it)
        if (bar.low <= limit) {
          rawFill = Math.min(bar.open, limit); // gap-through fills at bar open (better)
        }
      } else {
        // Sell when price rises to the limit (or gaps through it)
        if (bar.high >= limit) {
          rawFill = Math.max(bar.open, limit);
        }
      }

      if (rawFill !== undefined) {
        const filledTrade = fillPendingTrade(trade, rawFill, bar.time);
        results.push({
          trade:      filledTrade ?? trade,
          action:     filledTrade ? 'filled' : 'fill-blocked',
          fillPrice:  rawFill,
          fillTime:   bar.time,
          limitPrice: limit,
          reason:     filledTrade ? 'bar crossed limit - filled' : 'bar crossed limit but budget/risk blocked',
        });
        filled = true;
        break;
      }
    }

    if (!filled) {
      results.push({ trade, action: 'still-pending', limitPrice: limit, reason: 'no bar has crossed the limit yet' });
    }
  }

  return results;
}

/**
 * Live-quote pending-fill check for the 15-min monitor and REFRESH PRICES
 * button. Uses the same logic as sweepPendingTrades but against provider
 * quotes instead of stored bars - runs fills in realtime during market hours.
 */
export async function fillPendingTradesWithQuotes(
  timeframe: Timeframe = '1d',
): Promise<PendingFillResult[]> {
  const pendingTrades = getPaperTrades({ status: 'pending' });
  if (pendingTrades.length === 0) return [];

  const metaBySymbol = new Map(getAllSymbols().map((m) => [m.symbol, m]));
  const results: PendingFillResult[] = [];

  for (const trade of pendingTrades) {
    const limit = trade.entryPrice;

    const meta = metaBySymbol.get(trade.symbol);
    if (!meta) continue;
    const provider = getProvider(meta.providerId);
    if (typeof provider.getQuote !== 'function') {
      results.push({ trade, action: 'still-pending', limitPrice: limit, reason: 'provider has no live quote' });
      continue;
    }

    let quote;
    try {
      quote = await provider.getQuote(trade.symbol);
    } catch {
      results.push({ trade, action: 'still-pending', limitPrice: limit, reason: 'no live quote available' });
      continue;
    }

    if (!quote || !isFinite(quote.price) || quote.price <= 0) {
      results.push({ trade, action: 'still-pending', limitPrice: limit, reason: 'no live quote available' });
      continue;
    }

    // Skip if the quote is older than the latest bar (stale data)
    const latestBarTime = getLatestBarTime(trade.symbol, timeframe);
    if (latestBarTime && quote.time.slice(0, 10) < latestBarTime) {
      results.push({
        trade, action: 'still-pending', limitPrice: limit,
        quotePrice: quote.price, reason: 'stale quote (older than last bar)',
      });
      continue;
    }

    const crossed = trade.side === 'long'
      ? quote.price <= limit
      : quote.price >= limit;

    if (!crossed) {
      const dist = (Math.abs(quote.price - limit) / limit * 100).toFixed(2);
      results.push({
        trade, action: 'still-pending', limitPrice: limit,
        quotePrice: quote.price, crossed: false,
        reason: `resting - ${dist}% from limit`,
      });
      continue;
    }

    // Fill at the limit price (conservative: guaranteed price, not gap-through)
    const fillTime    = quote.time.slice(0, 10);
    const filledTrade = fillPendingTrade(trade, limit, fillTime);
    results.push({
      trade:      filledTrade ?? trade,
      action:     filledTrade ? 'filled' : 'fill-blocked',
      fillPrice:  limit,
      fillTime,
      limitPrice: limit,
      quotePrice: quote.price,
      crossed:    true,
      reason:     filledTrade ? 'crossed - filled at limit' : 'crossed but budget/risk blocked',
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// EOD sweep - check all open trades against daily bars for stop/target hits
// ---------------------------------------------------------------------------

export interface SweepResult {
  trade:     PaperTrade;
  action:    'stopped' | 'targeted' | 'expired' | 'still-open';
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
  /** Force-close trades held more than this many post-entry bars. Default: global swing cap. */
  holdCapBars: number = maxHoldBars(),
): SweepResult[] {
  const openTrades = getPaperTrades({ status: 'open' });
  const results:   SweepResult[] = [];

  for (const trade of openTrades) {
    const allBars   = getBars(trade.symbol, timeframe);
    // Only look at bars strictly after the entry time
    const postBars  = allBars.filter((b) => b.time > trade.entryTime);

    let closed = false;
    let barsHeld = 0;
    for (const bar of postBars) {
      barsHeld += 1;
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
            exitReason:  'stop',
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
            exitReason:  'target',
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
            exitReason:  'stop',
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
            exitReason:  'target',
          });
          results.push({ trade: closed_, action: 'targeted', exitPrice: targetPrice!, exitTime: bar.time });
          closed = true;
          break;
        }
      }

      // Time stop: held past the swing cap - close at this bar's close.
      // Checked after stop/target so a same-bar level hit keeps precedence.
      if (holdCapBars > 0 && barsHeld >= holdCapBars) {
        const closed_ = closePaperTrade(trade.id, {
          exitPrice:   bar.close,
          exitTime:    bar.time,
          commission,
          slippagePct,
          exitReason:  'time',
        });
        results.push({ trade: closed_, action: 'expired', exitPrice: bar.close, exitTime: bar.time });
        closed = true;
        break;
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
