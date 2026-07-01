/**
 * ADX ranging-market gate experiment.
 *
 * Compares per-symbol ADX < 25 gate vs no gate for the three mean-reversion
 * strategies (bollinger-reversion, rsi-reversion, stoch-reversal) across SP500
 * and Nifty200. Gating logic lives inside each strategy's onBar via adxMax param.
 *
 * Usage:
 *   tsx --conditions=react-server scripts/eval-adx-gate.ts
 *
 * Config (env vars):
 *   TRAIN_FRAC=0.7   MIN_BARS=200   WINDOWS=3
 *   ADX_MAX=25       (gated threshold; default 25)
 */

import Database from 'libsql';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import type { Bar } from '@/core/types';
import { runWalkForward } from '@/core/backtest/walkforward';
import type { Strategy } from '@/core/strategy/Strategy';

import { RSIReversionStrategy }      from '@/core/strategy/examples/rsi-reversion';
import { BollingerReversionStrategy } from '@/core/strategy/examples/bollinger-reversion';
import { StochReversalStrategy }      from '@/core/strategy/examples/stoch-reversal';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TRAIN_FRAC = Number(process.env.TRAIN_FRAC ?? 0.7);
const WINDOWS    = Number(process.env.WINDOWS    ?? 3);
const MIN_BARS   = Number(process.env.MIN_BARS   ?? 200);
const ADX_MAX    = Number(process.env.ADX_MAX    ?? 25);

const MR_STRATEGIES: Strategy[] = [
  new BollingerReversionStrategy(),
  new RSIReversionStrategy(),
  new StochReversalStrategy(),
];

type UniverseName = 'sp500' | 'nifty200';
const UNIVERSE_FILES: Record<UniverseName, string> = {
  sp500:    join(process.cwd(), 'scripts/universe/sp500.json'),
  nifty200: join(process.cwd(), 'scripts/universe/nifty200.json'),
};

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

const DB_PATH = join(process.cwd(), 'data/quantdesk.db');
const db = new Database(DB_PATH, { readonly: true });

function getSymbolsFromFile(path: string): string[] {
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown[];
  return raw.map((s) => (typeof s === 'string' ? s : (s as { symbol: string }).symbol));
}

function getBars(symbol: string): Bar[] {
  return db.prepare(
    `SELECT time, open, high, low, close, volume FROM bars
     WHERE symbol = ? AND timeframe = '1d' ORDER BY time ASC`,
  ).all(symbol) as Bar[];
}

// ---------------------------------------------------------------------------
// Accumulator
// ---------------------------------------------------------------------------

interface Agg {
  oosSharpeSum: number;
  oosMaxDDSum:  number;
  oosTrades:    number;
  profWinSum:   number;
  n:            number;
}

function emptyAgg(): Agg {
  return { oosSharpeSum: 0, oosMaxDDSum: 0, oosTrades: 0, profWinSum: 0, n: 0 };
}

// ---------------------------------------------------------------------------
// Run one universe x one param set
// ---------------------------------------------------------------------------

function runUniverse(
  universe: UniverseName,
  adxMax: number,
  label: string,
): Map<string, Agg> {
  const symbols = getSymbolsFromFile(UNIVERSE_FILES[universe]).filter((sym) => {
    const row = db.prepare(
      `SELECT COUNT(*) as n FROM bars WHERE symbol = ? AND timeframe = '1d'`,
    ).get(sym) as { n: number };
    return row.n >= MIN_BARS;
  });

  const accs = new Map<string, Agg>();
  for (const s of MR_STRATEGIES) accs.set(s.id, emptyAgg());

  const total = symbols.length * MR_STRATEGIES.length;
  let done = 0;

  for (const sym of symbols) {
    const bars = getBars(sym);
    if (bars.length < MIN_BARS) continue;

    for (const strat of MR_STRATEGIES) {
      done++;
      if (done % 300 === 0) {
        process.stderr.write(`\r[${universe}][${label}] ${((done/total)*100).toFixed(1)}% (${done}/${total})   `);
      }

      const acc = accs.get(strat.id)!;
      try {
        const result = runWalkForward({
          strategy:      strat,
          bars,
          rawParams:     { adxMax },
          mode:          'rolling',
          trainFrac:     TRAIN_FRAC,
          windows:       WINDOWS,
          commission:    0.001,
          slippagePct:   0.0005,
          initialEquity: 10_000,
          barsPerYear:   252,
        });

        if (result.oosAggregate.numTrades === 0 && result.inSample.numTrades === 0) continue;

        acc.n++;
        acc.oosSharpeSum += result.oosAggregate.sharpe;
        acc.oosMaxDDSum  += result.oosAggregate.maxDrawdownPct;
        acc.oosTrades    += result.oosAggregate.numTrades;
        acc.profWinSum   += result.consistency.profitableWindowFrac;
      } catch {
        // skip symbol
      }
    }
  }

  process.stderr.write('\n');
  return accs;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('\nADX Gate Experiment - Mean Reversion Strategies');
console.log(`Config: trainFrac=${TRAIN_FRAC}, windows=${WINDOWS}, minBars=${MIN_BARS}`);
console.log(`Commission: 10bps | Slippage: 5bps`);
console.log(`ADX gate threshold: ${ADX_MAX} (gated) vs 100 (ungated)\n`);

type Row = {
  strategyId: string;
  universe:   UniverseName;
  ungatedSharpe: number; ungatedDD: number; ungatedTrades: number; ungatedProfWin: number;
  gatedSharpe:   number; gatedDD:   number; gatedTrades:   number; gatedProfWin:   number;
};

const rows: Row[] = [];

for (const universe of ['sp500', 'nifty200'] as UniverseName[]) {
  console.error(`\n=== ${universe.toUpperCase()} ===`);

  const t0 = Date.now();
  const ungated = runUniverse(universe, 100, 'ungated');
  const gated   = runUniverse(universe, ADX_MAX, 'gated');
  console.error(`[${universe}] done in ${((Date.now()-t0)/1000).toFixed(1)}s`);

  for (const strat of MR_STRATEGIES) {
    const u = ungated.get(strat.id)!;
    const g = gated.get(strat.id)!;
    const un = Math.max(u.n, 1);
    const gn = Math.max(g.n, 1);

    rows.push({
      strategyId: strat.id,
      universe,
      ungatedSharpe:  u.oosSharpeSum / un,
      ungatedDD:      u.oosMaxDDSum  / un,
      ungatedTrades:  u.oosTrades,
      ungatedProfWin: u.profWinSum   / un,
      gatedSharpe:    g.oosSharpeSum / gn,
      gatedDD:        g.oosMaxDDSum  / gn,
      gatedTrades:    g.oosTrades,
      gatedProfWin:   g.profWinSum   / gn,
    });
  }
}

// ---------------------------------------------------------------------------
// Print comparison table
// ---------------------------------------------------------------------------

const H = '─'.repeat(130);
console.log('\n' + H);
console.log(
  'Strategy'.padEnd(22) + 'Universe'.padEnd(10) +
  '│ OOS Sharpe'.padStart(12) + ' (ungated→gated  Δ)'.padEnd(22) +
  '│ OOS DD%'.padStart(11) + ' (ungated→gated  Δ)'.padEnd(22) +
  '│ Trades'.padStart(10) + ' (ungated→gated  Δ%)'.padEnd(22) +
  '│ ProfWin%'.padStart(12) + ' (ungated→gated  Δ)',
);
console.log(H);

function d(n: number, decimals = 2): string { return n.toFixed(decimals); }
function sign(n: number): string { return n > 0 ? '+' : ''; }

for (const r of rows) {
  const dSharpe   = r.gatedSharpe  - r.ungatedSharpe;
  const dDD       = r.gatedDD      - r.ungatedDD;
  const tradePct  = r.ungatedTrades > 0 ? ((r.gatedTrades - r.ungatedTrades) / r.ungatedTrades) * 100 : 0;
  const dProfWin  = (r.gatedProfWin - r.ungatedProfWin) * 100;

  const sharpeOk  = dSharpe  >  0 ? '✓' : '✗';
  const ddOk      = dDD      <  0 ? '✓' : '✗';
  const profWinOk = dProfWin >= 0 ? '✓' : '✗';

  console.log(
    r.strategyId.padEnd(22) + r.universe.padEnd(10) +
    '│ ' + d(r.ungatedSharpe) + ' → ' + d(r.gatedSharpe) + ` (${sign(dSharpe)}${d(dSharpe)}) ${sharpeOk}`.padEnd(18) +
    '│ ' + d(r.ungatedDD) + ' → ' + d(r.gatedDD) + ` (${sign(dDD)}${d(dDD)}) ${ddOk}`.padEnd(18) +
    '│ ' + String(r.ungatedTrades).padStart(6) + ' → ' + String(r.gatedTrades).padStart(6) + ` (${sign(tradePct)}${d(tradePct, 1)}%)`.padEnd(12) +
    '│ ' + d(r.ungatedProfWin * 100, 1) + '% → ' + d(r.gatedProfWin * 100, 1) + `% (${sign(dProfWin)}${d(dProfWin, 1)}pp) ${profWinOk}`,
  );
}

console.log(H);

// Summary
console.log('\nAcceptance criteria (ADX gate accepted if ALL of the below hold in BOTH universes for a strategy):');
console.log('  [1] OOS Sharpe improves (Δ > 0)');
console.log('  [2] OOS DD% reduces (Δ < 0)');
console.log('  [3] ProfWin% does not decrease (Δ >= 0)');
console.log('  [4] Trade count reduction < 50% (gate does not collapse signal entirely)');
console.log('');

for (const strat of MR_STRATEGIES) {
  const universeRows = rows.filter((r) => r.strategyId === strat.id);
  const passes = universeRows.every((r) => {
    const dSharpe  = r.gatedSharpe  - r.ungatedSharpe;
    const dDD      = r.gatedDD      - r.ungatedDD;
    const dProfWin = r.gatedProfWin - r.ungatedProfWin;
    const tradePct = r.ungatedTrades > 0 ? (r.gatedTrades - r.ungatedTrades) / r.ungatedTrades : 0;
    return dSharpe > 0 && dDD < 0 && dProfWin >= 0 && tradePct > -0.5;
  });

  const tradePcts = universeRows.map((r) =>
    r.ungatedTrades > 0 ? ((r.gatedTrades - r.ungatedTrades) / r.ungatedTrades * 100) : 0,
  );
  const avgTradePct = tradePcts.reduce((a, b) => a + b, 0) / tradePcts.length;

  const tradeSignal = Math.abs(avgTradePct) < 5
    ? 'WARN: <5% trade reduction - gate barely fires'
    : Math.abs(avgTradePct) > 20
    ? `INFO: ${d(avgTradePct, 1)}% trade reduction - meaningful filtering`
    : `INFO: ${d(avgTradePct, 1)}% trade reduction`;

  console.log(`  ${strat.id.padEnd(24)} ${passes ? 'ACCEPT gate' : 'REJECT gate'}  ${tradeSignal}`);
}

db.close();
console.log('\nDone.');
