import { NextResponse } from 'next/server';
import { scan } from '@/core/scan/scanner';
import { recommendTrade, capIdeaToCash } from '@/core/signals/recommend';
import { computeConviction } from '@/core/signals/conviction';
import { accountSummary } from '@/core/paper/summary';
import { fromUSD } from '@/core/format/fx';
import { enrichIdeas } from '@/core/signals/enrich';
import { EdgeIndex, type EdgeSummary } from '@/core/edge/context';
import { getAllSymbols } from '@/core/db/bars';
import type { TradeIdea } from '@/core/types';

/**
 * POST /api/scan
 *
 * Run a strategy across the watchlist and return matching signals + trade
 * ideas. Ideas are enriched with the strategy's backtested edge and a
 * quality-gate verdict (gated ideas are returned, not dropped).
 *
 * Body:
 * {
 *   "strategyId": "rsi-reversion",
 *   "symbols":    ["AAPL", "MSFT"],   // optional; default = all stored symbols
 *   "timeframe":  "1d",               // optional; default = "1d"
 *   "rawParams":  {}                  // optional strategy params
 *   "equity":     10000,              // optional; for risk-based sizing
 *   "riskPct":    0.01,               // optional; fraction of equity to risk per trade
 * }
 *
 * Returns:
 * {
 *   signals: Signal[], ideas: EnrichedTradeIdea[],
 *   edges: Record<'strategyId|symbol', EdgeSummary | null>,
 *   scanned: number, durationMs: number
 * }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      strategyId: string;
      symbols?:   string[];
      timeframe?: string;
      rawParams?: unknown;
      equity?:    number;
      riskPct?:   number;
    };

    if (!body.strategyId) {
      return NextResponse.json({ error: 'strategyId required' }, { status: 400 });
    }

    const start  = Date.now();
    const result = scan({
      strategyId: body.strategyId,
      symbols:    body.symbols,
      timeframe:  body.timeframe as import('@/core/types').Timeframe | undefined,
      rawParams:  body.rawParams,
    });

    const allMeta = getAllSymbols();
    const metaMap = new Map(allMeta.map((m) => [m.symbol, m]));

    // Budget mode: size ideas off the real account equity and cap entry cost
    // to spendable cash. Explicit body.equity always wins (API contract).
    const account = body.equity == null ? accountSummary() : null;

    // Build trade ideas for non-exit signals (enter_long / enter_short only)
    const ideas: TradeIdea[] = [];
    for (const raw of result.rawResults) {
      if (raw.signal.side === 'flat') continue; // exit signal - no idea
      const currency = metaMap.get(raw.signal.symbol)?.currency ?? 'USD';
      const equity = body.equity
        ?? (account ? fromUSD(Math.max(account.equity, 0), currency) : undefined);
      let idea = recommendTrade(
        raw.signal,
        raw.bars,
        raw.decision,
        { equity, riskPct: body.riskPct },
      );
      if (idea && account) {
        idea = capIdeaToCash(idea, fromUSD(Math.max(account.cash, 0), currency));
      }
      if (idea) {
        ideas.push({ ...idea, currency });
      }
    }

    const index = EdgeIndex.load();
    const assetClassOf = (symbol: string) => metaMap.get(symbol)?.assetClass ?? null;
    const enriched = enrichIdeas(ideas, index, assetClassOf);

    // Single-strategy scan: no consensus available; edge + R:R drive the score
    for (const idea of enriched) {
      idea.conviction = computeConviction({
        edgeScore:         idea.edge?.score ?? null,
        edgeTrades:        idea.edge?.numTrades ?? null,
        consensusStrength: null,
        rr:                idea.rr,
        hitRate:           null,
        regimeAligned:     null,
      });
    }

    const edges: Record<string, EdgeSummary | null> = {};
    for (const sig of result.signals) {
      if (sig.side === 'flat') continue;
      const key = `${sig.strategyId}|${sig.symbol}`;
      if (!(key in edges)) {
        edges[key] = index.resolve(sig.strategyId, sig.symbol, assetClassOf(sig.symbol));
      }
    }

    const scanned = body.symbols?.length ?? allMeta.length;

    return NextResponse.json({
      signals:      result.signals,
      ideas:        enriched,
      edges,
      scanned,
      regimeAligned: result.regimeAligned,
      durationMs:   Date.now() - start,
    });
  } catch (err) {
    console.error('[POST /api/scan]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
