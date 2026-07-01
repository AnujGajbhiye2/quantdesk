/**
 * Improvement validation harness - SP500, 3 mean-reversion strategies only.
 *
 * Usage:
 *   FEATURE=none     npx tsx --conditions=react-server scripts/eval-improvements.ts
 *   FEATURE=trailing npx tsx --conditions=react-server scripts/eval-improvements.ts
 *   FEATURE=gap      npx tsx --conditions=react-server scripts/eval-improvements.ts
 *   FEATURE=dynsize  npx tsx --conditions=react-server scripts/eval-improvements.ts
 *   FEATURE=partial  npx tsx --conditions=react-server scripts/eval-improvements.ts
 *   FEATURE=all      npx tsx --conditions=react-server scripts/eval-improvements.ts
 *
 * Config (env):
 *   STOP_PCT=0.05      fixed stop pct injected into rawParams (default 0.05 = 5%)
 *   TARGET_PCT=0.10    fixed target pct injected into rawParams (default 0.10 = 10%)
 *   TRAIL_ACT=0.03     trailing stop activation threshold (default 0.03)
 *   TRAIL_DIST=0.015   trailing stop distance from peak (default 0.015)
 *   MAX_SLIP=0.03      max entry gap-up to accept (default 0.03)
 *   GAP_DN=0.02        gap-down threshold to widen stop (default 0.02)
 *   PARTIAL_FRAC=0.5   fraction of position to close at partial target (default 0.5)
 *   PARTIAL_AT=0.5     fraction of target distance to trigger partial (default 0.5)
 *   TRAIN_FRAC=0.7     fraction of bars for IS (default 0.7)
 *   WINDOWS=3          OOS windows (default 3)
 *   MIN_BARS=200       skip symbols with fewer bars (default 200)
 */

import Database from 'libsql';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import type { Bar } from '@/core/types';
import { runWalkForward, type WalkForwardResult } from '@/core/backtest/walkforward';
import type { Strategy } from '@/core/strategy/Strategy';

import { RSIReversionStrategy }      from '@/core/strategy/examples/rsi-reversion';
import { BollingerReversionStrategy } from '@/core/strategy/examples/bollinger-reversion';
import { StochReversalStrategy }      from '@/core/strategy/examples/stoch-reversal';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const FEATURE      = (process.env.FEATURE ?? 'none') as 'none' | 'trailing' | 'gap' | 'dynsize' | 'partial' | 'all';
const STOP_PCT     = Number(process.env.STOP_PCT    ?? 0.05);
const TARGET_PCT   = Number(process.env.TARGET_PCT  ?? 0.10);
const TRAIL_ACT    = Number(process.env.TRAIL_ACT   ?? 0.03);
const TRAIL_DIST   = Number(process.env.TRAIL_DIST  ?? 0.015);
const MAX_SLIP     = Number(process.env.MAX_SLIP    ?? 0.03);
const GAP_DN       = Number(process.env.GAP_DN      ?? 0.02);
const PARTIAL_FRAC = Number(process.env.PARTIAL_FRAC ?? 0.5);
const PARTIAL_AT   = Number(process.env.PARTIAL_AT   ?? 0.5);
const TRAIN_FRAC   = Number(process.env.TRAIN_FRAC   ?? 0.7);
const WINDOWS      = Number(process.env.WINDOWS      ?? 3);
const MIN_BARS     = Number(process.env.MIN_BARS     ?? 200);

/**
 * Strategy rawParams: stopPct + targetPct only (strategy-specific).
 * Improvement params go into engine config (BacktestConfig / WalkForwardConfig).
 */
const RAW_PARAMS = { stopPct: STOP_PCT, targetPct: TARGET_PCT };

interface EngineOverrides {
  trailingStopActivationPct?: number;
  trailingStopDistancePct?:   number;
  maxEntrySlippagePct?:       number;
  gapDownWidenPct?:           number;
  dynamicSizing?:             boolean;
  partialExitFraction?:       number;
  partialExitAtTargetPct?:    number;
}

function buildEngineOverrides(feature: typeof FEATURE): EngineOverrides {
  const cfg: EngineOverrides = {};
  if (feature === 'trailing' || feature === 'all') {
    cfg.trailingStopActivationPct = TRAIL_ACT;
    cfg.trailingStopDistancePct   = TRAIL_DIST;
  }
  if (feature === 'gap' || feature === 'all') {
    cfg.maxEntrySlippagePct = MAX_SLIP;
    cfg.gapDownWidenPct     = GAP_DN;
  }
  if (feature === 'dynsize' || feature === 'all') {
    cfg.dynamicSizing = true;
  }
  if (feature === 'partial' || feature === 'all') {
    cfg.partialExitFraction    = PARTIAL_FRAC;
    cfg.partialExitAtTargetPct = PARTIAL_AT;
  }
  return cfg;
}

const STRATEGIES: Strategy[] = [
  new RSIReversionStrategy(),
  new BollingerReversionStrategy(),
  new StochReversalStrategy(),
];

// ---------------------------------------------------------------------------
// DB
// ---------------------------------------------------------------------------

const DB_PATH = join(process.cwd(), 'data/quantdesk.db');
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

// Regime index bars
const INDEX_BARS: Record<string, Bar[]> = {};
for (const idx of ['^GSPC']) {
  const rows = db.prepare(
    `SELECT time, open, high, low, close, volume FROM bars WHERE symbol = ? AND timeframe = '1d' ORDER BY time ASC`,
  ).all(idx) as Bar[];
  if (rows.length > 0) INDEX_BARS[idx] = rows;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

interface StrategyAgg {
  strategyId:  string;
  symbolsRun:  number;
  isSharpe:    number;
  isWinRate:   number;
  isTrades:    number;
  isAvgWinPct: number;
  isAvgLosPct: number;
  isAvgHold:   number;
  oosSharpe:    number;
  oosWinRate:   number;
  oosTrades:    number;
  oosAvgWinPct: number;
  oosAvgLosPct: number;
  oosAvgHold:   number;
  oosMaxDD:     number;
  profWinFrac:  number;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const SP500_FILE = join(process.cwd(), 'scripts/universe/sp500.json');
const symbols = getSymbolsFromFile(SP500_FILE).filter((sym) => {
  const row = db.prepare(
    `SELECT COUNT(*) as n FROM bars WHERE symbol = ? AND timeframe = '1d'`,
  ).get(sym) as { n: number };
  return row.n >= MIN_BARS;
});

console.log(`\n========== eval-improvements: FEATURE=${FEATURE} ==========`);
console.log(`stopPct=${STOP_PCT*100}%  targetPct=${TARGET_PCT*100}%`);
if (FEATURE === 'trailing' || FEATURE === 'all')
  console.log(`  trailing: activation=${TRAIL_ACT*100}%  distance=${TRAIL_DIST*100}%`);
if (FEATURE === 'gap' || FEATURE === 'all')
  console.log(`  gap: maxSlip=${MAX_SLIP*100}%  gapDown=${GAP_DN*100}%`);
if (FEATURE === 'dynsize' || FEATURE === 'all')
  console.log(`  dynsize: ON (signalStrength() 0.5x..2x)`);
if (FEATURE === 'partial' || FEATURE === 'all')
  console.log(`  partial: frac=${PARTIAL_FRAC*100}%  at=${PARTIAL_AT*100}%ofTarget`);
console.log(`SP500 symbols: ${symbols.length}  trainFrac=${TRAIN_FRAC}  windows=${WINDOWS}\n`);

const engineOverrides = buildEngineOverrides(FEATURE);

const accs = new Map<string, {
  isSharpeSum: number; isWinRateSum: number; isTrades: number;
  isAvgWinSum: number; isAvgLosSum: number; isAvgHoldSum: number;
  oosSharpeSum: number; oosWinRateSum: number; oosTrades: number;
  oosAvgWinSum: number; oosAvgLosSum: number; oosAvgHoldSum: number;
  oosMaxDDSum: number; profWinSum: number;
  symbolsRun: number;
}>();

for (const strat of STRATEGIES) {
  accs.set(strat.id, {
    isSharpeSum: 0, isWinRateSum: 0, isTrades: 0,
    isAvgWinSum: 0, isAvgLosSum: 0, isAvgHoldSum: 0,
    oosSharpeSum: 0, oosWinRateSum: 0, oosTrades: 0,
    oosAvgWinSum: 0, oosAvgLosSum: 0, oosAvgHoldSum: 0,
    oosMaxDDSum: 0, profWinSum: 0,
    symbolsRun: 0,
  });
}

const total = symbols.length * STRATEGIES.length;
let done = 0;

for (const sym of symbols) {
  const bars = getBarsForSymbol(sym);
  if (bars.length < MIN_BARS) continue;

  for (const strat of STRATEGIES) {
    done++;
    if (done % 500 === 0) {
      const pct = ((done / total) * 100).toFixed(1);
      process.stderr.write(`\r${pct}% (${done}/${total})         `);
    }

    const acc = accs.get(strat.id)!;
    const regimeBars: Record<string, readonly Bar[]> | undefined = strat.regime
      ? (() => {
          const idx = strat.regime!.index;
          return INDEX_BARS[idx] ? { [idx]: INDEX_BARS[idx] } : undefined;
        })()
      : undefined;

    let result: WalkForwardResult;
    try {
      result = runWalkForward({
        strategy: strat,
        bars,
        rawParams: RAW_PARAMS,
        mode:      'rolling',
        trainFrac: TRAIN_FRAC,
        windows:   WINDOWS,
        commission:    0.001,
        slippagePct:   0.0005,
        initialEquity: 10_000,
        barsPerYear:   252,
        regimeBars,
        ...engineOverrides,
      });
    } catch {
      continue;
    }

    if (result.oosAggregate.numTrades === 0 && result.inSample.numTrades === 0) continue;

    acc.symbolsRun++;
    const is  = result.inSample;
    const oos = result.oosAggregate;

    acc.isSharpeSum   += is.sharpe;
    acc.isWinRateSum  += is.winRate;
    acc.isTrades      += is.numTrades;
    acc.isAvgWinSum   += is.avgWinPct;
    acc.isAvgLosSum   += is.avgLossPct;
    acc.isAvgHoldSum  += is.avgHoldingBars;

    acc.oosSharpeSum  += oos.sharpe;
    acc.oosWinRateSum += oos.winRate;
    acc.oosTrades     += oos.numTrades;
    acc.oosAvgWinSum  += oos.avgWinPct;
    acc.oosAvgLosSum  += oos.avgLossPct;
    acc.oosAvgHoldSum += oos.avgHoldingBars;
    acc.oosMaxDDSum   += oos.maxDrawdownPct;
    acc.profWinSum    += result.consistency.profitableWindowFrac;
  }
}

process.stderr.write('\n');

// Build output
const rows: StrategyAgg[] = [];
for (const [id, acc] of accs) {
  const n = Math.max(acc.symbolsRun, 1);
  rows.push({
    strategyId:  id,
    symbolsRun:  acc.symbolsRun,
    isSharpe:    acc.isSharpeSum  / n,
    isWinRate:   acc.isWinRateSum / n,
    isTrades:    acc.isTrades,
    isAvgWinPct: acc.isAvgWinSum  / n,
    isAvgLosPct: acc.isAvgLosSum  / n,
    isAvgHold:   acc.isAvgHoldSum / n,
    oosSharpe:    acc.oosSharpeSum  / n,
    oosWinRate:   acc.oosWinRateSum / n,
    oosTrades:    acc.oosTrades,
    oosAvgWinPct: acc.oosAvgWinSum  / n,
    oosAvgLosPct: acc.oosAvgLosSum  / n,
    oosAvgHold:   acc.oosAvgHoldSum / n,
    oosMaxDD:     acc.oosMaxDDSum   / n,
    profWinFrac:  acc.profWinSum    / n,
  });
}

// Print results
const H = '─'.repeat(130);
console.log(H);
console.log(
  'Strategy'.padEnd(24) +
  'Syms'.padStart(5) +
  ' │ IS Shrpe  IS WR%  IS AvgW  IS AvgL  IS Hold  IS Trd' +
  ' │ OOS Shrpe OOS WR% OOS AvgW OOS AvgL OOS Hold OOS Trd OOS DD% ProfW%',
);
console.log(H);
function f(n: number, d = 2): string { return n.toFixed(d).padStart(8); }
for (const r of rows) {
  console.log(
    r.strategyId.padEnd(24) +
    String(r.symbolsRun).padStart(5) +
    ' │' +
    f(r.isSharpe) + f(r.isWinRate*100) + f(r.isAvgWinPct) + f(r.isAvgLosPct) + f(r.isAvgHold,1) + String(r.isTrades).padStart(8) +
    ' │' +
    f(r.oosSharpe) + f(r.oosWinRate*100) + f(r.oosAvgWinPct) + f(r.oosAvgLosPct) + f(r.oosAvgHold,1) + String(r.oosTrades).padStart(9) + f(r.oosMaxDD) + f(r.profWinFrac*100),
  );
}
console.log(H);
console.log(`\nIS = full symbol history | OOS = last ${Math.round((1-TRAIN_FRAC)*100)}% of bars`);
console.log('AvgW/AvgL = avg win%/avg loss% per trade | Hold = avg bars held | DD = max drawdown%');

db.close();
console.log('\nDone.');
