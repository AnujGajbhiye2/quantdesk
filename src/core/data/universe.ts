import 'server-only';
import type { SymbolMeta } from '@/core/types';
import type { UniverseEntry } from './ingest';
import sp500 from '../../../scripts/universe/sp500.json';
import nifty200 from '../../../scripts/universe/nifty200.json';

const CURATED_UNIVERSE = [...sp500, ...nifty200] as UniverseEntry[];

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
