import 'server-only';
import type { SymbolMeta } from '@/core/types';
import type { UniverseEntry } from './ingest';
import sp500 from '../../../scripts/universe/sp500.json';
import nifty200 from '../../../scripts/universe/nifty200.json';
import stoxx600 from '../../../scripts/universe/stoxx600.json';
import gold from '../../../scripts/universe/gold.json';
import reference from '../../../scripts/universe/reference.json';

// stoxx600.json is a placeholder until populated via:
//   npm run build-universe -- --only stoxx600
//   npm run ingest -- --universe scripts/universe/stoxx600.json
//
// reference.json holds non-tradeable regime benchmarks (^GSPC, ^IXIC, ^DJI).
// These are included in CURATED_UNIVERSE so EOD ingest pulls their bars for
// regime-gate evaluation. autoTradeUniverse() excludes them automatically
// (they are not in SP500_SYMBOLS or GOLD_SYMBOLS after the sp500 clean).
const CURATED_UNIVERSE = [...sp500, ...nifty200, ...stoxx600, ...gold, ...reference] as UniverseEntry[];

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
    // Force providerId to alpaca for all auto-trade entries so intraday
    // ingest routes to the correct provider. Fallback to 'yahoo' when
    // Alpaca is not registered (i.e. keys not set).
    providerId: 'alpaca',
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
