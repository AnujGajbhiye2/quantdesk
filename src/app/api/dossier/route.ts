import { NextResponse } from 'next/server';
import { getAllSymbols, getRecentBars } from '@/core/db/bars';
import { getSignals, getLatestSignals } from '@/core/db/signals';
import { getEdgeStats } from '@/core/db/edge';
import { getCachedFundamentals, saveFundamentals, getCachedNews, saveNews } from '@/core/db/research';
import { getOrDefault as getProvider } from '@/core/data/registry';
import { compute } from '@/core/indicators/registry';
import { dropPartialToday } from '@/core/scan/scanner';
import { buildCase, type SymbolCase } from '@/core/dossier/case';
import { list as listStrategies } from '@/core/strategy/registry';
import { computeConviction, type Conviction } from '@/core/signals/conviction';
import { edgeScore } from '@/core/edge/score';
import type { Fundamentals, NewsItem } from '@/core/data/DataProvider';
import type { EdgeStats } from '@/core/edge/types';

/**
 * GET /api/dossier?symbol=X
 *
 * The decision dossier: everything known about one symbol in a single
 * response - technicals, strategy consensus, backtested edge, realized
 * signal track record, fundamentals and news (cache-first, provider on
 * miss), plus the deterministic bull/bear case built from all of it.
 */

export interface DossierResponse {
  symbol: string;
  name: string;
  currency: string;
  technical: {
    lastClose: number | null;
    lastBarTime: string | null;
    sma50: number | null;
    sma200: number | null;
    rsi14: number | null;
    pctBelow52wHigh: number | null;
  };
  signals: Array<{ strategyId: string; side: string; time: string; reason: string; conviction?: Conviction }>;
  consensus: { long: number; short: number; totalStrategies: number };
  edges: EdgeStats[];
  history: { longSignals: number; longHitRate: number | null };
  fundamentals: Fundamentals | null;
  news: NewsItem[];
  case: SymbolCase;
}

/** Latest signals are only "current" if scanned within a week of the last bar. */
const SIGNAL_FRESH_MS = 7 * 86_400_000;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = (searchParams.get('symbol') ?? '').trim().toUpperCase();
    if (!symbol) {
      return NextResponse.json({ error: 'symbol required' }, { status: 400 });
    }

    const meta = getAllSymbols().find((m) => m.symbol === symbol);
    if (!meta) {
      return NextResponse.json({ error: `unknown symbol: ${symbol} - ingest it first` }, { status: 404 });
    }

    // --- Technicals from stored bars (closed bars only) ---
    const bars = dropPartialToday(getRecentBars(symbol, '1d', 320));
    const lastBar = bars[bars.length - 1] ?? null;
    let sma50: number | null = null;
    let sma200: number | null = null;
    let rsi14: number | null = null;
    if (bars.length >= 20) {
      const sma50Arr  = compute('sma', bars, { period: 50 })  as number[];
      const sma200Arr = compute('sma', bars, { period: 200 }) as number[];
      const rsiArr    = compute('rsi', bars, { period: 14 })  as number[];
      const last = bars.length - 1;
      sma50  = Number.isFinite(sma50Arr[last])  ? sma50Arr[last]  : null;
      sma200 = Number.isFinite(sma200Arr[last]) ? sma200Arr[last] : null;
      rsi14  = Number.isFinite(rsiArr[last])    ? rsiArr[last]    : null;
    }

    // 52w high from trailing bars (or fundamentals later as fallback)
    const yearBars = bars.slice(-252);
    const high52   = yearBars.length >= 30 ? Math.max(...yearBars.map((b) => b.high)) : null;
    const pctBelow52wHigh =
      lastBar && high52 && high52 > 0 ? ((high52 - lastBar.close) / high52) * 100 : null;

    // --- Current signals + consensus ---
    const totalStrategies = listStrategies().length;
    const latest = getLatestSignals([symbol]);
    const freshCutoff = lastBar
      ? new Date(new Date(`${lastBar.time.slice(0, 10)}T00:00:00Z`).getTime() - SIGNAL_FRESH_MS).toISOString().slice(0, 10)
      : '1970-01-01';
    const fresh = latest.filter((s) => s.time.slice(0, 10) >= freshCutoff);
    const consensus = {
      long:  fresh.filter((s) => s.side === 'long').length,
      short: fresh.filter((s) => s.side === 'short').length,
      totalStrategies,
    };

    // --- Edge stats, symbol scope ---
    const edges = getEdgeStats({ symbol });
    const bestEdge = edges
      .filter((e) => e.numTrades >= 15)
      .sort((a, b) => b.profitFactor - a.profitFactor)[0] ?? null;

    // --- Realized track record of past long signals (+5 bar move) ---
    const allSignals = getSignals({ symbol, limit: 500 });
    const barIndex = new Map<string, number>();
    bars.forEach((b, i) => barIndex.set(b.time.slice(0, 10), i));
    let longSamples = 0;
    let longHits = 0;
    for (const s of allSignals) {
      if (s.side !== 'long') continue;
      const i = barIndex.get(s.time.slice(0, 10));
      if (i === undefined) continue;
      const future = bars[i + 5];
      if (!future || bars[i].close === 0) continue;
      longSamples += 1;
      if (future.close > bars[i].close) longHits += 1;
    }
    const longHitRate = longSamples >= 5 ? longHits / longSamples : null;

    // --- Fundamentals + news, cache-first, provider calls run in parallel ---
    let fundamentals = getCachedFundamentals(symbol);
    let news = getCachedNews(symbol);
    const provider = getProvider(meta.providerId);

    const needFundamentals = fundamentals === null && typeof provider.getFundamentals === 'function';
    const needNews         = news === null          && typeof provider.getNews         === 'function';

    if (needFundamentals || needNews) {
      const [freshFundamentals, freshNews] = await Promise.all([
        needFundamentals ? provider.getFundamentals!(symbol) : Promise.resolve(null),
        needNews         ? provider.getNews!(symbol)         : Promise.resolve(null),
      ]);
      if (freshFundamentals !== null) {
        fundamentals = freshFundamentals;
        saveFundamentals(symbol, fundamentals);
      }
      if (freshNews !== null) {
        news = freshNews;
        saveNews(symbol, news);
      }
    }
    news = news ?? [];

    // --- The case ---
    const symbolCase = buildCase({
      lastClose: lastBar?.close ?? null,
      sma50,
      sma200,
      pctBelow52wHigh,
      consensusLong:  consensus.long,
      consensusShort: consensus.short,
      totalStrategies,
      bestEdge: bestEdge
        ? {
            strategyId:   bestEdge.strategyId,
            winRate:      bestEdge.winRate,
            profitFactor: bestEdge.profitFactor,
            numTrades:    bestEdge.numTrades,
          }
        : null,
      longSignalHitRate: longHitRate,
      longSignalSamples: longSamples,
      fundamentals,
    });

    const body: DossierResponse = {
      symbol,
      name: meta.name,
      currency: meta.currency,
      technical: {
        lastClose:   lastBar?.close ?? null,
        lastBarTime: lastBar?.time ?? null,
        sma50,
        sma200,
        rsi14,
        pctBelow52wHigh,
      },
      signals: fresh.map((s) => {
        const edge = edges.find((e) => e.strategyId === s.strategyId);
        const score = edge ? edgeScore(edge).score : null;
        const conviction = computeConviction({
          edgeScore:         score,
          edgeTrades:        edge?.numTrades ?? null,
          consensusStrength: s.side === 'long' ? consensus.long / totalStrategies : consensus.short / totalStrategies,
          rr:                null, // rr not available without running strategy params
          hitRate:           s.side === 'long' ? longHitRate : null,
          regimeAligned:     lastBar && sma200 ? (s.side === 'long' ? lastBar.close > sma200 : lastBar.close < sma200) : null,
        });
        return {
          strategyId: s.strategyId,
          side:       s.side,
          time:       s.time,
          reason:     s.reason,
          conviction,
        };
      }),
      consensus,
      edges,
      history: { longSignals: longSamples, longHitRate },
      fundamentals,
      news,
      case: symbolCase,
    };

    return NextResponse.json(body, {
      headers: { 'Cache-Control': 'private, max-age=30' },
    });
  } catch (err) {
    console.error('[GET /api/dossier]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
