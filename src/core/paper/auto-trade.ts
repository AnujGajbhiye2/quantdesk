/**
 * Automated intraday paper-trading engine.
 *
 * Called on each intraday cron tick. Per run:
 *   1. Guard: skip unless AUTO_TRADE_ENABLED=1 and US market is open.
 *   2. Sweep open trades: close any that hit stop / target / time-stop.
 *   3. Scan for entries: run all strategies on intraday bars, build consensus.
 *   4. Psychology filters: daily-loss halt, max-trades-per-day, no re-entry
 *      on stopped-out symbol, no entry in last 30 min before close.
 *   5. Size + execute: risk-based qty (1% equity/trade) -> capIdeaToCash ->
 *      openPaperTrade (broker enforces budget + risk gate + duplicate check).
 *   6. Telegram every entry and exit.
 *
 * All gates configurable via env (see auto-trade-config.ts).
 * Server-only: never imported from client components.
 */
import 'server-only';

import type { Timeframe } from '@/core/types';
import { isUsMarketOpen, isNearMarketClose, etTimeString } from '@/core/market/hours';
import { autoTradeUniverse } from '@/core/data/universe';
import { getRecentBars } from '@/core/db/bars';
import { getActivePaperTradeBySymbol, getPaperTrades } from '@/core/db/paper';
import { openPaperTrade, sweepOpenTrades, DuplicateOpenTradeError } from '@/core/paper/broker';
import { markOpenTrades } from '@/core/paper/broker';
import { computeCashAccount, buildAccountSummary } from '@/core/paper/account';
import { list as listStrategies, get as getStrategy } from '@/core/strategy/registry';
import { scanSymbol } from '@/core/scan/scanner';
import { buildConsensus } from '@/core/scan/consensus';
import type { ConsensusSignal } from '@/core/scan/consensus';
import { recommendTrade, capIdeaToCash } from '@/core/signals/recommend';
import { sendTelegram, telegramConfigured } from '@/core/notify/telegram';
import type { SweepResult } from '@/core/paper/broker';
import { isTradingHalted } from '@/core/paper/halt';
import { classifyFreshness } from '@/core/notify/freshness';
import { getLatestBarTime } from '@/core/db/bars';
import { getFlag, setFlag } from '@/core/db/flags';

// ---------------------------------------------------------------------------
// Config (all from env with safe defaults)
// ---------------------------------------------------------------------------

interface AutoTradeConfig {
  /** Auto-trading enabled flag. */
  enabled: boolean;
  /** Dry-run: compute + Telegram intended entries but do not open positions. */
  dryRun: boolean;
  /** Intraday timeframe for bar ingest and scanning. */
  timeframe: Timeframe;
  /** Minimum number of strategies that must agree for a consensus entry. */
  minConsensus: number;
  /** Max paper trades opened by the auto-trader in a single calendar day. */
  maxTradesPerDay: number;
  /**
   * Daily loss halt threshold as a fraction of equity (e.g. 0.03 = 3%).
   * When realized + unrealized P&L drops below -threshold * equity, no new
   * entries are placed for the rest of the session.
   */
  dailyLossHaltPct: number;
}

function loadConfig(): AutoTradeConfig {
  const tf = (process.env.AUTO_TRADE_TIMEFRAME ?? '15m') as Timeframe;
  return {
    enabled:          process.env.AUTO_TRADE_ENABLED === '1',
    dryRun:           process.env.AUTO_TRADE_DRY_RUN === '1',
    timeframe:        tf,
    minConsensus:     parseInt(process.env.AUTO_TRADE_MIN_CONSENSUS ?? '2', 10),
    maxTradesPerDay:  parseInt(process.env.AUTO_TRADE_MAX_TRADES_PER_DAY ?? '5', 10),
    dailyLossHaltPct: parseFloat(process.env.AUTO_TRADE_DAILY_LOSS_HALT_PCT ?? '0.03'),
  };
}

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

export interface AutoTradeEntry {
  symbol:        string;
  side:          'long' | 'short';
  qty:           number;
  entryPrice:    number;
  stopPrice:     number;
  targetPrice:   number;
  rr:            number;
  strategyIds:   string[];
  dryRun:        boolean;
}

export interface AutoTradeExit {
  symbol:        string;
  action:        'stopped' | 'targeted' | 'expired' | 'still-open';
  exitPrice?:    number;
  pnl?:          number;
  pnlPct?:       number;
}

export type SkipReason =
  | 'position-exists'
  | 'below-min-consensus'
  | 'daily-loss-halt'
  | 'max-trades-per-day'
  | 'no-re-entry-today'
  | 'near-close'
  | 'no-budget'
  | 'recommend-failed'
  | 'broker-error';

export interface AutoTradeSkip {
  symbol:      string;
  reason:      SkipReason;
  details?:    string;
}

export interface AutoTradeSummary {
  enabled:         boolean;
  dryRun:          boolean;
  marketOpen:      boolean;
  halted:          boolean;
  haltReason?:     string;
  entries:         AutoTradeEntry[];
  exits:           AutoTradeExit[];
  skips:           AutoTradeSkip[];
  durationMs:      number;
  etTime:          string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Today's date in ET local time as 'YYYY-MM-DD'. */
function todayET(): string {
  const now    = new Date();
  const offset = now.getTimezoneOffset(); // not reliable in server env; use UTC offset calc
  // Approximate: ET is UTC-4 (summer) or UTC-5 (winter). Use the hours gate:
  // entry_time in DB is ISO; for "today" comparisons we just want the UTC date.
  // Close enough for the anti-revenge filter (re-entry on stopped-out symbol).
  return now.toISOString().slice(0, 10);
}

async function tg(text: string): Promise<void> {
  if (!telegramConfigured()) return;
  try { await sendTelegram(text); } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runAutoTrade(
  opts: { timeframe?: Timeframe; bypassMarketHours?: boolean } = {},
): Promise<AutoTradeSummary> {
  const t0     = Date.now();
  const cfg    = loadConfig();
  const tf     = opts.timeframe ?? cfg.timeframe;
  const now    = new Date();
  const etTime = etTimeString(now);

  const summary: AutoTradeSummary = {
    enabled:    cfg.enabled,
    dryRun:     cfg.dryRun,
    marketOpen: false,
    halted:     false,
    entries:    [],
    exits:      [],
    skips:      [],
    durationMs: 0,
    etTime,
  };

  // ------------------------------------------------------------------
  // 1. Guard: must be enabled and market must be open
  // ------------------------------------------------------------------
  if (!cfg.enabled) {
    summary.durationMs = Date.now() - t0;
    return summary;
  }

  const marketOpen = opts.bypassMarketHours || isUsMarketOpen(now);
  summary.marketOpen = marketOpen;

  if (!marketOpen) {
    summary.durationMs = Date.now() - t0;
    return summary;
  }

  // ------------------------------------------------------------------
  // 2. Sweep open trades (exits first - free up capital + know today's P&L)
  // ------------------------------------------------------------------
  let sweepResults: SweepResult[] = [];
  try {
    sweepResults = sweepOpenTrades(tf);
  } catch (err) {
    console.error('[auto-trade] sweepOpenTrades failed:', err);
  }

  for (const r of sweepResults) {
    if (r.action === 'still-open') continue;
    const trade = r.trade;
    const exit: AutoTradeExit = {
      symbol:    trade.symbol,
      action:    r.action,
      exitPrice: r.exitPrice,
      pnl:       trade.pnl ?? undefined,
      pnlPct:    trade.pnlPct ?? undefined,
    };
    summary.exits.push(exit);

    const pnlStr  = trade.pnl != null ? `P&L: $${trade.pnl.toFixed(2)} (${((trade.pnlPct ?? 0) * 100).toFixed(2)}%)` : '';
    const exitMsg = [
      `[AUTO-EXIT] ${trade.symbol} ${trade.side.toUpperCase()} - ${r.action.toUpperCase()}`,
      `Exit: $${r.exitPrice?.toFixed(2) ?? '?'}  ${pnlStr}`,
      cfg.dryRun ? '(DRY RUN - sweep is always live)' : '',
    ].filter(Boolean).join('\n');
    await tg(exitMsg);
  }

  // ------------------------------------------------------------------
  // 3. Determine today's auto-trade count (for max-trades-per-day gate)
  // ------------------------------------------------------------------
  const today            = todayET();
  const allTrades        = getPaperTrades({ status: 'open' });
  const closedToday      = getPaperTrades({ status: 'closed' }).filter(
    (t) => t.exitTime?.slice(0, 10) === today,
  );
  const openedTodayAuto  = getPaperTrades().filter(
    (t) => t.entryTime.slice(0, 10) === today && t.strategyId !== 'manual',
  );
  const stoppedTodaySyms = new Set(
    closedToday
      .filter((t) => t.strategyId !== 'manual' && (t.pnl ?? 0) < 0)
      .map((t) => t.symbol),
  );

  // ------------------------------------------------------------------
  // 4. Daily-loss halt check
  // ------------------------------------------------------------------
  const cashAcc = computeCashAccount();
  let equity    = cashAcc?.startingBalance ?? 10_000;

  if (cashAcc) {
    // Mark open trades to get unrealized
    const marks = markOpenTrades(tf);
    const unrealizedUSD = marks.reduce((s, m) => s + m.unrealizedPnl, 0);
    const acc   = buildAccountSummary(cashAcc, unrealizedUSD);
    equity      = acc.equity;

    // Daily loss = realized P&L on auto trades that closed today + unrealized on opens
    const realizedToday = closedToday
      .filter((t) => t.strategyId !== 'manual')
      .reduce((s, t) => s + (t.pnl ?? 0), 0);
    const dayLoss = realizedToday + unrealizedUSD;

    if (dayLoss < -(cfg.dailyLossHaltPct * equity)) {
      summary.halted     = true;
      summary.haltReason = `Daily loss halt: day P&L $${dayLoss.toFixed(2)} exceeds -${(cfg.dailyLossHaltPct * 100).toFixed(0)}% of equity $${equity.toFixed(0)}`;
      await tg(`[AUTO-TRADE] HALT - ${summary.haltReason}`);
      summary.durationMs = Date.now() - t0;
      return summary;
    }
  }

  // ------------------------------------------------------------------
  // 5. Max-trades-per-day gate
  // ------------------------------------------------------------------
  if (openedTodayAuto.length >= cfg.maxTradesPerDay) {
    summary.halted     = true;
    summary.haltReason = `Max trades/day reached: ${openedTodayAuto.length}/${cfg.maxTradesPerDay}`;
    summary.durationMs = Date.now() - t0;
    return summary;
  }

  // ------------------------------------------------------------------
  // 6. Near-close gate (no new entries in last 30 min)
  // ------------------------------------------------------------------
  const nearClose = isNearMarketClose(30, now);

  // ------------------------------------------------------------------
  // 7. Scan for entries: load intraday bars + run all strategies
  // ------------------------------------------------------------------
  const universe    = autoTradeUniverse();
  const strategies  = listStrategies().map(({ id }) => {
    const s = getStrategy(id);
    return { strategy: s, parsedParams: s.params.parse({}) };
  });
  const totalStrats = strategies.length;

  const signals: import('@/core/types').Signal[] = [];
  const barsCache = new Map<string, import('@/core/types').Bar[]>();

  for (const entry of universe) {
    const sym  = entry.symbol;
    const bars = getRecentBars(sym, tf, 600);
    if (bars.length < 20) continue; // not enough bars to generate meaningful signals
    barsCache.set(sym, bars);

    for (const { strategy, parsedParams } of strategies) {
      try {
        const res = scanSymbol(sym, bars, strategy, parsedParams);
        if (res) signals.push(res.signal);
      } catch { /* skip */ }
    }
  }

  // Build consensus: require minConsensus strategies agreeing
  const consensus = buildConsensus(signals, totalStrats).filter(
    (c) => c.agreeCount >= cfg.minConsensus,
  );

  // ------------------------------------------------------------------
  // 7b. Manual halt check (persistent kill switch set via /halt command)
  // ------------------------------------------------------------------
  const manualHalt = isTradingHalted();
  if (manualHalt.halted) {
    summary.halted     = true;
    summary.haltReason = `Manual halt: ${manualHalt.reason}`;
    // Exits (step 2) have already run above - positions keep being managed.
    // Only new entries are blocked from here.
    summary.durationMs = Date.now() - t0;
    return summary;
  }

  // ------------------------------------------------------------------
  // 7c. No-budget warning: auto-trade armed but drawdown breaker inactive
  // ------------------------------------------------------------------
  if (!cashAcc && cfg.enabled) {
    // Warn once per day max - the heartbeat also surfaces this; this is a
    // louder intraday signal so the user notices before a trading day passes.
    const warnKey = `no_budget_warned_${new Date().toISOString().slice(0, 10)}`;
    const warned  = getFlag(warnKey);
    if (!warned) {
      try { setFlag(warnKey, '1'); } catch { /* non-fatal */ }
      await tg(
        '[AUTO-TRADE] WARNING: AUTO_TRADE_ENABLED=1 but no budget is set.\n' +
        'The drawdown circuit-breaker is INACTIVE and no trades will open.\n' +
        'Set a budget in /settings to activate the breaker and enable entries.',
      );
    }
  }

  // ------------------------------------------------------------------
  // 8. For each consensus signal: psychology filters -> size -> execute
  // ------------------------------------------------------------------
  for (const c of consensus) {
    const sym  = c.symbol;
    const bars = barsCache.get(sym);
    if (!bars || bars.length === 0) continue;

    // Position already exists (open or pending)?
    const existing = getActivePaperTradeBySymbol(sym);
    if (existing) {
      summary.skips.push({ symbol: sym, reason: 'position-exists' });
      continue;
    }

    // Near-close gate
    if (nearClose) {
      summary.skips.push({ symbol: sym, reason: 'near-close', details: `ET ${etTime}` });
      continue;
    }

    // Anti-revenge: no re-entry if symbol was stopped out today
    if (stoppedTodaySyms.has(sym)) {
      summary.skips.push({ symbol: sym, reason: 'no-re-entry-today' });
      continue;
    }

    // Daily P&L halt (checked globally above, but also per-symbol when halted)
    if (summary.halted) {
      summary.skips.push({ symbol: sym, reason: 'daily-loss-halt' });
      continue;
    }

    // Max-trades-per-day (check against current count + entries so far this tick)
    if (openedTodayAuto.length + summary.entries.length >= cfg.maxTradesPerDay) {
      summary.skips.push({ symbol: sym, reason: 'max-trades-per-day' });
      continue;
    }

    // Budget check
    if (!cashAcc) {
      summary.skips.push({ symbol: sym, reason: 'no-budget', details: 'Set budget in /settings' });
      continue;
    }

    // Build a representative StrategyDecision from the strongest agreeing strategy
    const leadStrategyId = c.strategyIds[0];
    const leadStrategy   = getStrategy(leadStrategyId);
    const leadSignal     = signals.find(
      (s) => s.symbol === sym && s.strategyId === leadStrategyId,
    );

    // Re-run to get stopPct/targetPct from the strategy decision
    let stopPct: number | undefined;
    let targetPct: number | undefined;
    try {
      const params = leadStrategy.params.parse({});
      const res    = scanSymbol(sym, bars, leadStrategy, params);
      stopPct      = res?.decision.stopPct;
      targetPct    = res?.decision.targetPct;
    } catch { /* use undefined - recommendTrade falls back to ATR */ }

    // Synthesize a signal for recommendTrade
    const proxySignal: import('@/core/types').Signal = {
      symbol:     sym,
      time:       bars[bars.length - 1].time,
      side:       c.side,
      strategyId: leadStrategyId,
      reason:     c.strategyIds.map((id) => c.reasons[id]).join(' | '),
    };

    const idea = recommendTrade(
      proxySignal,
      bars,
      { stopPct, targetPct },
      { equity },
    );

    if (!idea) {
      summary.skips.push({ symbol: sym, reason: 'recommend-failed', details: 'Insufficient ATR data' });
      continue;
    }

    const cappedIdea = capIdeaToCash(idea, cashAcc.cash);
    if (cappedIdea.qty <= 0) {
      summary.skips.push({ symbol: sym, reason: 'no-budget', details: `Capped qty=0, cash=$${cashAcc.cash.toFixed(0)}` });
      continue;
    }

    const entryObj: AutoTradeEntry = {
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
      `[AUTO-${cfg.dryRun ? 'INTENDED' : 'ENTRY'}] ${sym} ${c.side.toUpperCase()}`,
      `Entry: $${cappedIdea.entryPrice.toFixed(2)}  Stop: $${cappedIdea.stopPrice.toFixed(2)}  Target: $${cappedIdea.targetPrice.toFixed(2)}`,
      `Qty: ${cappedIdea.qty.toFixed(4)}  Risk: $${cappedIdea.riskAmount.toFixed(2)}  R:R ${cappedIdea.rr.toFixed(2)}`,
      `Strategies (${c.agreeCount}/${totalStrats}): ${c.strategyIds.join(', ')}`,
    ].join('\n');

    if (cfg.dryRun) {
      summary.entries.push(entryObj);
      await tg(entryMsg);
      continue;
    }

    // Live paper entry
    try {
      const stopPctComputed  = cappedIdea.stopPrice  > 0
        ? Math.abs(cappedIdea.entryPrice - cappedIdea.stopPrice)  / cappedIdea.entryPrice
        : undefined;
      const targetPctComputed = cappedIdea.targetPrice > 0
        ? Math.abs(cappedIdea.targetPrice - cappedIdea.entryPrice) / cappedIdea.entryPrice
        : undefined;

      // Trade provenance: capture indicator values (embedded in signal reasons),
      // params used, consensus detail, and data freshness at signal time.
      const leadParams = leadStrategy.params.parse({});
      const latestBar  = getLatestBarTime(sym, tf);
      const fresh      = classifyFreshness(latestBar, now, Number(tf.replace(/\D/g, '')) * 15);
      const journalWhy = {
        leadStrategyId,
        leadParams,
        allStrategyIds:    c.strategyIds,
        agreeCount:        c.agreeCount,
        totalStrategies:   totalStrats,
        signalReasons:     Object.fromEntries(
          c.strategyIds.map((id) => [id, c.reasons[id] ?? '']),
        ),
        dataFreshness: {
          latestBarTime: latestBar,
          ageMinutes:    fresh.ageMinutes,
          stale:         fresh.stale,
          label:         fresh.label,
        },
        equity,
        rr:            cappedIdea.rr,
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
        notes:          `auto:${c.strategyIds.join(',')} consensus=${c.agreeCount}/${totalStrats}`,
        journalWhy,
      });

      summary.entries.push(entryObj);
      await tg(entryMsg);
    } catch (err) {
      if (err instanceof DuplicateOpenTradeError) {
        summary.skips.push({ symbol: sym, reason: 'position-exists', details: 'duplicate caught at broker' });
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        summary.skips.push({ symbol: sym, reason: 'broker-error', details: msg });
        console.error(`[auto-trade] openPaperTrade failed for ${sym}:`, err);
      }
    }
  }

  // ------------------------------------------------------------------
  // 9. Daily digest (only when something happened)
  // ------------------------------------------------------------------
  const totalActivity = summary.entries.length + summary.exits.length;
  if (totalActivity > 0 && telegramConfigured()) {
    const digestLines = [
      `[AUTO-TRADE] Tick ${etTime} ET | ${tf}`,
      `Entries: ${summary.entries.length}  Exits: ${summary.exits.length}  Skips: ${summary.skips.length}`,
      summary.halted ? `HALTED: ${summary.haltReason}` : null,
      cfg.dryRun ? 'DRY RUN - no real trades opened' : null,
    ].filter(Boolean).join('\n');
    await tg(digestLines);
  }

  summary.durationMs = Date.now() - t0;
  return summary;
}
