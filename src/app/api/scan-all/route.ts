import { NextResponse } from 'next/server';
import { scanAll } from '@/core/scan/scan-all';
import { recommendTrade, capIdeaToCash } from '@/core/signals/recommend';
import { computeConviction } from '@/core/signals/conviction';
import { accountSummary } from '@/core/paper/summary';
import { fromUSD } from '@/core/format/fx';
import { enrichIdeas } from '@/core/signals/enrich';
import { EdgeIndex, type EdgeSummary } from '@/core/edge/context';
import { getAllSymbols } from '@/core/db/bars';
import type { TradeIdea, Timeframe } from '@/core/types';

/**
 * POST /api/scan-all
 *
 * Run EVERY registered strategy against every stored symbol's latest bar.
 * Signals are persisted (dedup-safe) and grouped into consensus rows ranked
 * strongest first. Ideas are enriched with the strategy's backtested edge
 * and a quality-gate verdict (gated ideas are returned, not dropped, so the
 * UI can render the muted "insufficient edge" row).
 *
 * Body (all optional):
 * {
 *   "symbols":   ["AAPL", "MSFT"],  // default = all stored symbols
 *   "timeframe": "1d",
 *   "equity":    10000,             // for risk-based idea sizing
 *   "riskPct":   0.01
 * }
 *
 * Returns:
 * {
 *   consensus:  ConsensusSignal[],  // ranked, strongest first
 *   signals:    Signal[],
 *   ideas:      EnrichedTradeIdea[],
 *   edges:      Record<'strategyId|symbol', EdgeSummary | null>, // for signal rows
 *   scanned:    number,
 *   totalStrategies: number,
 *   durationMs: number
 * }
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      symbols?:   string[];
      timeframe?: Timeframe;
      equity?:    number;
      riskPct?:   number;
    };

    const result = scanAll({
      symbols:   body.symbols,
      timeframe: body.timeframe,
      persist:   true,
    });

    const metaMap = new Map(getAllSymbols().map((m) => [m.symbol, m]));

    // Budget mode: size ideas off the real account equity and cap entry cost
    // to spendable cash. Explicit body.equity always wins (API contract).
    const account = body.equity == null ? accountSummary() : null;

    const ideas: TradeIdea[] = [];
    for (const raw of result.rawResults) {
      if (raw.signal.side === 'flat') continue;
      const currency = metaMap.get(raw.signal.symbol)?.currency ?? 'USD';
      const equity = body.equity
        ?? (account ? fromUSD(Math.max(account.equity, 0), currency) : undefined);
      let idea = recommendTrade(raw.signal, raw.bars, raw.decision, {
        equity,
        riskPct: body.riskPct,
      });
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

    // Conviction: edge + consensus + R:R folded into one inspectable score.
    // Hit-rate and regime are left neutral here (too costly per full scan);
    // the dossier computes them per symbol.
    const strengthByKey = new Map(
      result.consensus.map((c) => [`${c.symbol}|${c.side}`, c.strength]),
    );
    for (const idea of enriched) {
      idea.conviction = computeConviction({
        edgeScore:         idea.edge?.score ?? null,
        edgeTrades:        idea.edge?.numTrades ?? null,
        consensusStrength: strengthByKey.get(`${idea.symbol}|${idea.side}`) ?? null,
        rr:                idea.rr,
        hitRate:           null,
        regimeAligned:     null,
      });
    }

    // Edge summaries for non-flat signal rows, keyed 'strategyId|symbol', so
    // the signal dashboard can weight rows without a second fetch.
    const edges: Record<string, EdgeSummary | null> = {};
    for (const sig of result.signals) {
      if (sig.side === 'flat') continue;
      const key = `${sig.strategyId}|${sig.symbol}`;
      if (!(key in edges)) {
        edges[key] = index.resolve(sig.strategyId, sig.symbol, assetClassOf(sig.symbol));
      }
    }

    return NextResponse.json({
      consensus:       result.consensus,
      signals:         result.signals,
      ideas:           enriched,
      edges,
      scanned:         result.scanned,
      totalStrategies: result.totalStrategies,
      durationMs:      result.durationMs,
    });
  } catch (err) {
    console.error('[POST /api/scan-all]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
