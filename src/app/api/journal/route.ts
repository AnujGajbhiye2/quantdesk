import { NextResponse } from 'next/server';
import { getJournalEntries, type JournalEntry } from '@/core/db/journal';
import { getPaperTrades } from '@/core/db/paper';
import { getAllSymbols } from '@/core/db/bars';
import { getEdgeStats } from '@/core/db/edge';
import { GLOBAL_SCOPE } from '@/core/edge/types';
import { marketOf, type Market } from '@/core/market/markets';
import { toUSD } from '@/core/format/fx';
import type { PaperTrade } from '@/core/types';
import { requireUser, AuthError } from '@/core/auth/guard';

/**
 * GET /api/journal
 *
 * The decision log + the system report. Entries join each journal row with
 * its trade; the report aggregates CLOSED trades by strategy x market and
 * compares the live record against the backtested edge - producing the
 * TRUST / WATCH / AVOID list that answers "which strategy can I follow?".
 */

export interface JournalRow {
  entry: JournalEntry;
  trade: PaperTrade | null;
}

export interface ComboReport {
  strategyId: string;
  market: Market;
  trades: number;
  wins: number;
  liveWinRate: number;
  avgPnlPct: number;
  totalPnlUSD: number;
  backtestWinRate: number | null;
  verdict: 'TRUST' | 'WATCH' | 'AVOID';
  detail: string;
}

const MIN_TRADES   = 10;
const TOLERANCE_PP = 5;

export async function GET() {
  try {
    // Trade outcomes - visible to any logged-in user (performance data, not
    // live signals). See plan "open up trades + performance".
    await requireUser();
    const entries = getJournalEntries(300);
    const trades  = getPaperTrades();
    const tradeById = new Map(trades.map((t) => [t.id, t]));
    const metaMap = new Map(getAllSymbols().map((m) => [m.symbol, m]));
    const btBy = new Map(
      getEdgeStats({ scope: GLOBAL_SCOPE }).map((e) => [e.strategyId, e.winRate]),
    );

    const rows: JournalRow[] = entries.map((entry) => ({
      entry,
      trade: tradeById.get(entry.tradeId) ?? null,
    }));

    // System report: strategy x market over CLOSED trades
    const combos = new Map<string, { strategyId: string; market: Market; trades: PaperTrade[] }>();
    for (const t of trades) {
      if (t.status !== 'closed') continue;
      const meta = metaMap.get(t.symbol);
      const market = meta
        ? marketOf({ symbol: t.symbol, assetClass: meta.assetClass, exchange: meta.exchange })
        : ('US' as Market);
      const key = `${t.strategyId}|${market}`;
      const combo = combos.get(key) ?? { strategyId: t.strategyId, market, trades: [] };
      combo.trades.push(t);
      combos.set(key, combo);
    }

    const report: ComboReport[] = [...combos.values()].map(({ strategyId, market, trades: ts }) => {
      const wins = ts.filter((t) => (t.pnl ?? 0) > 0).length;
      const liveWinRate = ts.length > 0 ? wins / ts.length : 0;
      const avgPnlPct = ts.length > 0
        ? ts.reduce((s, t) => s + (t.pnlPct ?? 0), 0) / ts.length
        : 0;
      const totalPnlUSD = ts.reduce((s, t) => s + toUSD(t.pnl ?? 0, t.currency), 0);
      const bt = btBy.get(strategyId) ?? null;

      let verdict: ComboReport['verdict'];
      let detail: string;
      if (ts.length < MIN_TRADES) {
        verdict = 'WATCH';
        detail = `only ${ts.length} closed trade(s) - need ${MIN_TRADES}+ before this combo earns a verdict`;
      } else if (bt == null) {
        verdict = 'WATCH';
        detail = 'no backtested edge stats to compare against';
      } else if ((bt - liveWinRate) * 100 <= TOLERANCE_PP) {
        verdict = 'TRUST';
        detail = `live ${(liveWinRate * 100).toFixed(0)}% vs backtest ${(bt * 100).toFixed(0)}% - the edge survives reality`;
      } else {
        verdict = 'AVOID';
        detail = `live ${(liveWinRate * 100).toFixed(0)}% vs backtest ${(bt * 100).toFixed(0)}% - materially worse than promised`;
      }

      return {
        strategyId, market,
        trades: ts.length, wins, liveWinRate, avgPnlPct, totalPnlUSD,
        backtestWinRate: bt, verdict, detail,
      };
    }).sort((a, b) => b.totalPnlUSD - a.totalPnlUSD);

    return NextResponse.json({ rows, report });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[GET /api/journal]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
