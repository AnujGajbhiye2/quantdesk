/**
 * Walk-forward OOS validation across all 12 strategies × SP500 + Nifty200.
 *
 * Usage:
 *   tsx --conditions=react-server scripts/eval-walkforward.ts
 *
 * Outputs per-strategy OOS and IS metrics side-by-side to stdout so the
 * gap between in-sample and out-of-sample edge is plainly visible.
 *
 * Config:
 *   TRAIN_FRAC=0.7  (default) - fraction of bars reserved for "training"
 *   WINDOWS=3       (default) - number of OOS slices
 *   MIN_BARS=200    (default) - skip symbols with fewer bars
 *   UNIVERSE=sp500,nifty200 (default) - comma-separated universe names
 */

import Database from 'better-sqlite3';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import type { Bar } from '@/core/types';
import { runWalkForward, type WalkForwardResult } from '@/core/backtest/walkforward';
import type { Strategy } from '@/core/strategy/Strategy';

// Import strategies directly - bypasses registry validation overhead
import { RSIReversionStrategy }      from '@/core/strategy/examples/rsi-reversion';
import { MACrossoverStrategy }        from '@/core/strategy/examples/ma-crossover';
import { MACDMomentumStrategy }       from '@/core/strategy/examples/macd-momentum';
import { BollingerReversionStrategy } from '@/core/strategy/examples/bollinger-reversion';
import { DonchianBreakoutStrategy }   from '@/core/strategy/examples/donchian-breakout';
import { RocMomentumStrategy }        from '@/core/strategy/examples/roc-momentum';
import { AtrTrendStrategy }           from '@/core/strategy/examples/atr-trend';
import { StochReversalStrategy }      from '@/core/strategy/examples/stoch-reversal';
import { Rsi2PullbackStrategy }       from '@/core/strategy/examples/rsi2-pullback';
import { DownStreakStrategy }         from '@/core/strategy/examples/down-streak';
import { EmaPullbackStrategy }        from '@/core/strategy/examples/ema-pullback';
import { Ma44SupportStrategy }        from '@/core/strategy/examples/ma44-support';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TRAIN_FRAC   = Number(process.env.TRAIN_FRAC ?? 0.7);
const WINDOWS      = Number(process.env.WINDOWS    ?? 3);
const MIN_BARS     = Number(process.env.MIN_BARS   ?? 200);
// Set REGIME_GATE=0 to run without regime filtering (baseline comparison).
// Default on since strategies now declare regime requirements.
const REGIME_GATE  = process.env.REGIME_GATE !== '0';

const STRATEGIES: Strategy[] = [
  new RSIReversionStrategy(),
  new MACrossoverStrategy(),
  new MACDMomentumStrategy(),
  new BollingerReversionStrategy(),
  new DonchianBreakoutStrategy(),
  new RocMomentumStrategy(),
  new AtrTrendStrategy(),
  new StochReversalStrategy(),
  new Rsi2PullbackStrategy(),
  new DownStreakStrategy(),
  new EmaPullbackStrategy(),
  new Ma44SupportStrategy(),
];

type UniverseName = 'sp500' | 'nifty200';

const UNIVERSE_FILES: Record<UniverseName, string> = {
  sp500:    join(process.cwd(), 'scripts/universe/sp500.json'),
  nifty200: join(process.cwd(), 'scripts/universe/nifty200.json'),
};

// ---------------------------------------------------------------------------
// DB - query bars directly (no server-only chain)
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

// Pre-load index bars used by regime gates. Loaded once, shared across all runs.
// ^GSPC is the regime index for all 7 gated strategies (US and IN universes).
// ^NSEI available as fallback if needed in future.
const INDEX_BARS: Record<string, Bar[]> = {};
for (const idx of ['^GSPC', '^NSEI']) {
  const rows = db.prepare(
    `SELECT time, open, high, low, close, volume FROM bars WHERE symbol = ? AND timeframe = '1d' ORDER BY time ASC`,
  ).all(idx) as Bar[];
  if (rows.length > 0) INDEX_BARS[idx] = rows;
}

// ---------------------------------------------------------------------------
// Aggregation types
// ---------------------------------------------------------------------------

interface StrategyUniverseAgg {
  strategyId:   string;
  tier:         string;
  universe:     UniverseName;
  symbolsRun:   number;
  symbolsSkipped: number;
  // IS (full bar history)
  isSharpe:     number;
  isWinRate:    number;
  isMaxDD:      number;
  isTrades:     number;
  // OOS aggregate (last 30% of each symbol's history)
  oosSharpe:    number;
  oosWinRate:   number;
  oosMaxDD:     number;
  oosTrades:    number;
  // Consistency
  profitableWindowFrac: number; // fraction of OOS windows with +ve return
  oosWinRateStd:        number; // std dev of win-rate across windows
  decayPct:             number; // IS totalReturn - mean OOS totalReturn
}

// ---------------------------------------------------------------------------
// Run per-universe
// ---------------------------------------------------------------------------

function runUniverse(universe: UniverseName): Map<string, StrategyUniverseAgg> {
  const symbols = getSymbolsFromFile(UNIVERSE_FILES[universe]);
  const filtered = symbols.filter((sym) => {
    // Quick bar count check before loading all bars
    const row = db.prepare(
      `SELECT COUNT(*) as n FROM bars WHERE symbol = ? AND timeframe = '1d'`,
    ).get(sym) as { n: number };
    return row.n >= MIN_BARS;
  });

  console.error(`[${universe}] ${filtered.length}/${symbols.length} symbols have >= ${MIN_BARS} bars`);

  // Accumulators per strategy
  const accs = new Map<string, {
    id: string; tier: string;
    // sums for averaging
    isSharpeSum: number; isWinRateSum: number; isMaxDDSum: number; isTrades: number;
    oosSharpeSum: number; oosWinRateSum: number; oosMaxDDSum: number; oosTrades: number;
    profWinSum: number; oosWinRateStdSum: number; decaySum: number;
    symbolsRun: number; symbolsSkipped: number;
  }>();

  for (const strat of STRATEGIES) {
    accs.set(strat.id, {
      id: strat.id, tier: strat.tier ?? 'baseline',
      isSharpeSum: 0, isWinRateSum: 0, isMaxDDSum: 0, isTrades: 0,
      oosSharpeSum: 0, oosWinRateSum: 0, oosMaxDDSum: 0, oosTrades: 0,
      profWinSum: 0, oosWinRateStdSum: 0, decaySum: 0,
      symbolsRun: 0, symbolsSkipped: 0,
    });
  }

  const total = filtered.length * STRATEGIES.length;
  let done = 0;

  for (const sym of filtered) {
    const bars = getBarsForSymbol(sym);
    if (bars.length < MIN_BARS) continue;

    for (const strat of STRATEGIES) {
      done++;
      if (done % 500 === 0) {
        const pct = ((done / total) * 100).toFixed(1);
        process.stderr.write(`\r[${universe}] ${pct}% (${done}/${total})         `);
      }

      const acc = accs.get(strat.id)!;

      let result: WalkForwardResult;
      try {
        // Build regimeBars when the strategy declares a regime and REGIME_GATE is on.
        // The strategy's req.index determines which index bars to supply.
        const regimeBars: Record<string, readonly Bar[]> | undefined =
          REGIME_GATE && strat.regime
            ? (() => {
                const idx = strat.regime.index;
                return INDEX_BARS[idx] ? { [idx]: INDEX_BARS[idx] } : undefined;
              })()
            : undefined;

        result = runWalkForward({
          strategy:  strat,
          bars,
          mode:      'rolling',
          trainFrac: TRAIN_FRAC,
          windows:   WINDOWS,
          commission:   0.001,  // 10 bps round-trip
          slippagePct:  0.0005, // 5 bps
          initialEquity: 10_000,
          barsPerYear:   252,
          regimeBars,
        });
      } catch {
        acc.symbolsSkipped++;
        continue;
      }

      // Only count symbols that produced at least 1 OOS trade (avoids diluting
      // metrics with symbols where the strategy simply never fired)
      if (result.oosAggregate.numTrades === 0 && result.inSample.numTrades === 0) {
        acc.symbolsSkipped++;
        continue;
      }

      acc.symbolsRun++;

      // IS metrics
      acc.isSharpeSum   += result.inSample.sharpe;
      acc.isWinRateSum  += result.inSample.winRate;
      acc.isMaxDDSum    += result.inSample.maxDrawdownPct;
      acc.isTrades      += result.inSample.numTrades;

      // OOS aggregate metrics
      acc.oosSharpeSum   += result.oosAggregate.sharpe;
      acc.oosWinRateSum  += result.oosAggregate.winRate;
      acc.oosMaxDDSum    += result.oosAggregate.maxDrawdownPct;
      acc.oosTrades      += result.oosAggregate.numTrades;

      // Consistency
      acc.profWinSum       += result.consistency.profitableWindowFrac;
      acc.oosWinRateStdSum += result.consistency.oosWinRateStd;
      acc.decaySum         += result.consistency.inSampleVsOosDecayPct;
    }
  }

  process.stderr.write('\n');

  // Build output map
  const out = new Map<string, StrategyUniverseAgg>();
  for (const [id, acc] of accs) {
    const n = Math.max(acc.symbolsRun, 1);
    out.set(id, {
      strategyId:   acc.id,
      tier:         acc.tier,
      universe,
      symbolsRun:   acc.symbolsRun,
      symbolsSkipped: acc.symbolsSkipped,
      isSharpe:     acc.isSharpeSum   / n,
      isWinRate:    acc.isWinRateSum  / n,
      isMaxDD:      acc.isMaxDDSum    / n,
      isTrades:     acc.isTrades,
      oosSharpe:    acc.oosSharpeSum  / n,
      oosWinRate:   acc.oosWinRateSum / n,
      oosMaxDD:     acc.oosMaxDDSum   / n,
      oosTrades:    acc.oosTrades,
      profitableWindowFrac: acc.profWinSum       / n,
      oosWinRateStd:        acc.oosWinRateStdSum / n,
      decayPct:             acc.decaySum         / n,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function fmt(n: number, decimals = 2): string {
  return n.toFixed(decimals).padStart(7);
}

function printTable(rows: StrategyUniverseAgg[]): void {
  // Sort by OOS Sharpe descending
  rows.sort((a, b) => b.oosSharpe - a.oosSharpe);

  const H = '─'.repeat(118);
  console.log(H);
  console.log(
    'Strategy'.padEnd(22) +
    'Tier'.padEnd(12) +
    'Syms'.padStart(5) +
    ' │ ' +
    'IS Sharpe'.padStart(9) + ' IS WR%'.padStart(8) + ' IS DD%'.padStart(8) + ' IS Trd'.padStart(8) +
    ' │ ' +
    'OOS Shrpe'.padStart(9) + ' OOS WR%'.padStart(9) + ' OOS DD%'.padStart(9) + ' OOS Trd'.padStart(9) +
    ' │ ' +
    'ProfWin%'.padStart(9) + ' WRstd'.padStart(7) + ' Decay'.padStart(7),
  );
  console.log(H);
  for (const r of rows) {
    console.log(
      r.strategyId.padEnd(22) +
      r.tier.padEnd(12) +
      String(r.symbolsRun).padStart(5) +
      ' │ ' +
      fmt(r.isSharpe)          + fmt(r.isWinRate * 100) + fmt(r.isMaxDD)  + String(r.isTrades).padStart(8) +
      ' │ ' +
      fmt(r.oosSharpe)         + fmt(r.oosWinRate * 100).padStart(9) + fmt(r.oosMaxDD).padStart(9) + String(r.oosTrades).padStart(9) +
      ' │ ' +
      fmt(r.profitableWindowFrac * 100).padStart(9) +
      fmt(r.oosWinRateStd * 100).padStart(7) +
      fmt(r.decayPct).padStart(7),
    );
  }
  console.log(H);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const universesToRun: UniverseName[] = ['sp500', 'nifty200'];

console.log(`\nWalk-forward OOS validation`);
console.log(`Config: trainFrac=${TRAIN_FRAC}, windows=${WINDOWS}, minBars=${MIN_BARS}`);
console.log(`Commission: 10bps round-trip | Slippage: 5bps`);
console.log(`Regime gate: ${REGIME_GATE ? 'ON (^GSPC > SMA200 for gated strategies)' : 'OFF (no regime filter)'}\n`);

const allResults: StrategyUniverseAgg[] = [];

for (const u of universesToRun) {
  const t0 = Date.now();
  console.error(`\n=== ${u.toUpperCase()} ===`);
  const res = runUniverse(u);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.error(`[${u}] done in ${elapsed}s`);

  const rows = Array.from(res.values());
  allResults.push(...rows);

  console.log(`\n${'='.repeat(10)} ${u.toUpperCase()} ${'='.repeat(10)}`);
  console.log('Metrics are symbol-averages. IS = full history. OOS = last 30%. ProfWin% = % OOS windows with +ve return. Decay = IS-return minus mean OOS-return (pp).\n');
  printTable(rows);
}

// Combined ranking across both universes
if (universesToRun.length > 1) {
  // Compute weighted average OOS Sharpe across universes per strategy
  const combined = new Map<string, { oos: number; n: number; tier: string }>();
  for (const r of allResults) {
    const c = combined.get(r.strategyId) ?? { oos: 0, n: 0, tier: r.tier };
    c.oos += r.oosSharpe * r.symbolsRun;
    c.n   += r.symbolsRun;
    c.tier = r.tier;
    combined.set(r.strategyId, c);
  }

  console.log('\n\n========== COMBINED RANKING (weighted by symbols run) ==========');
  console.log('Strategy'.padEnd(22) + 'Tier'.padEnd(12) + 'OOS Sharpe (wtd avg)');
  console.log('─'.repeat(55));
  const ranked = Array.from(combined.entries())
    .map(([id, v]) => ({ id, tier: v.tier, oosSharpe: v.n > 0 ? v.oos / v.n : 0 }))
    .sort((a, b) => b.oosSharpe - a.oosSharpe);
  for (const r of ranked) {
    const verdict = r.oosSharpe > 0.5
      ? 'PASS'
      : r.oosSharpe > 0
        ? 'WEAK'
        : 'FAIL';
    console.log(r.id.padEnd(22) + r.tier.padEnd(12) + fmt(r.oosSharpe) + '  ' + verdict);
  }
}

db.close();
console.log('\nDone.');
