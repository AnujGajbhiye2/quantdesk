import { NextResponse } from 'next/server';
import {
  openPaperTrade,
  closePaperTrade,
  markOpenTrades,
  projectTrade,
} from '@/core/paper/broker';
import { buildTradeBook } from '@/core/paper/tradebook';
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
        const trade = openPaperTrade({
          strategyId:  body.strategyId  as string,
          symbol:      body.symbol      as string,
          side:        body.side        as 'long' | 'short',
          entryPrice:  body.entryPrice  as number,
          entryTime:   body.entryTime   as string,
          sizePct:     body.sizePct     as number | undefined,
          stopPct:     body.stopPct     as number | undefined,
          targetPct:   body.targetPct   as number | undefined,
          equity:      body.equity      as number | undefined,
          commission:  body.commission  as number | undefined,
          slippagePct: body.slippagePct as number | undefined,
          notes:       body.notes       as string | undefined,
        });
        return NextResponse.json({ trade });
      }

      case 'close': {
        const trade = closePaperTrade(body.id as string, {
          exitPrice:   body.exitPrice   as number,
          exitTime:    body.exitTime    as string,
          commission:  body.commission  as number | undefined,
          slippagePct: body.slippagePct as number | undefined,
        });
        return NextResponse.json({ trade });
      }

      case 'mark': {
        const marks = markOpenTrades(body.timeframe as import('@/core/types').Timeframe | undefined);
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

      case 'tradebook': {
        const book = buildTradeBook();
        return NextResponse.json({ book });
      }

      case 'list': {
        const trades = getPaperTrades({
          status:     body.status     as import('@/core/types').TradeStatus | undefined,
          strategyId: body.strategyId as string | undefined,
        });
        return NextResponse.json({ trades });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action '${action}'. Valid: open, close, mark, project, tradebook, list` },
          { status: 400 },
        );
    }
  } catch (err) {
    console.error('[POST /api/paper]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
