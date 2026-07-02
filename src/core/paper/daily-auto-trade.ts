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

import { acquireLock, releaseLock } from '@/core/db/lock';
import { scanAll } from '@/core/scan/scan-all';
import { buildConsensus } from '@/core/scan/consensus';
import { sweepOpenTrades } from '@/core/paper/broker';
import { openPaperTrade, DuplicateOpenTradeError, RiskCheckError } from '@/core/paper/broker';
import { computeCashAccount, buildAccountSummary } from '@/core/paper/account';
import { markOpenTrades } from '@/core/paper/broker';
import { getActivePaperTradeBySymbol, getPaperTrades } from '@/core/db/paper';
import { getLatestBarTime, getRecentBars, getAllSymbols } from '@/core/db/bars';
import { recommendTrade, capIdeaToCash } from '@/core/signals/recommend';
import { listLive as listLiveStrategies } from '@/core/strategy/registry';
import { refreshUniverse } from '@/core/data/ingest';
import { universeForMarket, type ScanMarket } from '@/core/data/universe';
import { sendTelegram, telegramConfigured } from '@/core/notify/telegram';
import { insertJournalWhy } from '@/core/db/journal';
import { toUSD } from '@/core/format/fx';
import type { Signal, PaperTrade } from '@/core/types';
import { buildEntryAlert, buildExitAlert, buildRotationAlert, buildScanDigest } from '@/core/notify/format';
import { maybeRotateForCandidate, openTradesForScope, compensateFailedRotation } from '@/core/paper/rotation';
import { isWithinEarningsBlackout, earningsBlackoutConfigFromEnv } from '@/core/paper/earnings-blackout';
import { getCachedFundamentals } from '@/core/db/research';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface DailyAutoTradeConfig {
  enabled:         boolean;
  dryRun:          boolean;
  minConsensus:    number;
  maxTradesPerDay: number;
  dailyLossHaltPct: number;
  /** Fraction of equity risked per trade for sizing. Default 0.01 (1%). */
  riskPct: number;
}

function loadConfig(): DailyAutoTradeConfig {
  return {
    enabled:          process.env.DAILY_AUTO_TRADE_ENABLED === '1',
    dryRun:           process.env.DAILY_AUTO_TRADE_DRY_RUN === '1',
    minConsensus:     parseInt(process.env.DAILY_AUTO_TRADE_MIN_CONSENSUS ?? '2', 10),
    maxTradesPerDay:  parseInt(process.env.DAILY_AUTO_TRADE_MAX_TRADES_PER_DAY ?? '3', 10),
    dailyLossHaltPct: parseFloat(process.env.DAILY_AUTO_TRADE_DAILY_LOSS_HALT_PCT ?? '0.03'),
    riskPct:          parseFloat(process.env.RISK_PER_TRADE_PCT ?? '0.01'),
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

export interface DailyAutoTradeRotation {
  closedSymbol: string;
  openedSymbol: string;
}

export interface DailyAutoTradeSummary {
  market:     ScanMarket;
  enabled:    boolean;
  dryRun:     boolean;
  halted:     boolean;
  haltReason?: string;
  entries:    DailyAutoTradeEntry[];
  exits:      { symbol: string; action: string; exitPrice?: number; pnl?: number }[];
  rotations:  DailyAutoTradeRotation[];
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
  try { await sendTelegram(msg, { parseMode: 'HTML' }); } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Public entry point. Wraps runDailyAutoTradeInner with a per-market overlap
 * lock - each market bucket runs independently, but two ticks for the SAME
 * market must not race on the same open positions (finding #9).
 */
export async function runDailyAutoTrade(
  opts: { market: ScanMarket },
): Promise<DailyAutoTradeSummary> {
  const lockKey = `daily-auto-trade-${opts.market}`;
  if (!acquireLock(lockKey)) {
    return {
      market: opts.market, enabled: true, dryRun: false, halted: true,
      haltReason: `Skipped: a previous ${opts.market} daily auto-trade run is still in progress (overlap lock held).`,
      entries: [], exits: [], rotations: [], skips: [], signals: 0, durationMs: 0,
    };
  }
  try {
    return await runDailyAutoTradeInner(opts);
  } finally {
    releaseLock(lockKey);
  }
}

/**
 * Run a single daily market scan: refresh -> scan -> execute -> digest.
 * Called by per-market crons in instrumentation.ts.
 *
 * Returns summary even when disabled (enabled: false, entries/exits empty).
 */
async function runDailyAutoTradeInner(
  opts: { market: ScanMarket },
): Promise<DailyAutoTradeSummary> {
  const t0  = Date.now();
  const cfg = loadConfig();
  const { market } = opts;
  const earningsBlackout = earningsBlackoutConfigFromEnv();

  const summary: DailyAutoTradeSummary = {
    market,
    enabled:    cfg.enabled,
    dryRun:     cfg.dryRun,
    halted:     false,
    entries:    [],
    exits:      [],
    rotations:  [],
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
  let sweepFailed = false;
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
      await tg(buildExitAlert({
        market:    t.market ?? market,
        symbol:    t.symbol,
        side:      t.side,
        currency:  t.currency,
        action:    r.action,
        exitPrice: r.exitPrice,
        pnl:       t.pnl ?? undefined,
        pnlPct:    t.pnlPct ?? undefined,
      }));
    }
  } catch (err) {
    sweepFailed = true;
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
  // 4b. A failed sweep means open stops/targets weren't checked this cycle -
  // don't compound that by opening new, also-unmanaged positions on top of
  // it (SYSTEM_AUDIT_AND_ROADMAP.md finding #9). Exits already attempted
  // above; only new entries are blocked here.
  // ------------------------------------------------------------------
  if (sweepFailed) {
    summary.halted     = true;
    summary.haltReason = `Sweep failed for ${market} this cycle - blocking new entries until next run.`;
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

  // Decisions (incl. stopPct/targetPct) captured at scan time, keyed by
  // `${symbol}:${strategyId}` - reused at execution instead of re-running
  // scanSymbol, so the executed stop/target always matches what generated
  // this consensus (SYSTEM_AUDIT_AND_ROADMAP.md finding, Phase 2).
  const decisionCache = new Map(
    scanResult.rawResults.map((r) => [`${r.signal.symbol}:${r.signal.strategyId}`, r.decision]),
  );

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

    // Earnings blackout: no entry within N days of a known earnings date.
    // Fails open when the fetch config is off or no earnings date is
    // cached for this symbol - see earnings-blackout.ts.
    if (earningsBlackout) {
      const fundamentals = getCachedFundamentals(sym);
      if (isWithinEarningsBlackout(fundamentals?.nextEarningsDate ?? null, todayUTC(), earningsBlackout.blackoutDays)) {
        summary.skips.push({ symbol: sym, reason: 'earnings-blackout', details: `earnings ${fundamentals?.nextEarningsDate}` });
        continue;
      }
    }

    // Load bars for recommend
    const bars = getRecentBars(sym, '1d', 600);
    if (bars.length < 20) {
      summary.skips.push({ symbol: sym, reason: 'insufficient-bars' });
      continue;
    }

    // stopPct/targetPct from the decision captured at scan time - not a
    // re-run - so the executed bracket matches what generated this signal.
    const leadStrategyId = c.strategyIds[0];
    const leadDecision   = decisionCache.get(`${sym}:${leadStrategyId}`);
    const stopPct   = leadDecision?.stopPct;
    const targetPct = leadDecision?.targetPct;

    const proxySignal: Signal = {
      symbol:     sym,
      time:       bars[bars.length - 1].time,
      side:       c.side,
      strategyId: leadStrategyId,
      reason:     c.strategyIds.map((id) => c.reasons[id]).join(' | '),
      market,
    };

    const idea = recommendTrade(proxySignal, bars, { stopPct, targetPct }, { equity, riskPct: cfg.riskPct });
    if (!idea) {
      summary.skips.push({ symbol: sym, reason: 'recommend-failed', details: 'Insufficient ATR data' });
      continue;
    }

    let cappedIdea = capIdeaToCash(idea, cashAcc.cash, equity);
    const currency = getAllSymbols().find((s) => s.symbol === sym)?.currency ?? 'USD';

    // Tracks a rotation that already happened via the cash-cap path below, so
    // the primary open attempt further down can (a) compensate if it still
    // fails and (b) skip triggering a second, compounding rotation.
    let rotatedIncumbent: PaperTrade | null = null;

    // Rotation attempt #1: book is cash-capped in this market - see if a
    // weaker holding in the same market should be closed to make room.
    if (cappedIdea.qty <= 0) {
      const rotated = maybeRotateForCandidate(
        { symbol: sym, agreeCount: c.agreeCount },
        market,
        openTradesForScope(market),
      );
      if (rotated) {
        const freshCash = computeCashAccount();
        if (freshCash) cappedIdea = capIdeaToCash(idea, freshCash.cash, equity);

        // The incumbent is closed now - if freeing that cash still isn't
        // enough to size the candidate, don't leave the book down one
        // position for nothing (SYSTEM_AUDIT_AND_ROADMAP.md finding #6).
        if (cappedIdea.qty <= 0) {
          const restored = compensateFailedRotation(rotated.closed);
          summary.skips.push({
            symbol: sym,
            reason: 'no-budget',
            details: restored
              ? `Rotation freed insufficient cash. Restored ${rotated.closed.symbol}.`
              : `Rotation freed insufficient cash. FAILED to restore ${rotated.closed.symbol} - book is down one position.`,
          });
          if (!restored) {
            console.error(`[daily-auto-trade:${market}] rotation compensation failed for ${rotated.closed.symbol} after ${sym} still had qty=0`);
          }
          continue;
        }

        summary.rotations.push({ closedSymbol: rotated.closed.symbol, openedSymbol: sym });
        await tg(buildRotationAlert({
          market, closedSymbol: rotated.closed.symbol,
          closedPnlPct: rotated.closedPnlPct ?? undefined, closedAgree: rotated.closedAgree,
          openedSymbol: sym, openedAgree: c.agreeCount, totalStrats,
        }));
        rotatedIncumbent = rotated.closed;
      }
    }

    if (cappedIdea.qty <= 0) {
      summary.skips.push({ symbol: sym, reason: 'no-budget', details: `Capped qty=0` });
      continue;
    }

    const buildEntryObj = (idea2: typeof cappedIdea): DailyAutoTradeEntry => ({
      symbol:      sym,
      side:        c.side,
      qty:         idea2.qty,
      entryPrice:  idea2.entryPrice,
      stopPrice:   idea2.stopPrice,
      targetPrice: idea2.targetPrice,
      rr:          idea2.rr,
      strategyIds: c.strategyIds,
      dryRun:      cfg.dryRun,
    });

    const entryAlert = (idea2: typeof cappedIdea): string => buildEntryAlert({
      market,
      symbol:      sym,
      side:        c.side,
      currency,
      entryPrice:  idea2.entryPrice,
      stopPrice:   idea2.stopPrice,
      targetPrice: idea2.targetPrice,
      qty:         idea2.qty,
      riskAmount:  idea2.riskAmount,
      riskPct:     cfg.riskPct,
      rr:          idea2.rr,
      agreeCount:  c.agreeCount,
      totalStrats,
      strategyIds: c.strategyIds,
      live:        !cfg.dryRun,
    });

    if (cfg.dryRun) {
      summary.entries.push(buildEntryObj(cappedIdea));
      await tg(entryAlert(cappedIdea));
      continue;
    }

    // Live paper entry - tries once, and if blocked by a risk-check rule
    // (book full), attempts one capital rotation and retries once.
    const tryOpen = (idea2: typeof cappedIdea): void => {
      const stopPctComputed   = idea2.stopPrice  > 0
        ? Math.abs(idea2.entryPrice - idea2.stopPrice)  / idea2.entryPrice
        : undefined;
      const targetPctComputed = idea2.targetPrice > 0
        ? Math.abs(idea2.targetPrice - idea2.entryPrice) / idea2.entryPrice
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
        rr:              idea2.rr,
      };

      openPaperTrade({
        strategyId:     leadStrategyId,
        symbol:         sym,
        side:           c.side,
        entryPrice:     idea2.entryPrice,
        entryTime:      proxySignal.time,
        stopPct:        stopPctComputed,
        targetPct:      targetPctComputed,
        _overrideQty:   idea2.qty,
        notes:          `daily:${market}:${c.strategyIds.join(',')} consensus=${c.agreeCount}/${totalStrats}`,
        market,
        journalWhy,
      });
    };

    try {
      tryOpen(cappedIdea);
      summary.entries.push(buildEntryObj(cappedIdea));
      await tg(entryAlert(cappedIdea));
    } catch (err) {
      if (err instanceof DuplicateOpenTradeError) {
        summary.skips.push({ symbol: sym, reason: 'position-exists', details: 'duplicate at broker' });
      } else if (err instanceof RiskCheckError && rotatedIncumbent) {
        // Rotation #1 already closed a position to free cash for this
        // candidate; don't fire a second, compounding rotation on top of
        // it. Compensate for the one we already did.
        const restored = compensateFailedRotation(rotatedIncumbent);
        const msg = err.message;
        summary.skips.push({
          symbol: sym,
          reason: 'risk-check',
          details: restored
            ? `Open failed after cash-cap rotation: ${msg}. Restored ${rotatedIncumbent.symbol}.`
            : `Open failed after cash-cap rotation: ${msg}. FAILED to restore ${rotatedIncumbent.symbol} - book is down one position.`,
        });
        if (!restored) {
          console.error(`[daily-auto-trade:${market}] rotation compensation failed for ${rotatedIncumbent.symbol} after ${sym} open failure`);
        }
      } else if (err instanceof RiskCheckError) {
        const rotated = maybeRotateForCandidate(
          { symbol: sym, agreeCount: c.agreeCount },
          market,
          openTradesForScope(market),
        );
        if (!rotated) {
          summary.skips.push({ symbol: sym, reason: 'risk-check', details: err.message });
        } else {
          summary.rotations.push({ closedSymbol: rotated.closed.symbol, openedSymbol: sym });
          await tg(buildRotationAlert({
            market, closedSymbol: rotated.closed.symbol,
            closedPnlPct: rotated.closedPnlPct ?? undefined, closedAgree: rotated.closedAgree,
            openedSymbol: sym, openedAgree: c.agreeCount, totalStrats,
          }));
          try {
            tryOpen(cappedIdea);
            summary.entries.push(buildEntryObj(cappedIdea));
            await tg(entryAlert(cappedIdea));
          } catch (retryErr) {
            const msg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            const restored = compensateFailedRotation(rotated.closed);
            summary.skips.push({
              symbol: sym,
              reason: 'risk-check',
              details: restored
                ? `post-rotation retry failed: ${msg}. Restored ${rotated.closed.symbol}.`
                : `post-rotation retry failed: ${msg}. FAILED to restore ${rotated.closed.symbol} - book is down one position.`,
            });
            if (!restored) {
              console.error(`[daily-auto-trade:${market}] rotation compensation failed for ${rotated.closed.symbol} after ${sym} retry failure`);
            }
          }
        }
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
    await tg(buildScanDigest({
      market,
      runLabel:          'EOD scan',
      scanned:           symbols.length,
      signals:           summary.signals,
      entries:           summary.entries.length,
      exits:             summary.exits.length,
      rotations:         summary.rotations.length,
      skips:             summary.skips.length,
      openedSymbols:     summary.entries.map((e) => e.symbol),
      closedSymbols:     summary.exits.map((e) => e.symbol),
      rotatedOutSymbols: summary.rotations.map((r) => r.closedSymbol),
      halted:            summary.halted,
      haltReason:        summary.haltReason,
      dryRun:            cfg.dryRun,
    }));
  }

  summary.durationMs = Date.now() - t0;
  return summary;
}
