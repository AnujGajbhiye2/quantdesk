import 'server-only';
/**
 * Daily market auto-trade engine.
 *
 * Fires after each market's close (NSE ~11:30 Dublin, EU ~16:45 Dublin,
 * US+commodities 21:05 Dublin). Each call handles ONE market bucket:
 *   1. Sweep all open trades (stop/target exits) against the latest daily bars.
 *   2. Scan the market's universe for consensus signals.
 *   3. Recommend + execute paper trades for qualifying signals.
 *   4. Send Telegram digest.
 *
 * Gated by DAILY_AUTO_TRADE_ENABLED=1 (separate from the intraday toggle).
 * DRY_RUN mode: DAILY_AUTO_TRADE_DRY_RUN=1 - Telegram-only, no DB writes.
 *
 * The intraday runAutoTrade() is unchanged and still handles 15m US entries.
 */

import { scanAll } from '@/core/scan/scan-all';
import { buildConsensus } from '@/core/scan/consensus';
import { sweepOpenTrades } from '@/core/paper/broker';
import { openPaperTrade, DuplicateOpenTradeError, RiskCheckError } from '@/core/paper/broker';
import { computeCashAccount, buildAccountSummary } from '@/core/paper/account';
import { markOpenTrades } from '@/core/paper/broker';
import { getActivePaperTradeBySymbol, getPaperTrades } from '@/core/db/paper';
import { getLatestBarTime, getRecentBars } from '@/core/db/bars';
import { recommendTrade, capIdeaToCash } from '@/core/signals/recommend';
import { get as getStrategy, listLive as listLiveStrategies } from '@/core/strategy/registry';
import { refreshUniverse } from '@/core/data/ingest';
import { universeForMarket, type ScanMarket } from '@/core/data/universe';
import { sendTelegram, telegramConfigured } from '@/core/notify/telegram';
import { insertJournalWhy } from '@/core/db/journal';
import { toUSD } from '@/core/format/fx';
import type { Signal } from '@/core/types';
import { scanSymbol } from '@/core/scan/scanner';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface DailyAutoTradeConfig {
  enabled:         boolean;
  dryRun:          boolean;
  minConsensus:    number;
  maxTradesPerDay: number;
  dailyLossHaltPct: number;
}

function loadConfig(): DailyAutoTradeConfig {
  return {
    enabled:          process.env.DAILY_AUTO_TRADE_ENABLED === '1',
    dryRun:           process.env.DAILY_AUTO_TRADE_DRY_RUN === '1',
    minConsensus:     parseInt(process.env.DAILY_AUTO_TRADE_MIN_CONSENSUS ?? '2', 10),
    maxTradesPerDay:  parseInt(process.env.DAILY_AUTO_TRADE_MAX_TRADES_PER_DAY ?? '3', 10),
    dailyLossHaltPct: parseFloat(process.env.DAILY_AUTO_TRADE_DAILY_LOSS_HALT_PCT ?? '0.03'),
  };
}

// ---------------------------------------------------------------------------
// Summary types
// ---------------------------------------------------------------------------

export interface DailyAutoTradeEntry {
  symbol:      string;
  side:        'long' | 'short';
  qty:         number;
  entryPrice:  number;
  stopPrice:   number;
  targetPrice: number;
  rr:          number;
  strategyIds: string[];
  dryRun:      boolean;
}

export interface DailyAutoTradeSkip {
  symbol: string;
  reason: string;
  details?: string;
}

export interface DailyAutoTradeSummary {
  market:     ScanMarket;
  enabled:    boolean;
  dryRun:     boolean;
  halted:     boolean;
  haltReason?: string;
  entries:    DailyAutoTradeEntry[];
  exits:      { symbol: string; action: string; exitPrice?: number; pnl?: number }[];
  skips:      DailyAutoTradeSkip[];
  signals:    number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

async function tg(msg: string): Promise<void> {
  if (!telegramConfigured()) return;
  try { await sendTelegram(msg); } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run a single daily market scan: refresh -> scan -> execute -> digest.
 * Called by per-market crons in instrumentation.ts.
 *
 * Returns summary even when disabled (enabled: false, entries/exits empty).
 */
export async function runDailyAutoTrade(
  opts: { market: ScanMarket },
): Promise<DailyAutoTradeSummary> {
  const t0  = Date.now();
  const cfg = loadConfig();
  const { market } = opts;

  const summary: DailyAutoTradeSummary = {
    market,
    enabled:    cfg.enabled,
    dryRun:     cfg.dryRun,
    halted:     false,
    entries:    [],
    exits:      [],
    skips:      [],
    signals:    0,
    durationMs: 0,
  };

  if (!cfg.enabled) {
    summary.durationMs = Date.now() - t0;
    return summary;
  }

  // ------------------------------------------------------------------
  // 1. Refresh bars for this market's universe
  // ------------------------------------------------------------------
  const universe = universeForMarket(market);
  try {
    const refreshResults = await refreshUniverse(universe, '1d');
    const errors = refreshResults.filter((r) => r.error).length;
    if (errors > 0) {
      console.warn(`[daily-auto-trade:${market}] refresh: ${refreshResults.length} symbols, ${errors} error(s)`);
    }
  } catch (err) {
    console.error(`[daily-auto-trade:${market}] refresh failed:`, err);
    // Continue - use whatever bars are already in DB
  }

  // ------------------------------------------------------------------
  // 2. Sweep ALL open trades (stop/target exits across all markets)
  //    Sweep runs after fresh bars land so daily bar stop/target checks
  //    use today's final close.
  // ------------------------------------------------------------------
  try {
    const sweepResults = sweepOpenTrades('1d');
    for (const r of sweepResults) {
      if (r.action === 'still-open') continue;
      const t = r.trade;
      summary.exits.push({
        symbol:    t.symbol,
        action:    r.action,
        exitPrice: r.exitPrice,
        pnl:       t.pnl ?? undefined,
      });
      const pnlStr = t.pnl != null ? ` P&L: $${t.pnl.toFixed(2)}` : '';
      await tg(
        `[DAILY-EXIT:${market.toUpperCase()}] ${t.symbol} ${t.side.toUpperCase()} - ${r.action.toUpperCase()}` +
        `\nExit: $${r.exitPrice?.toFixed(2) ?? '?'}${pnlStr}`,
      );
    }
  } catch (err) {
    console.error(`[daily-auto-trade:${market}] sweep failed:`, err);
  }

  // ------------------------------------------------------------------
  // 3. Account state + halt checks
  // ------------------------------------------------------------------
  const cashAcc = computeCashAccount();
  let equity = cashAcc?.startingBalance ?? 0;

  if (cashAcc) {
    const marks = markOpenTrades('1d');
    const unrealizedUSD = marks.reduce((s, m) => s + toUSD(m.unrealizedPnl, m.trade.currency), 0);
    const acc = buildAccountSummary(cashAcc, unrealizedUSD);
    equity = acc.equity;

    // Daily loss halt (account-wide)
    const closedToday = getPaperTrades({ status: 'closed' }).filter(
      (t) => t.exitTime?.slice(0, 10) === todayUTC(),
    );
    const realizedToday = closedToday.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const dayLoss = realizedToday + unrealizedUSD;
    if (dayLoss < -(cfg.dailyLossHaltPct * equity)) {
      summary.halted     = true;
      summary.haltReason = `Daily loss halt: day P&L $${dayLoss.toFixed(2)} exceeds -${(cfg.dailyLossHaltPct * 100).toFixed(0)}% of equity`;
      await tg(`[DAILY-AUTO-TRADE:${market.toUpperCase()}] HALT - ${summary.haltReason}`);
      summary.durationMs = Date.now() - t0;
      return summary;
    }
  }

  if (!cashAcc) {
    // No budget set - cannot enforce drawdown breaker; skip entries
    summary.skips.push({ symbol: '*', reason: 'no-budget', details: 'Set budget in /settings to enable daily entries' });
    summary.durationMs = Date.now() - t0;
    return summary;
  }

  // ------------------------------------------------------------------
  // 4. Per-market daily trade cap
  // ------------------------------------------------------------------
  const openedTodayMarket = getPaperTrades().filter(
    (t) => t.entryTime.slice(0, 10) === todayUTC() &&
           t.strategyId !== 'manual' &&
           t.market === market,
  );
  if (openedTodayMarket.length >= cfg.maxTradesPerDay) {
    summary.halted     = true;
    summary.haltReason = `Max trades/day for ${market}: ${openedTodayMarket.length}/${cfg.maxTradesPerDay}`;
    summary.durationMs = Date.now() - t0;
    return summary;
  }

  // ------------------------------------------------------------------
  // 5. Scan for signals (daily bars, this market only)
  // ------------------------------------------------------------------
  const symbols = universe.map((e) => e.symbol);
  const scanResult = scanAll({
    symbols,
    timeframe:    '1d',
    persist:      true,
    excludeToday: false, // cron fires after market close - today's bar is final
    logRun:       { trigger: 'eod-cron' },
    market,
  });
  summary.signals = scanResult.signals.length;

  const strategies    = listLiveStrategies();
  const totalStrats   = strategies.length;

  const consensus = buildConsensus(scanResult.signals, totalStrats)
    .filter((c) => c.agreeCount >= cfg.minConsensus);

  // ------------------------------------------------------------------
  // 6. Execute entries
  // ------------------------------------------------------------------
  const stoppedTodaySyms = new Set(
    getPaperTrades({ status: 'closed' })
      .filter((t) => t.exitTime?.slice(0, 10) === todayUTC() && (t.pnl ?? 0) < 0)
      .map((t) => t.symbol),
  );

  for (const c of consensus) {
    if (summary.halted) break;

    const sym = c.symbol;

    // Per-market cap (re-check including trades opened this tick)
    if (openedTodayMarket.length + summary.entries.length >= cfg.maxTradesPerDay) {
      summary.skips.push({ symbol: sym, reason: 'max-trades-per-day' });
      continue;
    }

    // Existing active position
    if (getActivePaperTradeBySymbol(sym)) {
      summary.skips.push({ symbol: sym, reason: 'position-exists' });
      continue;
    }

    // Anti-revenge: no re-entry same day after a loss
    if (stoppedTodaySyms.has(sym)) {
      summary.skips.push({ symbol: sym, reason: 'no-re-entry-today' });
      continue;
    }

    // Load bars for recommend
    const bars = getRecentBars(sym, '1d', 600);
    if (bars.length < 20) {
      summary.skips.push({ symbol: sym, reason: 'insufficient-bars' });
      continue;
    }

    // Get stopPct/targetPct from lead strategy
    const leadStrategyId = c.strategyIds[0];
    const leadStrategy   = getStrategy(leadStrategyId);
    let stopPct: number | undefined;
    let targetPct: number | undefined;
    try {
      const params = leadStrategy.params.parse({});
      const res    = scanSymbol(sym, bars, leadStrategy, params);
      stopPct      = res?.decision.stopPct;
      targetPct    = res?.decision.targetPct;
    } catch { /* fall through to ATR fallback */ }

    const proxySignal: Signal = {
      symbol:     sym,
      time:       bars[bars.length - 1].time,
      side:       c.side,
      strategyId: leadStrategyId,
      reason:     c.strategyIds.map((id) => c.reasons[id]).join(' | '),
      market,
    };

    const idea = recommendTrade(proxySignal, bars, { stopPct, targetPct }, { equity });
    if (!idea) {
      summary.skips.push({ symbol: sym, reason: 'recommend-failed', details: 'Insufficient ATR data' });
      continue;
    }

    const cappedIdea = capIdeaToCash(idea, cashAcc.cash, equity);
    if (cappedIdea.qty <= 0) {
      summary.skips.push({ symbol: sym, reason: 'no-budget', details: `Capped qty=0` });
      continue;
    }

    const entryObj: DailyAutoTradeEntry = {
      symbol:      sym,
      side:        c.side,
      qty:         cappedIdea.qty,
      entryPrice:  cappedIdea.entryPrice,
      stopPrice:   cappedIdea.stopPrice,
      targetPrice: cappedIdea.targetPrice,
      rr:          cappedIdea.rr,
      strategyIds: c.strategyIds,
      dryRun:      cfg.dryRun,
    };

    const entryMsg = [
      `[DAILY-${cfg.dryRun ? 'INTENDED' : 'ENTRY'}:${market.toUpperCase()}] ${sym} ${c.side.toUpperCase()}`,
      `Entry: ${cappedIdea.entryPrice.toFixed(4)}  Stop: ${cappedIdea.stopPrice.toFixed(4)}  Target: ${cappedIdea.targetPrice.toFixed(4)}`,
      `Qty: ${cappedIdea.qty.toFixed(4)}  Risk: ${cappedIdea.riskAmount.toFixed(2)}  R:R ${cappedIdea.rr.toFixed(2)}`,
      `Strategies (${c.agreeCount}/${totalStrats}): ${c.strategyIds.join(', ')}`,
    ].join('\n');

    if (cfg.dryRun) {
      summary.entries.push(entryObj);
      await tg(entryMsg);
      continue;
    }

    // Live paper entry
    try {
      const stopPctComputed   = cappedIdea.stopPrice  > 0
        ? Math.abs(cappedIdea.entryPrice - cappedIdea.stopPrice)  / cappedIdea.entryPrice
        : undefined;
      const targetPctComputed = cappedIdea.targetPrice > 0
        ? Math.abs(cappedIdea.targetPrice - cappedIdea.entryPrice) / cappedIdea.entryPrice
        : undefined;

      const latestBar = getLatestBarTime(sym, '1d');
      const journalWhy = {
        leadStrategyId,
        allStrategyIds:  c.strategyIds,
        agreeCount:      c.agreeCount,
        totalStrategies: totalStrats,
        signalReasons:   Object.fromEntries(c.strategyIds.map((id) => [id, c.reasons[id] ?? ''])),
        market,
        latestBarTime:   latestBar,
        equity,
        rr:              cappedIdea.rr,
      };

      openPaperTrade({
        strategyId:     leadStrategyId,
        symbol:         sym,
        side:           c.side,
        entryPrice:     cappedIdea.entryPrice,
        entryTime:      proxySignal.time,
        stopPct:        stopPctComputed,
        targetPct:      targetPctComputed,
        _overrideQty:   cappedIdea.qty,
        notes:          `daily:${market}:${c.strategyIds.join(',')} consensus=${c.agreeCount}/${totalStrats}`,
        market,
        journalWhy,
      });

      summary.entries.push(entryObj);
      await tg(entryMsg);
    } catch (err) {
      if (err instanceof DuplicateOpenTradeError) {
        summary.skips.push({ symbol: sym, reason: 'position-exists', details: 'duplicate at broker' });
      } else if (err instanceof RiskCheckError) {
        summary.skips.push({ symbol: sym, reason: 'risk-check', details: err.message });
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        summary.skips.push({ symbol: sym, reason: 'broker-error', details: msg });
        console.error(`[daily-auto-trade:${market}] openPaperTrade failed for ${sym}:`, err);
      }
    }
  }

  // ------------------------------------------------------------------
  // 7. Daily digest
  // ------------------------------------------------------------------
  const totalActivity = summary.entries.length + summary.exits.length;
  if (totalActivity > 0 || summary.halted) {
    await tg(
      [
        `[DAILY-AUTO-TRADE:${market.toUpperCase()}] Scan complete`,
        `Signals: ${summary.signals}  Entries: ${summary.entries.length}  Exits: ${summary.exits.length}  Skips: ${summary.skips.length}`,
        summary.halted ? `HALTED: ${summary.haltReason}` : null,
        cfg.dryRun ? 'DRY RUN - no real trades opened' : null,
      ].filter(Boolean).join('\n'),
    );
  }

  summary.durationMs = Date.now() - t0;
  return summary;
}
