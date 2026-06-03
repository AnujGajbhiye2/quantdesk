import 'server-only';
import { get as getProvider } from './registry';
import { upsertBars, upsertSymbol, getLatestBarTime, getAllSymbols } from '@/core/db/bars';
import type { SymbolMeta, Timeframe } from '@/core/types';

export interface UniverseEntry {
  symbol: string;
  name: string;
  assetClass: SymbolMeta['assetClass'];
  currency: string;
  exchange?: string;
  providerId: string;
}

export interface IngestResult {
  symbol: string;
  barsAdded: number;
  error?: string;
}

const DEFAULT_TIMEFRAME: Timeframe = '1d';
/** Default history window for a full ingest: ~10 years. */
const FULL_HISTORY_FROM = '2015-01-01';

/**
 * Bulk-ingest full daily history for each symbol in the universe.
 * Upserts symbols + bars into the DB. Adapters handle the provider-specific fetch.
 *
 * @param universe  Array of symbols to ingest.
 * @param from      Start date 'YYYY-MM-DD' (default: 2015-01-01).
 * @param timeframe Timeframe to ingest (default: '1d').
 */
export async function ingestUniverse(
  universe: UniverseEntry[],
  from: string = FULL_HISTORY_FROM,
  timeframe: Timeframe = DEFAULT_TIMEFRAME,
): Promise<IngestResult[]> {
  const to = todayString();
  const results: IngestResult[] = [];

  for (const entry of universe) {
    try {
      const provider = getProvider(entry.providerId);

      // Upsert symbol metadata
      const meta: SymbolMeta = {
        symbol: entry.symbol,
        providerSymbol: provider.toProviderSymbol(entry.symbol),
        name: entry.name,
        assetClass: entry.assetClass,
        currency: entry.currency,
        exchange: entry.exchange,
        providerId: entry.providerId,
      };
      upsertSymbol(meta);

      // Fetch + persist bars
      const bars = await provider.getHistory(entry.symbol, timeframe, from, to);
      upsertBars(entry.symbol, timeframe, bars);

      results.push({ symbol: entry.symbol, barsAdded: bars.length });
    } catch (err) {
      results.push({
        symbol: entry.symbol,
        barsAdded: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

/**
 * Incremental refresh: for each symbol already in the DB, fetch only bars newer
 * than the latest stored bar. If a universe is supplied, also upserts new symbols.
 *
 * @param universe  Optional list of symbols to refresh. Defaults to all stored symbols.
 * @param timeframe Timeframe to refresh (default: '1d').
 */
export async function refreshUniverse(
  universe?: UniverseEntry[],
  timeframe: Timeframe = DEFAULT_TIMEFRAME,
): Promise<IngestResult[]> {
  const to = todayString();
  const results: IngestResult[] = [];

  // Build the list to refresh
  let entries: UniverseEntry[];
  if (universe && universe.length > 0) {
    entries = universe;
  } else {
    // Refresh all symbols already stored in the DB
    const stored = getAllSymbols();
    entries = stored.map((s) => ({
      symbol: s.symbol,
      name: s.name,
      assetClass: s.assetClass,
      currency: s.currency,
      exchange: s.exchange,
      providerId: s.providerId,
    }));
  }

  for (const entry of entries) {
    try {
      const provider = getProvider(entry.providerId);

      // Find the latest stored bar time and fetch only newer bars
      const latestStored = getLatestBarTime(entry.symbol, timeframe);

      // If no bars exist, do a full ingest from default start
      const from = latestStored
        ? nextDay(latestStored) // fetch from the day AFTER the last stored bar
        : FULL_HISTORY_FROM;

      // Nothing to fetch if already up to date (or next fetch start = today with no new close)
      if (from >= to) {
        results.push({ symbol: entry.symbol, barsAdded: 0 });
        continue;
      }

      // Upsert symbol meta in case this is the first time
      const meta: SymbolMeta = {
        symbol: entry.symbol,
        providerSymbol: provider.toProviderSymbol(entry.symbol),
        name: entry.name,
        assetClass: entry.assetClass,
        currency: entry.currency,
        exchange: entry.exchange,
        providerId: entry.providerId,
      };
      upsertSymbol(meta);

      const bars = await provider.getHistory(entry.symbol, timeframe, from, to);
      upsertBars(entry.symbol, timeframe, bars);

      results.push({ symbol: entry.symbol, barsAdded: bars.length });
    } catch (err) {
      results.push({
        symbol: entry.symbol,
        barsAdded: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return today as 'YYYY-MM-DD' (UTC). */
function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Return the calendar day after a 'YYYY-MM-DD' string. */
function nextDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
