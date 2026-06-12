import { NextResponse } from 'next/server';
import {
  openPaperTrade,
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
import { currentExposure } from '@/core/risk/exposure';
import { buildTradeBook } from '@/core/paper/tradebook';
import { withEstHold } from '@/core/paper/hold';
import { accountSummary } from '@/core/paper/summary';
import { setStartingBalance } from '@/core/db/account';
import { getPaperTrades } from '@/core/db/paper';

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
 */
export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const { action } = body;

    switch (action) {
      case 'open': {
        const entryPrice = body.entryPrice as number;
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
        const trade = openPaperTrade({
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
        });
        return NextResponse.json({ trade });
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

      default:
        return NextResponse.json(
          { error: `Unknown action '${action}'. Valid: open, close, mark, project, tradebook, list, account, account-set` },
          { status: 400 },
        );
    }
  } catch (err) {
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
