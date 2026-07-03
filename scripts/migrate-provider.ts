/**
 * Provider migration tool (IMPROVEMENT_PLAN.md WS1): switch a universe's bar
 * source to a different provider safely - preflight, reconcile, full re-ingest,
 * post-verify. Aborts on the first failure; never leaves a half-switched
 * adjustment basis (the bars table has no provider column, so mixing two
 * providers' adjusted series for one symbol would be silent corruption - this
 * tool always re-ingests the FULL window).
 *
 * Usage:
 *   npm run migrate-provider -- --universe scripts/universe/sp500.json --to alpaca --dry-run
 *   npm run migrate-provider -- --universe scripts/universe/sp500.json --to alpaca
 *
 * Flags:
 *   --universe <path>   universe JSON (array of UniverseEntry) - required
 *   --to <providerId>   target provider id - required. Its env keys must be set
 *                       AND its registry enable flag must be on (the target is
 *                       becoming a primary provider; the app needs it registered).
 *   --from <date>       re-ingest window start (default 2015-01-01)
 *   --timeframes <list> comma-separated (default: 1d)
 *   --sample <n>        reconcile sample size (default 12)
 *   --dry-run           run preflight + reconcile, print the plan, write nothing
 *   --include-indices   also migrate '^'-prefixed index symbols (default: skip -
 *                       index/reference symbols stay on Yahoo, see the provider
 *                       README policy; most providers cannot serve them)
 *
 * Exit code 1 on any failure.
 */

import fs from 'node:fs';
import { providerFromEnv } from './lib/provider-from-env';
import { ingestUniverse, type UniverseEntry } from '../src/core/data/ingest';
import { getBars } from '../src/core/db/bars';
import type { DataProvider } from '../src/core/data/DataProvider';
import type { Bar, Timeframe } from '../src/core/types';

// Same thresholds as reconcile-providers.ts - a missed split adjustment
// diverges by the split ratio, feed noise stays well under these.
const TOLERANCE_PCT = Number(process.env.TOLERANCE_PCT ?? 0.5);
const MAX_OUTLIER_FRAC = Number(process.env.MAX_OUTLIER_FRAC ?? 0.02);
const SPLIT_BREAK_PCT = Number(process.env.SPLIT_BREAK_PCT ?? 5);
// Split-heavy names catch adjustment regressions unambiguously.
const SPLIT_HEAVY = ['NVDA', 'AVGO', 'WMT', 'CMG', 'AAPL', 'MSFT'];

interface Args {
  universePath: string;
  target: string;
  from: string;
  timeframes: Timeframe[];
  sample: number;
  dryRun: boolean;
  includeIndices: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const universePath = get('--universe');
  const target = get('--to');
  if (!universePath || !target) {
    console.error(
      'Usage: npm run migrate-provider -- --universe <path> --to <providerId> ' +
      '[--from 2015-01-01] [--timeframes 1d] [--sample 12] [--dry-run] [--include-indices]',
    );
    process.exit(1);
  }
  return {
    universePath,
    target,
    from: get('--from') ?? '2015-01-01',
    timeframes: (get('--timeframes') ?? '1d').split(',').map((t) => t.trim()) as Timeframe[],
    sample: Number(get('--sample') ?? 12),
    dryRun: argv.includes('--dry-run'),
    includeIndices: argv.includes('--include-indices'),
  };
}

function isIndexSymbol(e: UniverseEntry): boolean {
  return e.symbol.startsWith('^');
}

/**
 * Align two daily series by date and check divergence. Returns null when ok,
 * else a failure message.
 *
 * Adjustment-break detection requires >= 2 CONSECUTIVE overlap days beyond
 * SPLIT_BREAK_PCT: a missed split/dividend adjustment diverges on every day
 * before the event, while a single isolated spike is feed noise (empirically:
 * CMG diverges 6.8% between Yahoo consolidated and Alpaca IEX closes on
 * 2022-01-24 only - a violent reversal session on a thin pre-split name -
 * with 0.074% mean divergence everywhere else).
 */
function divergence(label: string, a: Bar[], b: Bar[]): string | null {
  const bByDate = new Map(b.map((bar) => [bar.time.slice(0, 10), bar]));
  let overlap = 0;
  let outliers = 0;
  let maxPct = 0;
  let breakRun = 0;
  let maxBreakRun = 0;
  for (const ab of a) {
    const bb = bByDate.get(ab.time.slice(0, 10));
    if (!bb || ab.close <= 0 || bb.close <= 0) continue;
    overlap++;
    const pct = (Math.abs(ab.close - bb.close) / ab.close) * 100;
    if (pct > TOLERANCE_PCT) outliers++;
    if (pct > maxPct) maxPct = pct;
    breakRun = pct > SPLIT_BREAK_PCT ? breakRun + 1 : 0;
    if (breakRun > maxBreakRun) maxBreakRun = breakRun;
  }
  if (overlap === 0) return `${label}: no overlapping days`;
  if (maxBreakRun >= 2) {
    return `${label}: ${maxBreakRun} consecutive days > ${SPLIT_BREAK_PCT}% (adjustment-break signature)`;
  }
  if (outliers / overlap > MAX_OUTLIER_FRAC) {
    return `${label}: ${outliers}/${overlap} days over ${TOLERANCE_PCT}% (persistent drift)`;
  }
  console.log(`  OK   ${label}: overlap=${overlap}d max=${maxPct.toFixed(3)}%`);
  return null;
}

function pickSample(universe: UniverseEntry[], n: number): UniverseEntry[] {
  const bySymbol = new Map(universe.map((e) => [e.symbol, e]));
  const sample: UniverseEntry[] = [];
  for (const s of SPLIT_HEAVY) {
    const e = bySymbol.get(s);
    if (e) sample.push(e);
  }
  const rest = universe.filter((e) => !SPLIT_HEAVY.includes(e.symbol));
  while (sample.length < n && rest.length > 0) {
    const i = Math.floor(Math.random() * rest.length);
    sample.push(rest.splice(i, 1)[0]);
  }
  return sample.slice(0, n);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const all = JSON.parse(fs.readFileSync(args.universePath, 'utf-8')) as UniverseEntry[];
  const skippedIndices = args.includeIndices ? [] : all.filter(isIndexSymbol);
  const universe = args.includeIndices ? all : all.filter((e) => !isIndexSymbol(e));
  if (skippedIndices.length > 0) {
    console.log(
      `Skipping ${skippedIndices.length} index symbol(s) (stay on Yahoo per policy): ` +
      skippedIndices.map((e) => e.symbol).join(', '),
    );
  }

  // --- Step 1: preflight -------------------------------------------------
  console.log(`\n[1/4] Preflight: constructing '${args.target}' and probing each timeframe ...`);
  let target: DataProvider;
  try {
    target = providerFromEnv(args.target);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  const probeFrom = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const probeTo = new Date().toISOString().slice(0, 10);
  for (const tf of args.timeframes) {
    const bars = await target.getHistory('AAPL', tf, probeFrom, probeTo);
    if (bars.length === 0) {
      console.error(`Preflight FAILED: '${args.target}' returned 0 ${tf} bars for AAPL.`);
      process.exit(1);
    }
    console.log(`  OK   ${tf}: ${bars.length} probe bars`);
  }

  // --- Step 2: reconcile old vs new on a sample --------------------------
  const sample = pickSample(universe, args.sample);
  console.log(`\n[2/4] Reconcile old vs '${args.target}' on ${sample.length} sample symbols ...`);
  let reconcileFailed = false;
  for (const entry of sample) {
    try {
      const old = providerFromEnv(entry.providerId);
      const [oldBars, newBars] = await Promise.all([
        old.getHistory(entry.symbol, '1d', args.from, probeTo),
        target.getHistory(entry.symbol, '1d', args.from, probeTo),
      ]);
      const fail = divergence(`${entry.symbol} (${entry.providerId} vs ${args.target})`, oldBars, newBars);
      if (fail) {
        console.error(`  FAIL ${fail}`);
        reconcileFailed = true;
      }
    } catch (err) {
      console.error(`  FAIL ${entry.symbol}: ${err instanceof Error ? err.message : String(err)}`);
      reconcileFailed = true;
    }
  }
  if (reconcileFailed) {
    console.error('\nABORT: reconcile failed - never re-point at a diverging source.');
    process.exit(1);
  }

  // --- Step 3/4: re-point + full re-ingest --------------------------------
  const repointed = universe.map((e) => ({ ...e, providerId: args.target }));
  if (args.dryRun) {
    console.log(
      `\n[3/4+4/4] DRY RUN - would re-point ${repointed.length} symbols to '${args.target}' ` +
      `and re-ingest the FULL window ${args.from}..today for timeframes [${args.timeframes.join(', ')}]. ` +
      `Nothing written.`,
    );
    process.exit(0);
  }

  console.log(
    `\n[3/4] Re-point + full re-ingest of ${repointed.length} symbols from '${args.target}', ` +
    `${args.from}..today (full-window overwrite - no cross-provider stitching) ...`,
  );
  for (const tf of args.timeframes) {
    const results = await ingestUniverse(repointed, args.from, tf);
    const errors = results.filter((r) => r.error);
    const bars = results.reduce((s, r) => s + r.barsAdded, 0);
    console.log(`  ${tf}: ${bars} bars upserted, ${errors.length} symbol error(s)`);
    for (const e of errors.slice(0, 10)) console.error(`    ERROR ${e.symbol}: ${e.error}`);
    if (errors.length > results.length * 0.05) {
      console.error(`ABORT: >5% of symbols failed re-ingest on ${tf} - investigate before trusting the DB.`);
      process.exit(1);
    }
  }

  // --- Step 4: post-verify stored data against the OLD provider ----------
  console.log(`\n[4/4] Post-verify: stored closes vs old provider on the sample ...`);
  let verifyFailed = false;
  const verifyFrom = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
  for (const entry of sample) {
    try {
      const old = providerFromEnv(entry.providerId);
      const oldBars = await old.getHistory(entry.symbol, '1d', verifyFrom, probeTo);
      // getBars takes no date range - filter the stored series to the window.
      const stored = getBars(entry.symbol, '1d').filter(
        (b) => b.time.slice(0, 10) >= verifyFrom,
      );
      const fail = divergence(`${entry.symbol} (stored vs ${entry.providerId})`, stored, oldBars);
      if (fail) {
        console.error(`  FAIL ${fail}`);
        verifyFailed = true;
      }
    } catch (err) {
      console.error(`  FAIL ${entry.symbol}: ${err instanceof Error ? err.message : String(err)}`);
      verifyFailed = true;
    }
  }

  if (verifyFailed) {
    console.error(
      '\nRESULT: post-verify FAILED - stored data diverges from the old source. ' +
      'Re-run reconcile-providers to localize, or re-ingest from the old provider to roll back.',
    );
    process.exit(1);
  }
  console.log(`\nRESULT: migration to '${args.target}' complete and verified on the sample.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
