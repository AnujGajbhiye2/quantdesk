/**
 * Parameter plateau/robustness check for the live strategy roster.
 *
 * Not optimization - a stability check. Perturbs each live strategy's key
 * parameter by ±20% around its default and compares OOS walk-forward Sharpe.
 * A strategy whose Sharpe collapses a short distance from its default is
 * living on a knife edge - the default was luck, not edge. A strategy whose
 * neighbourhood holds up is more trustworthy (SYSTEM_AUDIT_AND_ROADMAP.md
 * Phase 5).
 *
 * Usage:
 *   tsx --conditions=react-server scripts/eval-param-plateau.ts
 */

import Database from 'libsql';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import type { Bar } from '@/core/types';
import { runWalkForward } from '@/core/backtest/walkforward';
import type { Strategy } from '@/core/strategy/Strategy';

import { RSIReversionStrategy }       from '@/core/strategy/examples/rsi-reversion';
import { BollingerReversionStrategy } from '@/core/strategy/examples/bollinger-reversion';
import { StochReversalStrategy }      from '@/core/strategy/examples/stoch-reversal';

const TRAIN_FRAC = Number(process.env.TRAIN_FRAC ?? 0.7);
const WINDOWS    = Number(process.env.WINDOWS    ?? 3);
const MIN_BARS   = Number(process.env.MIN_BARS   ?? 200);

interface Variant {
  strategy: Strategy;
  strategyId: string;
  label: string;
  rawParams: Record<string, number>;
}

// Key param, default, and ±20% perturbation for each live strategy.
const VARIANTS: Variant[] = [
  { strategy: new RSIReversionStrategy(),      strategyId: 'rsi-reversion',       label: 'oversold=24 (-20%)', rawParams: { oversold: 24 } },
  { strategy: new RSIReversionStrategy(),      strategyId: 'rsi-reversion',       label: 'oversold=30 (default)', rawParams: { oversold: 30 } },
  { strategy: new RSIReversionStrategy(),      strategyId: 'rsi-reversion',       label: 'oversold=36 (+20%)', rawParams: { oversold: 36 } },

  { strategy: new BollingerReversionStrategy(), strategyId: 'bollinger-reversion', label: 'period=16 (-20%)', rawParams: { period: 16 } },
  { strategy: new BollingerReversionStrategy(), strategyId: 'bollinger-reversion', label: 'period=20 (default)', rawParams: { period: 20 } },
  { strategy: new BollingerReversionStrategy(), strategyId: 'bollinger-reversion', label: 'period=24 (+20%)', rawParams: { period: 24 } },

  { strategy: new StochReversalStrategy(),     strategyId: 'stoch-reversal',      label: 'oversoldLevel=16 (-20%)', rawParams: { oversoldLevel: 16 } },
  { strategy: new StochReversalStrategy(),     strategyId: 'stoch-reversal',      label: 'oversoldLevel=20 (default)', rawParams: { oversoldLevel: 20 } },
  { strategy: new StochReversalStrategy(),     strategyId: 'stoch-reversal',      label: 'oversoldLevel=24 (+20%)', rawParams: { oversoldLevel: 24 } },
];

const SP500_FILE = join(process.cwd(), 'scripts/universe/sp500.json');
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

const symbols = getSymbolsFromFile(SP500_FILE).filter((sym) => {
  const row = db.prepare(`SELECT COUNT(*) as n FROM bars WHERE symbol = ? AND timeframe = '1d'`).get(sym) as { n: number };
  return row.n >= MIN_BARS;
});

console.log('\nParameter Plateau Check - Live Strategy Roster (SP500)');
console.log(`Config: trainFrac=${TRAIN_FRAC}, windows=${WINDOWS}, minBars=${MIN_BARS}, symbols=${symbols.length}\n`);

interface Result { label: string; sharpeSum: number; n: number; }
const results: Result[] = [];

for (const v of VARIANTS) {
  let sharpeSum = 0, n = 0;
  for (const sym of symbols) {
    const bars = getBars(sym);
    if (bars.length < MIN_BARS) continue;
    try {
      const wf = runWalkForward({
        strategy: v.strategy,
        bars,
        rawParams: v.rawParams,
        mode: 'rolling',
        trainFrac: TRAIN_FRAC,
        windows: WINDOWS,
        commission: 0.001,
        slippagePct: 0.0005,
        initialEquity: 10_000,
        barsPerYear: 252,
      });
      if (wf.oosAggregate.numTrades === 0) continue;
      sharpeSum += wf.oosAggregate.sharpe;
      n++;
    } catch { /* skip */ }
  }
  results.push({ label: `${v.strategyId} | ${v.label}`, sharpeSum, n });
  process.stderr.write(`  done: ${v.strategyId} | ${v.label}\n`);
}

console.log('\n' + '─'.repeat(70));
for (const r of results) {
  const avg = r.n > 0 ? r.sharpeSum / r.n : 0;
  console.log(`${r.label.padEnd(45)} OOS Sharpe (avg): ${avg.toFixed(3)}  (n=${r.n})`);
}
console.log('─'.repeat(70));
console.log('\nDone.');
