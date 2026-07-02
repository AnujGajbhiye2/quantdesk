/**
 * Yahoo-vs-Alpaca price reconciliation (SYSTEM_AUDIT_AND_ROADMAP.md Phase 1).
 *
 * Both adapters now claim to return split/dividend-adjusted daily bars
 * (Yahoo: OHLC scaled by adjclose/close; Alpaca: adjustment='all'). This
 * script verifies that claim empirically: fetch the same symbols from both
 * providers over the same window, align bars by date, and report relative
 * close-price divergence. Symbols with recent splits (NVDA 10:1, AVGO 10:1,
 * WMT 3:1, CMG 50:1 - all 2024) are in the default set on purpose: an
 * unadjusted series diverges by the full split ratio before the split date,
 * so any adjustment regression shows up as a massive divergence immediately.
 *
 * Usage:
 *   npm run reconcile-providers
 *   SYMBOLS=NVDA,AAPL FROM=2023-01-01 TOLERANCE_PCT=0.5 npm run reconcile-providers
 *
 * Env:
 *   ALPACA_KEY_ID / ALPACA_SECRET_KEY - required (loaded from .env.local when
 *                                       present via --env-file-if-exists)
 *   SYMBOLS       - comma-separated canonical symbols (default: split-heavy set)
 *   FROM / TO     - date window, YYYY-MM-DD (default: 2023-01-01 .. today)
 *   TOLERANCE_PCT    - per-day |close divergence| counted as an outlier
 *                      (default 0.5). IEX (Alpaca free feed) vs Yahoo
 *                      consolidated closes routinely differ by ~0.03% mean
 *                      with rare ~1-2% single-day spikes - that is feed
 *                      noise, not an adjustment bug.
 *   MAX_OUTLIER_FRAC - max fraction of overlap days allowed over tolerance
 *                      before the symbol fails (default 0.02 = 2%).
 *   SPLIT_BREAK_PCT  - any single day diverging beyond this fails the symbol
 *                      outright (default 5). A missed split adjustment
 *                      diverges by the split ratio (100%+), so this catches
 *                      an adjustment regression unambiguously.
 *
 * Exit code 1 on failure - suitable for CI or a cron with a Telegram wrapper.
 */

import { YahooProvider } from '../src/core/data/providers/yahoo';
import { AlpacaProvider } from '../src/core/data/providers/alpaca';
import type { Bar } from '../src/core/types';

// Liquid names with recent large splits plus two never-split controls.
const DEFAULT_SYMBOLS = ['NVDA', 'AVGO', 'WMT', 'CMG', 'AAPL', 'MSFT'];

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
  daysOverTolerance: number;
  worst: { date: string; yahoo: number; alpaca: number; pct: number }[];
}

function reconcile(symbol: string, yahoo: Bar[], alpaca: Bar[]): SymbolReport {
  const alpacaByDate = new Map(alpaca.map((b) => [b.time.slice(0, 10), b]));
  const rows: { date: string; yahoo: number; alpaca: number; pct: number }[] = [];

  for (const yb of yahoo) {
    const date = yb.time.slice(0, 10);
    const ab = alpacaByDate.get(date);
    if (!ab || yb.close <= 0 || ab.close <= 0) continue;
    const pct = (Math.abs(yb.close - ab.close) / yb.close) * 100;
    rows.push({ date, yahoo: yb.close, alpaca: ab.close, pct });
  }

  const over = rows.filter((r) => r.pct > TOLERANCE_PCT);
  const worst = [...rows].sort((a, b) => b.pct - a.pct).slice(0, 5);
  const meanAbsPct =
    rows.length > 0 ? rows.reduce((s, r) => s + r.pct, 0) / rows.length : 0;

  return {
    symbol,
    overlapDays: rows.length,
    meanAbsPct,
    maxAbsPct: worst[0]?.pct ?? 0,
    daysOverTolerance: over.length,
    worst,
  };
}

async function main(): Promise<void> {
  const keyId = process.env.ALPACA_KEY_ID;
  const secretKey = process.env.ALPACA_SECRET_KEY;
  if (!keyId || !secretKey) {
    console.error(
      'ALPACA_KEY_ID / ALPACA_SECRET_KEY not set - cannot reconcile without the second source.',
    );
    process.exit(1);
  }

  // Construct providers directly (not via the registry) so this works even
  // when ALPACA_ENABLED is off in the running app config.
  const yahoo = new YahooProvider();
  const alpaca = new AlpacaProvider({ keyId, secretKey });

  console.log(
    `Reconciling ${SYMBOLS.length} symbols, ${FROM} .. ${TO}, tolerance ${TOLERANCE_PCT}% on daily closes\n`,
  );

  const reports: SymbolReport[] = [];
  let fetchFailures = 0;

  for (const symbol of SYMBOLS) {
    try {
      const [yBars, aBars] = await Promise.all([
        yahoo.getHistory(symbol, '1d', FROM, TO),
        alpaca.getHistory(symbol, '1d', FROM, TO),
      ]);
      if (yBars.length === 0 || aBars.length === 0) {
        console.error(
          `SKIP ${symbol}: empty series (yahoo=${yBars.length}, alpaca=${aBars.length})`,
        );
        fetchFailures++;
        continue;
      }
      reports.push(reconcile(symbol, yBars, aBars));
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
      r.maxAbsPct <= SPLIT_BREAK_PCT &&
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
          `       ${w.date}  yahoo=${w.yahoo.toFixed(2)}  alpaca=${w.alpaca.toFixed(2)}  diff=${w.pct.toFixed(2)}%`,
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
