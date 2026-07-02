import 'server-only';
import { get as getProvider } from '@/core/data/registry';
import { autoTradeUniverse } from '@/core/data/universe';
import { getCachedFundamentals, saveFundamentals } from '@/core/db/research';
import { earningsBlackoutConfigFromEnv } from '@/core/paper/earnings-blackout';

/**
 * Proactive fundamentals prefetch for the auto-trade universe.
 *
 * The earnings-blackout gate reads Fundamentals.nextEarningsDate from
 * fundamentals_cache, but that cache was only populated lazily when a user
 * viewed a symbol's dossier - so the gate failed open (blocked nothing) for
 * almost every symbol. This job runs nightly from postRefreshTasks() and
 * fills the cache for the whole auto-trade universe, so the next trading
 * day's entries see a fresh earnings date for every candidate.
 *
 * Only runs when EARNINGS_BLACKOUT_ENABLED=1 - no reason to spend ~500
 * Yahoo quoteSummary calls a night for a gate that is switched off.
 * Fundamentals always come from Yahoo (calendarEvents module) regardless of
 * the universe entry's providerId - Alpaca has no fundamentals endpoint.
 */

export interface FundamentalsPrefetchResult {
  attempted: number; // symbols in the universe
  fetched:   number; // fetched fresh from the provider this run
  cached:    number; // skipped - cache still within TTL
  failed:    number; // provider returned null or threw
}

const FETCH_DELAY_MS = 150; // be gentle with Yahoo - ~500 symbols in ~75s

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Returns null when the earnings-blackout gate is disabled (nothing to do).
 * Never throws for a single-symbol failure - a missing earnings date for one
 * name should not cost the rest of the universe its data.
 */
export async function prefetchFundamentalsForAutoTradeUniverse(): Promise<FundamentalsPrefetchResult | null> {
  if (!earningsBlackoutConfigFromEnv()) return null;

  const yahoo = getProvider('yahoo');
  if (!yahoo.getFundamentals) return null;

  const universe = autoTradeUniverse();
  const result: FundamentalsPrefetchResult = {
    attempted: universe.length,
    fetched:   0,
    cached:    0,
    failed:    0,
  };

  for (const entry of universe) {
    if (getCachedFundamentals(entry.symbol)) {
      result.cached++;
      continue;
    }
    try {
      const fundamentals = await yahoo.getFundamentals(entry.symbol);
      if (fundamentals) {
        saveFundamentals(entry.symbol, fundamentals);
        result.fetched++;
      } else {
        result.failed++;
      }
    } catch {
      result.failed++;
    }
    await sleep(FETCH_DELAY_MS);
  }

  return result;
}
