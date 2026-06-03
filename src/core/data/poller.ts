/**
 * Throttled, resumable data poller.
 *
 * Ingests or refreshes a universe of symbols respecting per-provider rate limits.
 * Designed to run as a long-lived CLI process that can be interrupted and resumed
 * (run it again tomorrow - symbols up-to-date are skipped).
 *
 * Rate limiting strategy:
 *   - sleeps between each symbol fetch to stay under reqPerMin
 *   - counts requests consumed against dailyCap; stops early when cap is reached
 *   - processes oldest-stale symbols first so the DB fills evenly
 */

import 'server-only';
import { ingestUniverse, refreshUniverse, type UniverseEntry, type IngestResult } from './ingest';
import { getLatestBarTime } from '@/core/db/bars';
import type { Timeframe } from '@/core/types';

export interface PollerOpts {
  /** Symbols to poll. */
  universe: UniverseEntry[];
  timeframe?: Timeframe;
  /** Max requests per minute (conservative default for Yahoo: 30). */
  reqPerMin?: number;
  /** Max requests to make this run. Stop early when reached. Default: Infinity. */
  dailyCap?: number;
  /** Emit progress messages. Default: no-op. */
  onProgress?: (msg: string) => void;
  /** History start date for first-time ingests. Default: '2015-01-01'. */
  from?: string;
}

export interface PollResult {
  symbol:    string;
  barsAdded: number;
  skipped:   boolean;
  error?:    string;
}

/**
 * Poll all symbols in the universe, respecting rate limits.
 * Symbols already up-to-date (latestBarTime >= yesterday) are skipped.
 * Stops when `dailyCap` requests have been consumed.
 *
 * @returns results for every symbol (including skipped ones)
 */
export async function pollUniverse(opts: PollerOpts): Promise<PollResult[]> {
  const {
    universe,
    timeframe  = '1d',
    reqPerMin  = 30,
    dailyCap   = Infinity,
    onProgress = () => {},
    from       = '2015-01-01',
  } = opts;

  const minDelayMs = Math.ceil(60_000 / reqPerMin);
  const yesterday  = yesterdayString();

  // Sort by stale-ness: symbols with no data first, then oldest latestBarTime first.
  const sorted = [...universe].sort((a, b) => {
    const ta = getLatestBarTime(a.symbol, timeframe) ?? '0000-00-00';
    const tb = getLatestBarTime(b.symbol, timeframe) ?? '0000-00-00';
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });

  const results: PollResult[] = [];
  let requestsUsed = 0;

  for (const entry of sorted) {
    const latestBar = getLatestBarTime(entry.symbol, timeframe);

    // Skip if already up-to-date
    if (latestBar && latestBar >= yesterday) {
      onProgress(`SKIP   ${entry.symbol} (up-to-date: ${latestBar})`);
      results.push({ symbol: entry.symbol, barsAdded: 0, skipped: true });
      continue;
    }

    // Check daily cap before consuming a request
    if (requestsUsed >= dailyCap) {
      onProgress(`CAP    ${entry.symbol} (daily cap of ${dailyCap} reached - re-run tomorrow)`);
      results.push({ symbol: entry.symbol, barsAdded: 0, skipped: true, error: 'daily cap reached' });
      continue;
    }

    // Throttle: sleep before each fetch (except the very first)
    if (requestsUsed > 0) {
      await sleep(minDelayMs);
    }

    const t0 = Date.now();

    try {
      let ingestResults: IngestResult[];
      if (!latestBar) {
        // First time: full ingest from `from` date
        ingestResults = await ingestUniverse([entry], from, timeframe);
      } else {
        // Incremental refresh
        ingestResults = await refreshUniverse([entry], timeframe);
      }
      requestsUsed++;

      const r = ingestResults[0];
      if (r?.error) {
        onProgress(`ERROR  ${entry.symbol}: ${r.error}`);
        results.push({ symbol: entry.symbol, barsAdded: 0, skipped: false, error: r.error });
      } else {
        const bars = r?.barsAdded ?? 0;
        const ms   = Date.now() - t0;
        onProgress(`OK     ${entry.symbol}: +${bars} bars (${ms}ms, req ${requestsUsed}/${dailyCap === Infinity ? '∞' : dailyCap})`);
        results.push({ symbol: entry.symbol, barsAdded: bars, skipped: false });
      }
    } catch (err) {
      requestsUsed++;
      const msg = err instanceof Error ? err.message : String(err);
      onProgress(`ERROR  ${entry.symbol}: ${msg}`);
      results.push({ symbol: entry.symbol, barsAdded: 0, skipped: false, error: msg });
    }
  }

  const fetched  = results.filter((r) => !r.skipped);
  const errors   = fetched.filter((r) => r.error).length;
  const totalBars = fetched.reduce((s, r) => s + r.barsAdded, 0);
  onProgress(`\nDone. ${fetched.length - errors}/${fetched.length} fetched, ${results.filter((r) => r.skipped).length} skipped, ${totalBars} total bars, ${errors} error(s).`);

  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function yesterdayString(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
