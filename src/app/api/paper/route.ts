import { NextResponse } from 'next/server';
import {
  openPaperTrade,
  createPendingTrade,
  fillPendingTradesWithQuotes,
  closePaperTrade,
  markOpenTrades,
  markOpenTradesWithQuotes,
  projectTrade,
  sweepOpenTrades,
  DuplicateOpenTradeError,
  InsufficientFundsError,
  BankruptError,
  RiskCheckError,
} from '@/core/paper/broker';
import { cancelPendingPaperTrade } from '@/core/db/paper';
import { currentExposure } from '@/core/risk/exposure';
import { buildTradeBook } from '@/core/paper/tradebook';
import { withEstHold } from '@/core/paper/hold';
import { accountSummary } from '@/core/paper/summary';
import { computeEquityHistory } from '@/core/paper/account';
import { buildReconcileReport } from '@/core/paper/reconcile';
import { buildPerformanceMetrics } from '@/core/paper/perf';
import { buildReport } from '@/core/paper/report';
import { setStartingBalance } from '@/core/db/account';
import { getPaperTrades } from '@/core/db/paper';
import { openTradingViewChart } from '@/core/tradingview/open';
import { requireUser, requireAdmin, AuthError } from '@/core/auth/guard';

// Read actions: any logged-in user (executed trades + performance are
// visible, not just admin - see plan "open up trades + performance").
// Everything else mutates the live book and stays admin-only.
const READ_ACTIONS = new Set([
  'list', 'tradebook', 'account', 'equity-history', 'performance',
  'reconcile', 'mark', 'project', 'auto-status', 'risk', 'report',
]);

/**
 * POST /api/paper
 *
 * Single endpoint dispatched by `action` field.
 *
 * Actions:
 *
 *   open      — Open a new paper trade.
 *               Body: { action, strategyId, symbol, side, entryPrice, entryTime,
 *                       sizePct?, stopPct?, targetPct?, equity?, commission?,
 *                       slippagePct?, notes? }
 *
 *   close     — Close an open paper trade.
 *               Body: { action, id, exitPrice, exitTime, commission?, slippagePct? }
 *
 *   mark      — Mark all open trades to latest stored close.
 *               Body: { action, timeframe? }
 *
 *   project   — Simulate buy-and-hold over a historical window.
 *               Body: { action, symbol, entryDate, holdingBars, timeframe?,
 *                       commission?, slippagePct? }
 *
 *   tradebook — Aggregate stats across all paper trades.
 *               Body: { action }
 *
 *   list      — List paper trades, optionally filtered.
 *               Body: { action, status?, strategyId? }
 *
 *   report    — Full JSON export bundle (account, performance, tradebook,
 *               reconcile, trades, latest scan snapshot) for external
 *               analysis. Optionally scoped to a date window.
 *               Body: { action, from?, to? }  (ISO 'YYYY-MM-DD', inclusive)
 */
export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const { action } = body;

    // Executed trades + performance are visible to any logged-in user;
    // every action that opens/closes/mutates the book stays admin-only.
    if (READ_ACTIONS.has(action as string)) {
      await requireUser();
    } else {
      await requireAdmin();
    }

    switch (action) {
      case 'open': {
        const entryPrice  = body.entryPrice as number;
        const orderType   = (body.orderType as string | undefined) ?? 'market';

        // Support direct absolute stopPrice/targetPrice in addition to pct-based
        let stopPct  = body.stopPct  as number | undefined;
        let targetPct = body.targetPct as number | undefined;
        if (body.stopPrice   != null && entryPrice > 0) {
          const stopAbs = body.stopPrice as number;
          stopPct = Math.abs(entryPrice - stopAbs) / entryPrice;
        }
        if (body.targetPrice != null && entryPrice > 0) {
          const targetAbs = body.targetPrice as number;
          targetPct = Math.abs(targetAbs - entryPrice) / entryPrice;
        }

        // Support pre-computed qty (overrides sizePct-based sizing)
        const preQty = body.qty as number | undefined;
        const tradeInput = {
          strategyId:  body.strategyId  as string,
          symbol:      body.symbol      as string,
          side:        body.side        as 'long' | 'short',
          entryPrice,
          entryTime:   body.entryTime   as string,
          sizePct:     preQty != null ? undefined : (body.sizePct as number | undefined),
          stopPct,
          targetPct,
          equity:      preQty != null ? entryPrice * preQty : (body.equity as number | undefined),
          commission:  body.commission  as number | undefined,
          slippagePct: body.slippagePct as number | undefined,
          notes:       body.notes       as string | undefined,
          _overrideQty: preQty,
          journalWhy:  (typeof body.journal === 'object' && body.journal !== null
            ? body.journal
            : undefined) as Record<string, unknown> | undefined,
        };

        // 'limit' -> resting order (pending until price is hit); 'market' -> fill now
        const trade = orderType === 'limit'
          ? createPendingTrade(tradeInput)
          : openPaperTrade(tradeInput);

        // Auto-open TradingView chart when QD_TRADINGVIEW_AUTOOPEN=1
        openTradingViewChart(trade.symbol);

        return NextResponse.json({ trade, orderType });
      }

      case 'cancel-pending': {
        cancelPendingPaperTrade(body.id as string);
        return NextResponse.json({ ok: true });
      }

      case 'fill-pending': {
        // Check live quotes for any pending trades whose limit has been crossed
        const fillResults = await fillPendingTradesWithQuotes();
        const filled = fillResults.filter((r) => r.action === 'filled').length;
        return NextResponse.json({ fillResults, filled });
      }

      case 'close': {
        const trade = closePaperTrade(body.id as string, {
          exitPrice:   body.exitPrice   as number,
          exitTime:    body.exitTime    as string,
          commission:  body.commission  as number | undefined,
          slippagePct: body.slippagePct as number | undefined,
          exitReason:  'manual',
        });
        return NextResponse.json({ trade });
      }

      case 'mark': {
        const useQuotes = body.useQuotes !== false;
        const marks = useQuotes
          ? await markOpenTradesWithQuotes(body.timeframe as import('@/core/types').Timeframe | undefined)
          : markOpenTrades(body.timeframe as import('@/core/types').Timeframe | undefined);
        return NextResponse.json({ marks });
      }

      case 'project': {
        const result = projectTrade({
          symbol:      body.symbol      as string,
          entryDate:   body.entryDate   as string,
          holdingBars: body.holdingBars as number,
          timeframe:   body.timeframe   as string | undefined,
          commission:  body.commission  as number | undefined,
          slippagePct: body.slippagePct as number | undefined,
        });
        return NextResponse.json(result);
      }

      case 'sweep': {
        // EOD auto-close: check all open trades against daily bars for stop/target hits
        const sweepResults = sweepOpenTrades(
          body.timeframe as import('@/core/types').Timeframe | undefined,
          body.commission as number | undefined,
          body.slippagePct as number | undefined,
        );
        const closed  = sweepResults.filter((r) => r.action !== 'still-open');
        const stopped  = closed.filter((r) => r.action === 'stopped').length;
        const targeted = closed.filter((r) => r.action === 'targeted').length;
        const expired  = closed.filter((r) => r.action === 'expired').length;
        return NextResponse.json({ results: sweepResults, closed: closed.length, stopped, targeted, expired });
      }

      case 'tradebook': {
        const book = buildTradeBook();
        return NextResponse.json({ book });
      }

      case 'account': {
        return NextResponse.json({ account: accountSummary() });
      }

      case 'equity-history': {
        return NextResponse.json({ history: computeEquityHistory() });
      }

      case 'reconcile': {
        return NextResponse.json({ report: buildReconcileReport() });
      }

      case 'performance': {
        return NextResponse.json({ performance: buildPerformanceMetrics() });
      }

      case 'report': {
        const report = buildReport({
          from: body.from as string | undefined,
          to:   body.to   as string | undefined,
        });
        return NextResponse.json({ report });
      }

      case 'risk': {
        return NextResponse.json({ exposure: currentExposure(), account: accountSummary() });
      }

      case 'account-set': {
        const amount = body.startingBalance as number;
        setStartingBalance(amount);
        return NextResponse.json({ account: accountSummary() });
      }

      case 'list': {
        const trades = getPaperTrades({
          status:     body.status     as import('@/core/types').TradeStatus | undefined,
          strategyId: body.strategyId as string | undefined,
        });
        // Open trades carry estHold - historical median winner hold time
        return NextResponse.json({ trades: withEstHold(trades) });
      }

      case 'auto-trigger': {
        // Manually fire one auto-trade tick (ingest + scan + execute).
        // Bypasses market-hours gate so you can test off-hours.
        // Obeys DRY_RUN - will not open real trades when AUTO_TRADE_DRY_RUN=1.
        const tf = (process.env.AUTO_TRADE_TIMEFRAME ?? '15m') as import('@/core/types').Timeframe;
        const { ingestIntraday } = await import('@/core/data/intraday-ingest');
        const { runAutoTrade }   = await import('@/core/paper/auto-trade');

        const ingest = await ingestIntraday(tf);
        // Pass bypassMarketHours flag so the engine skips the hours guard
        const result = await runAutoTrade({ timeframe: tf, bypassMarketHours: true });

        return NextResponse.json({ ingest: { symbols: ingest.symbols, barsAdded: ingest.barsAdded, errors: ingest.errors }, autoTrade: result });
      }

      case 'auto-status': {
        // Read-only status: auto-trade config flags + today's auto trades.
        const today = new Date().toISOString().slice(0, 10);
        const allTrades = getPaperTrades();
        const autoToday = allTrades.filter(
          (t) => t.entryTime.slice(0, 10) === today && t.strategyId !== 'manual',
        );
        const openAutoToday = autoToday.filter((t) => t.status === 'open');
        const closedAutoToday = autoToday.filter((t) => t.status === 'closed');
        const todayPnl = closedAutoToday.reduce((s, t) => s + (t.pnl ?? 0), 0);
        return NextResponse.json({
          enabled:          process.env.AUTO_TRADE_ENABLED === '1',
          dryRun:           process.env.AUTO_TRADE_DRY_RUN === '1',
          timeframe:        process.env.AUTO_TRADE_TIMEFRAME ?? '15m',
          minConsensus:     parseInt(process.env.AUTO_TRADE_MIN_CONSENSUS ?? '2', 10),
          maxTradesPerDay:  parseInt(process.env.AUTO_TRADE_MAX_TRADES_PER_DAY ?? '5', 10),
          dailyLossHaltPct: parseFloat(process.env.AUTO_TRADE_DAILY_LOSS_HALT_PCT ?? '0.03'),
          today,
          autoTradesToday:  autoToday.length,
          openAutoToday:    openAutoToday.length,
          closedAutoToday:  closedAutoToday.length,
          todayPnlUsd:      todayPnl,
          trades:           autoToday,
        });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action '${action}'. Valid: open, close, mark, project, tradebook, list, account, equity-history, account-set, auto-status` },
          { status: 400 },
        );
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[POST /api/paper]', err);
    if (
      err instanceof InsufficientFundsError ||
      err instanceof BankruptError ||
      err instanceof RiskCheckError
    ) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof DuplicateOpenTradeError) {
      return NextResponse.json(
        {
          error: err.message,
          symbol: err.symbol,
          existingTradeId: err.existingTradeId,
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
