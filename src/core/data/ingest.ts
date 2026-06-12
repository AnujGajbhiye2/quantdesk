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
  // Provider range ends are exclusive (verified against Yahoo chart), so the
  // window must end at tomorrow for today's bar to be included.
  const to = nextDay(todayString());
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
/**
 * Compute the fetch window for an incremental refresh.
 *
 * - to: the day AFTER today, because provider range ends are exclusive -
 *   with to = today, today's bar is never returned and the DB stays
 *   permanently a day behind.
 * - from: the latest stored day itself, not the day after. A bar stored while
 *   the market was still open is partial; re-fetching that day finalizes it
 *   via upsert. One redundant bar per symbol per refresh is the cost.
 */
export function refreshWindow(
  latestStored: string | null,
  today: string,
): { from: string; to: string } {
  return {
    from: latestStored ?? FULL_HISTORY_FROM,
    to:   nextDay(today),
  };
}

export async function refreshUniverse(
  universe?: UniverseEntry[],
  timeframe: Timeframe = DEFAULT_TIMEFRAME,
): Promise<IngestResult[]> {
  const today = todayString();
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

      // Latest stored bar time; null means full ingest from default start.
      // The window deliberately re-fetches the latest stored day (see
      // refreshWindow) so a partial intraday bar gets finalized.
      const latestStored = getLatestBarTime(entry.symbol, timeframe);
      const { from, to } = refreshWindow(
        latestStored ? latestStored.slice(0, 10) : null,
        today,
      );

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

      // Count only genuinely new days; the re-fetched latest day is an update.
      const newBars = latestStored
        ? bars.filter((b) => b.time.slice(0, 10) > latestStored.slice(0, 10))
        : bars;
      results.push({ symbol: entry.symbol, barsAdded: newBars.length });
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
