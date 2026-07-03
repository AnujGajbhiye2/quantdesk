import 'server-only';
import type { SymbolMeta } from '@/core/types';
import type { UniverseEntry } from './ingest';
import sp500 from '../../../scripts/universe/sp500.json';
import nifty200 from '../../../scripts/universe/nifty200.json';
import stoxx600 from '../../../scripts/universe/stoxx600.json';
import euStocks from '../../../scripts/universe/eu-stocks.json';
import gold from '../../../scripts/universe/gold.json';
import reference from '../../../scripts/universe/reference.json';

// stoxx600.json (466 names) is retained in CURATED_UNIVERSE for broad signal coverage
// but is not used by per-market trading scans (too noisy, GBp pence bug on .L names).
// eu-stocks.json (~62 curated continental names) is used for EU daily scan + trade execution.
//
// reference.json holds non-tradeable regime benchmarks (^GSPC, ^IXIC, ^DJI).
// Included so EOD ingest pulls their bars for regime-gate evaluation.
// autoTradeUniverse() excludes them (not in SP500_SYMBOLS or GOLD_SYMBOLS).
const CURATED_UNIVERSE = [
  ...sp500, ...nifty200, ...stoxx600, ...euStocks, ...gold, ...reference,
] as UniverseEntry[];

// ---------------------------------------------------------------------------
// Per-market universe selection (keyed by source file, not marketOf())
// ---------------------------------------------------------------------------

/** Market buckets used for per-close daily scanning and paper-trade execution. */
export type ScanMarket = 'nse' | 'eu' | 'sp500' | 'commodity';

/** All scan markets in close-time order (earliest close first). */
export const ALL_SCAN_MARKETS: ScanMarket[] = ['nse', 'eu', 'sp500', 'commodity'];

/**
 * Return the universe for a specific market bucket.
 * Keyed by source JSON file to avoid relying on marketOf() exchange codes,
 * which do not match all exchange codes used in the JSON files.
 */
export function universeForMarket(market: ScanMarket): UniverseEntry[] {
  switch (market) {
    case 'nse':       return dedupeUniverse([...nifty200]  as UniverseEntry[]);
    case 'eu':        return dedupeUniverse([...euStocks]  as UniverseEntry[]);
    case 'sp500':     return dedupeUniverse([...sp500]     as UniverseEntry[]);
    case 'commodity': return dedupeUniverse([...gold]      as UniverseEntry[]);
  }
}

// ---------------------------------------------------------------------------
// Intraday auto-trade universe (US + gold via Alpaca)
// ---------------------------------------------------------------------------

// Symbols eligible for automated intraday trading: S&P 500 + gold instruments.
// All routed through Alpaca (free IEX feed, US equities/ETFs).
const SP500_SYMBOLS   = new Set((sp500 as UniverseEntry[]).map((e) => e.symbol));
const GOLD_SYMBOLS    = new Set((gold  as UniverseEntry[]).map((e) => e.symbol));

/**
 * Universe eligible for automated intraday paper-trading.
 * Only US instruments served by Alpaca (free tier).
 */
export function autoTradeUniverse(): UniverseEntry[] {
  return dedupeUniverse(
    (CURATED_UNIVERSE).filter((e) => SP500_SYMBOLS.has(e.symbol) || GOLD_SYMBOLS.has(e.symbol)),
  ).map((e) => ({
    ...e,
    // Route auto-trade entries to the intraday provider (Alpaca is the only
    // built-in with a batch intraday endpoint). Override with INTRADAY_PROVIDER
    // if that ever changes. Intraday ingest falls back to the default provider
    // when the chosen one is not registered (i.e. keys not set).
    providerId: process.env.INTRADAY_PROVIDER ?? 'alpaca',
  }));
}

export interface KnownSymbol {
  symbol:     string;
  name:       string;
  assetClass: SymbolMeta['assetClass'];
  currency:   string;
  exchange?:  string;
  providerId: string;
  inDb:       boolean;
}

export function loadCuratedUniverse(): UniverseEntry[] {
  return dedupeUniverse(CURATED_UNIVERSE);
}

export function mergeKnownSymbols(dbSymbols: SymbolMeta[]): KnownSymbol[] {
  const bySymbol = new Map<string, KnownSymbol>();

  for (const entry of loadCuratedUniverse()) {
    bySymbol.set(entry.symbol, {
      symbol:     entry.symbol,
      name:       entry.name,
      assetClass: entry.assetClass,
      currency:   entry.currency,
      exchange:   entry.exchange,
      providerId: entry.providerId,
      inDb:       false,
    });
  }

  for (const meta of dbSymbols) {
    bySymbol.set(meta.symbol, {
      symbol:     meta.symbol,
      name:       meta.name,
      assetClass: meta.assetClass,
      currency:   meta.currency,
      exchange:   meta.exchange,
      providerId: meta.providerId,
      inDb:       true,
    });
  }

  return Array.from(bySymbol.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function dedupeUniverse(entries: UniverseEntry[]): UniverseEntry[] {
  const seen = new Map<string, UniverseEntry>();
  for (const entry of entries) {
    if (!entry.symbol) continue;
    seen.set(entry.symbol, entry);
  }
  return Array.from(seen.values());
}
