/**
 * Time-split walk-forward evaluation for the cross-sectional momentum
 * portfolio (see src/core/backtest/cross-sectional.ts).
 *
 * Unlike eval-walkforward.ts (which loops one strategy x one symbol at a
 * time), this is a SINGLE portfolio backtest over the whole SP500 universe,
 * split by TIME: an in-sample run over the first TRAIN_FRAC of the shared
 * date range, and one or more out-of-sample runs over the remainder.
 *
 * Usage:
 *   npx tsx --conditions=react-server scripts/eval-cross-sectional.ts
 *
 * Config (env):
 *   TRAIN_FRAC=0.7        - fraction of the date range used for IS
 *   WINDOWS=3             - number of sequential OOS sub-windows
 *   MIN_BARS=300          - skip symbols with fewer bars (needs lookback+skip warmup)
 *   TOP_N=20              - names held at a time
 *   REBALANCE_DAYS=21     - trading days between rebalances (~monthly)
 *   LOOKBACK=252          - momentum lookback bars (~12 months)
 *   SKIP=21               - bars excluded from the end of the lookback (~1 month)
 *
 * ============================================================================
 * SURVIVORSHIP BIAS: the SP500 universe below is sourced from a PRESENT-DAY
 * constituent snapshot (scripts/universe/sp500.json). When the
 * index_membership_changes table is populated (npm run build-pit-membership),
 * this eval passes point-in-time membership into the backtest so each
 * rebalance only ranks symbols that were actually in the index on that date -
 * removing the SELECTION half of the bias. The PRICE half remains on free
 * data: names that delisted before today usually have no Yahoo history, so
 * they still cannot be held. Set PIT=0 to force the old unfiltered mode for
 * a before/after comparison. When the table is empty the eval falls back to
 * unfiltered mode and says so loudly.
 * ============================================================================
 */

import Database from 'libsql';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import type { Bar } from '@/core/types';
import type { MembershipChange } from '@/core/data/pit-membership';
import { runCrossSectional, type CrossSectionalResult } from '@/core/backtest/cross-sectional';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TRAIN_FRAC      = Number(process.env.TRAIN_FRAC      ?? 0.7);
const WINDOWS         = Number(process.env.WINDOWS         ?? 3);
const MIN_BARS        = Number(process.env.MIN_BARS        ?? 300);
const TOP_N           = Number(process.env.TOP_N           ?? 20);
const REBALANCE_DAYS  = Number(process.env.REBALANCE_DAYS  ?? 21);
const LOOKBACK        = Number(process.env.LOOKBACK        ?? 252);
const SKIP            = Number(process.env.SKIP            ?? 21);

const UNIVERSE_FILE = join(process.cwd(), 'scripts/universe/sp500.json');
const DB_PATH        = join(process.cwd(), 'data/quantdesk.db');

// ---------------------------------------------------------------------------
// DB - query bars directly (no server-only chain), same pattern as
// eval-walkforward.ts
// ---------------------------------------------------------------------------

const db = new Database(DB_PATH, { readonly: true });

function getSymbolsFromFile(path: string): string[] {
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown[];
  return raw.map((s) => (typeof s === 'string' ? s : (s as { symbol: string }).symbol));
}

function getBarsForSymbol(symbol: string): Bar[] {
  return db.prepare(
    `SELECT time, open, high, low, close, volume
     FROM bars WHERE symbol = ? AND timeframe = '1d'
     ORDER BY time ASC`,
  ).all(symbol) as Bar[];
}

function getMembershipChanges(): MembershipChange[] {
  try {
    return db.prepare(
      `SELECT effective_date AS effectiveDate, symbol, action
       FROM index_membership_changes WHERE index_name = 'sp500'
       ORDER BY effective_date ASC`,
    ).all() as MembershipChange[];
  } catch {
    return []; // table absent in this snapshot - fall back to unfiltered mode
  }
}

// ---------------------------------------------------------------------------
// Load universe
// ---------------------------------------------------------------------------

console.log('\nCross-sectional momentum - time-split walk-forward evaluation');
console.log(`Config: trainFrac=${TRAIN_FRAC}, windows=${WINDOWS}, minBars=${MIN_BARS}, topN=${TOP_N}, rebalanceDays=${REBALANCE_DAYS}, lookback=${LOOKBACK}, skip=${SKIP}`);
console.log('Commission: 10bps round-trip | Slippage: 5bps\n');

const symbols = getSymbolsFromFile(UNIVERSE_FILE);
const membershipChanges = process.env.PIT === '0' ? [] : getMembershipChanges();
const pitActive = membershipChanges.length > 0;
if (pitActive) {
  console.log(`*** PIT membership ACTIVE: ${membershipChanges.length} change events - each rebalance`);
  console.log('*** only ranks symbols that were index members on that date (selection bias');
  console.log('*** removed). Price-history bias remains for delisted names on free data. ***\n');
} else {
  console.log('*** SURVIVORSHIP BIAS: PIT membership table empty or PIT=0 - present-day');
  console.log('*** SP500 snapshot applied retroactively, delisted names absent, returns');
  console.log('*** optimistically biased upward. Run: npm run build-pit-membership ***\n');
}
const bars: Record<string, Bar[]> = {};
let loaded = 0;
let skipped = 0;
for (const sym of symbols) {
  const b = getBarsForSymbol(sym);
  if (b.length < MIN_BARS) { skipped++; continue; }
  bars[sym] = b;
  loaded++;
}
console.log(`Universe: ${loaded}/${symbols.length} symbols have >= ${MIN_BARS} bars (${skipped} skipped)\n`);

// ---------------------------------------------------------------------------
// Determine the shared date range and the IS/OOS split point
// ---------------------------------------------------------------------------

const dateSet = new Set<string>();
for (const sym of Object.keys(bars)) {
  for (const b of bars[sym]) dateSet.add(b.time);
}
const allDates = Array.from(dateSet).sort();

if (allDates.length === 0) {
  console.error('No bars loaded - aborting.');
  db.close();
  process.exit(1);
}

const splitIdx  = Math.floor(allDates.length * TRAIN_FRAC);
const splitDate = allDates[Math.min(splitIdx, allDates.length - 1)];

const runParams = {
  bars,
  rebalanceDays: REBALANCE_DAYS,
  lookbackBars:  LOOKBACK,
  skipBars:      SKIP,
  topN:          TOP_N,
  commission:    0.001,   // 10bps round-trip, matches eval-walkforward.ts
  slippagePct:   0.0005,  // 5bps
  initialEquity: 10_000,
  barsPerYear:   252,
  membership: pitActive
    ? { currentMembers: symbols, changes: membershipChanges }
    : undefined,
};

// ---------------------------------------------------------------------------
// IS run: full range up to the split date
// ---------------------------------------------------------------------------

const isResult = runCrossSectional({
  ...runParams,
  activeFrom: allDates[0],
  activeTo:   splitDate,
});

// ---------------------------------------------------------------------------
// OOS runs: sequential windows across the remainder
// ---------------------------------------------------------------------------

const oosDates = allDates.slice(splitIdx);
const oosResults: CrossSectionalResult[] = [];
if (oosDates.length > 1) {
  const windowSize = Math.max(1, Math.floor(oosDates.length / WINDOWS));
  for (let w = 0; w < WINDOWS; w++) {
    const from = oosDates[w * windowSize];
    const toIdx = w === WINDOWS - 1 ? oosDates.length - 1 : (w + 1) * windowSize - 1;
    const to = oosDates[Math.min(toIdx, oosDates.length - 1)];
    if (!from || !to || from > to) continue;
    oosResults.push(runCrossSectional({ ...runParams, activeFrom: from, activeTo: to }));
  }
}

// ---------------------------------------------------------------------------
// Aggregate OOS metrics + consistency
// ---------------------------------------------------------------------------

function fmt(n: number, decimals = 2): string {
  return Number.isFinite(n) ? n.toFixed(decimals).padStart(9) : 'NaN'.padStart(9);
}

const oosSharpeAvg  = oosResults.length > 0 ? oosResults.reduce((s, r) => s + r.metrics.sharpe, 0) / oosResults.length : 0;
const oosCagrAvg    = oosResults.length > 0 ? oosResults.reduce((s, r) => s + r.metrics.cagr, 0) / oosResults.length : 0;
const oosDDAvg      = oosResults.length > 0 ? oosResults.reduce((s, r) => s + r.metrics.maxDrawdownPct, 0) / oosResults.length : 0;
const oosTradesSum  = oosResults.reduce((s, r) => s + r.metrics.numTrades, 0);
const profitableWindowFrac = oosResults.length > 0
  ? oosResults.filter((r) => r.metrics.totalReturnPct > 0).length / oosResults.length
  : 0;
const oosReturnAvg  = oosResults.length > 0 ? oosResults.reduce((s, r) => s + r.metrics.totalReturnPct, 0) / oosResults.length : 0;
const decayPct      = isResult.metrics.totalReturnPct - oosReturnAvg;

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const H = '─'.repeat(112);
console.log(H);
console.log(
  'Period'.padEnd(14) +
  'Range'.padEnd(24) +
  'Sharpe'.padStart(9) + ' CAGR%'.padStart(9) + ' MaxDD%'.padStart(9) +
  ' Trades'.padStart(9) + ' TotRet%'.padStart(10),
);
console.log(H);
console.log(
  'IS'.padEnd(14) +
  `${isResult.range.from} to ${isResult.range.to}`.padEnd(24) +
  fmt(isResult.metrics.sharpe) + fmt(isResult.metrics.cagr) + fmt(isResult.metrics.maxDrawdownPct) +
  String(isResult.metrics.numTrades).padStart(9) + fmt(isResult.metrics.totalReturnPct).padStart(10),
);
oosResults.forEach((r, i) => {
  console.log(
    `OOS window ${i + 1}`.padEnd(14) +
    `${r.range.from} to ${r.range.to}`.padEnd(24) +
    fmt(r.metrics.sharpe) + fmt(r.metrics.cagr) + fmt(r.metrics.maxDrawdownPct) +
    String(r.metrics.numTrades).padStart(9) + fmt(r.metrics.totalReturnPct).padStart(10),
  );
});
console.log(H);
console.log(
  'OOS avg'.padEnd(14) + ''.padEnd(24) +
  fmt(oosSharpeAvg) + fmt(oosCagrAvg) + fmt(oosDDAvg) +
  String(oosTradesSum).padStart(9) + fmt(oosReturnAvg).padStart(10),
);
console.log(H);

console.log(`\nProfitable OOS windows: ${(profitableWindowFrac * 100).toFixed(1)}%`);
console.log(`Decay (IS return - mean OOS return): ${decayPct.toFixed(2)}pp`);

const verdict = oosSharpeAvg > 0.5 ? 'PASS' : oosSharpeAvg > 0 ? 'WEAK' : 'FAIL';
console.log(`\nOOS Sharpe (avg across windows): ${oosSharpeAvg.toFixed(2)}  ${verdict}`);
console.log('(current best single-symbol strategy: 0.42 OOS Sharpe, bollinger-reversion)');

console.log('\nNote: exposurePct/exposureSharpe in the underlying metrics are not');
console.log('meaningful for this multi-position portfolio (computeMetrics was written');
console.log('for a single concurrent position) - sharpe/cagr/maxDrawdownPct above are');
console.log('computed directly off the portfolio equity curve and are the numbers to trust.');

db.close();
console.log('\nDone.');
