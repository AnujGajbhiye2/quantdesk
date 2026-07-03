/**
 * Cross-provider price reconciliation (SYSTEM_AUDIT_AND_ROADMAP.md Phase 1,
 * generalized for provider migrations in IMPROVEMENT_PLAN.md WS1).
 *
 * Fetches the same symbols from two providers over the same window, aligns
 * bars by date, and reports relative close-price divergence. Both sides must
 * return split/dividend-adjusted daily bars - a missed adjustment diverges by
 * the full split ratio before the split date, so symbols with recent large
 * splits (NVDA 10:1, AVGO 10:1, WMT 3:1, CMG 50:1 - all 2024) are in the
 * default set on purpose, plus two never-split controls.
 *
 * Usage:
 *   npm run reconcile-providers
 *   SYMBOLS=NVDA,AAPL FROM=2023-01-01 TOLERANCE_PCT=0.5 npm run reconcile-providers
 *   PROVIDER_A=yahoo PROVIDER_B=twelve-data npm run reconcile-providers
 *
 * Env:
 *   PROVIDER_A / PROVIDER_B - provider ids to compare (default: yahoo / alpaca).
 *                             Constructed directly from their own env keys, NOT
 *                             via the registry, so this works even when the
 *                             provider's enable flag is off in the app config.
 *   ALPACA_KEY_ID / ALPACA_SECRET_KEY - required when either side is alpaca
 *   TWELVE_DATA_API_KEY               - required when either side is twelve-data
 *   SYMBOLS       - comma-separated canonical symbols (default: split-heavy set)
 *   FROM / TO     - date window, YYYY-MM-DD (default: 2023-01-01 .. today)
 *   TOLERANCE_PCT    - per-day |close divergence| counted as an outlier
 *                      (default 0.5). IEX (Alpaca free feed) vs Yahoo
 *                      consolidated closes routinely differ by ~0.03% mean
 *                      with rare ~1-2% single-day spikes - that is feed
 *                      noise, not an adjustment bug.
 *   MAX_OUTLIER_FRAC - max fraction of overlap days allowed over tolerance
 *                      before the symbol fails (default 0.02 = 2%).
 *   SPLIT_BREAK_PCT  - 2+ CONSECUTIVE days diverging beyond this fail the
 *                      symbol outright (default 5). A missed split adjustment
 *                      diverges by the split ratio (100%+) on every day before
 *                      the event, so consecutive days catch a regression
 *                      unambiguously - while a single isolated spike is feed
 *                      noise (empirical: CMG 6.8% Yahoo-vs-IEX on 2022-01-24
 *                      only, mean 0.074% elsewhere).
 *
 * Exit code 1 on failure - suitable for CI or a cron with a Telegram wrapper.
 */

import { providerFromEnv } from './lib/provider-from-env';
import type { DataProvider } from '../src/core/data/DataProvider';
import type { Bar } from '../src/core/types';

// Liquid names with recent large splits plus two never-split controls.
const DEFAULT_SYMBOLS = ['NVDA', 'AVGO', 'WMT', 'CMG', 'AAPL', 'MSFT'];

const PROVIDER_A = (process.env.PROVIDER_A ?? 'yahoo').trim();
const PROVIDER_B = (process.env.PROVIDER_B ?? 'alpaca').trim();
const SYMBOLS = (process.env.SYMBOLS ?? DEFAULT_SYMBOLS.join(','))
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const FROM = process.env.FROM ?? '2023-01-01';
const TO = process.env.TO ?? new Date().toISOString().slice(0, 10);
const TOLERANCE_PCT = Number(process.env.TOLERANCE_PCT ?? 0.5);
const MAX_OUTLIER_FRAC = Number(process.env.MAX_OUTLIER_FRAC ?? 0.02);
const SPLIT_BREAK_PCT = Number(process.env.SPLIT_BREAK_PCT ?? 5);

interface SymbolReport {
  symbol: string;
  overlapDays: number;
  meanAbsPct: number;
  maxAbsPct: number;
  maxConsecutiveOverBreak: number;
  daysOverTolerance: number;
  worst: { date: string; a: number; b: number; pct: number }[];
}

function reconcile(symbol: string, aBars: Bar[], bBars: Bar[]): SymbolReport {
  const bByDate = new Map(bBars.map((bar) => [bar.time.slice(0, 10), bar]));
  const rows: { date: string; a: number; b: number; pct: number }[] = [];

  for (const ab of aBars) {
    const date = ab.time.slice(0, 10);
    const bb = bByDate.get(date);
    if (!bb || ab.close <= 0 || bb.close <= 0) continue;
    const pct = (Math.abs(ab.close - bb.close) / ab.close) * 100;
    rows.push({ date, a: ab.close, b: bb.close, pct });
  }

  // rows are in date order (aBars is sorted) - track the longest run of
  // consecutive days beyond the split-break threshold.
  let run = 0;
  let maxRun = 0;
  for (const r of rows) {
    run = r.pct > SPLIT_BREAK_PCT ? run + 1 : 0;
    if (run > maxRun) maxRun = run;
  }

  const over = rows.filter((r) => r.pct > TOLERANCE_PCT);
  const worst = [...rows].sort((x, y) => y.pct - x.pct).slice(0, 5);
  const meanAbsPct =
    rows.length > 0 ? rows.reduce((s, r) => s + r.pct, 0) / rows.length : 0;

  return {
    symbol,
    overlapDays: rows.length,
    meanAbsPct,
    maxAbsPct: worst[0]?.pct ?? 0,
    maxConsecutiveOverBreak: maxRun,
    daysOverTolerance: over.length,
    worst,
  };
}

async function main(): Promise<void> {
  let providerA: DataProvider;
  let providerB: DataProvider;
  try {
    providerA = providerFromEnv(PROVIDER_A);
    providerB = providerFromEnv(PROVIDER_B);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  console.log(
    `Reconciling ${PROVIDER_A} vs ${PROVIDER_B}: ${SYMBOLS.length} symbols, ` +
    `${FROM} .. ${TO}, tolerance ${TOLERANCE_PCT}% on daily closes\n`,
  );

  const reports: SymbolReport[] = [];
  let fetchFailures = 0;

  for (const symbol of SYMBOLS) {
    try {
      const [aBars, bBars] = await Promise.all([
        providerA.getHistory(symbol, '1d', FROM, TO),
        providerB.getHistory(symbol, '1d', FROM, TO),
      ]);
      if (aBars.length === 0 || bBars.length === 0) {
        console.error(
          `SKIP ${symbol}: empty series (${PROVIDER_A}=${aBars.length}, ${PROVIDER_B}=${bBars.length})`,
        );
        fetchFailures++;
        continue;
      }
      reports.push(reconcile(symbol, aBars, bBars));
    } catch (err) {
      console.error(
        `SKIP ${symbol}: fetch failed - ${err instanceof Error ? err.message : String(err)}`,
      );
      fetchFailures++;
    }
  }

  let failed = fetchFailures > 0;

  for (const r of reports) {
    const outlierFrac = r.overlapDays > 0 ? r.daysOverTolerance / r.overlapDays : 1;
    const ok =
      r.overlapDays > 0 &&
      r.maxConsecutiveOverBreak < 2 &&
      outlierFrac <= MAX_OUTLIER_FRAC;
    if (!ok) failed = true;
    console.log(
      `${ok ? 'OK  ' : 'FAIL'} ${r.symbol.padEnd(6)} overlap=${String(r.overlapDays).padStart(4)}d ` +
        `mean=${r.meanAbsPct.toFixed(3)}% max=${r.maxAbsPct.toFixed(3)}% ` +
        `outliers=${r.daysOverTolerance}d (${(outlierFrac * 100).toFixed(1)}%)`,
    );
    if (!ok) {
      for (const w of r.worst) {
        console.log(
          `       ${w.date}  ${PROVIDER_A}=${w.a.toFixed(2)}  ${PROVIDER_B}=${w.b.toFixed(2)}  diff=${w.pct.toFixed(2)}%`,
        );
      }
    }
  }

  if (reports.length === 0) failed = true;

  console.log(
    failed
      ? '\nRESULT: DIVERGENCE OR FETCH FAILURE - do not trust cross-provider backtests until resolved.'
      : '\nRESULT: providers agree within tolerance on all symbols.',
  );
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
