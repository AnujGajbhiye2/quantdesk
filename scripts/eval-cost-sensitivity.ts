/**
 * Cost sensitivity analysis for production-tier strategies.
 *
 * Runs OOS walk-forward at 1x / 2x / 3x current cost assumptions
 * for rsi2-pullback, down-streak, ema-pullback, ma44-support.
 *
 * Usage: tsx --conditions=react-server scripts/eval-cost-sensitivity.ts
 */

import Database from 'libsql';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import type { Bar } from '@/core/types';
import { runWalkForward } from '@/core/backtest/walkforward';
import { Rsi2PullbackStrategy } from '@/core/strategy/examples/rsi2-pullback';
import { DownStreakStrategy }   from '@/core/strategy/examples/down-streak';
import { EmaPullbackStrategy }  from '@/core/strategy/examples/ema-pullback';
import { Ma44SupportStrategy }  from '@/core/strategy/examples/ma44-support';

const DB_PATH = join(process.cwd(), 'data/quantdesk.db');
const db = new Database(DB_PATH, { readonly: true });

function getSymbolsFromFile(path: string): string[] {
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown[];
  return raw.map((s) => (typeof s === 'string' ? s : (s as { symbol: string }).symbol));
}

function getBarsForSymbol(symbol: string): Bar[] {
  return db.prepare(
    `SELECT time, open, high, low, close, volume FROM bars
     WHERE symbol = ? AND timeframe = '1d' ORDER BY time ASC`,
  ).all(symbol) as Bar[];
}

const STRATS = [
  new Rsi2PullbackStrategy(),
  new DownStreakStrategy(),
  new EmaPullbackStrategy(),
  new Ma44SupportStrategy(),
];

const COST_TIERS = [
  { label: '1x (10bps + 5bps)',  commission: 0.001,  slippage: 0.0005 },
  { label: '2x (20bps + 10bps)', commission: 0.002,  slippage: 0.001  },
  { label: '3x (30bps + 15bps)', commission: 0.003,  slippage: 0.0015 },
];

const UNIVERSES = [
  { name: 'sp500',    file: join(process.cwd(), 'scripts/universe/sp500.json') },
  { name: 'nifty200', file: join(process.cwd(), 'scripts/universe/nifty200.json') },
];

const MIN_BARS   = 200;
const TRAIN_FRAC = 0.7;
const WINDOWS    = 3;

for (const univ of UNIVERSES) {
  const allSymbols = getSymbolsFromFile(univ.file);
  const symbols = allSymbols.filter((s) => {
    const r = db.prepare(`SELECT COUNT(*) as n FROM bars WHERE symbol = ? AND timeframe = '1d'`).get(s) as { n: number };
    return r.n >= MIN_BARS;
  });

  console.error(`\n=== ${univ.name.toUpperCase()} (${symbols.length} symbols) ===`);

  // results[stratId][costTier] = { oosSharpe, oosWinRate, oosMaxDD }
  const results: Record<string, Record<string, { oos: number; wr: number; dd: number; trades: number; n: number }>> = {};
  for (const s of STRATS) {
    results[s.id] = {};
    for (const c of COST_TIERS) {
      results[s.id][c.label] = { oos: 0, wr: 0, dd: 0, trades: 0, n: 0 };
    }
  }

  let done = 0;
  const total = symbols.length * STRATS.length * COST_TIERS.length;

  for (const sym of symbols) {
    const bars = getBarsForSymbol(sym);
    if (bars.length < MIN_BARS) continue;

    for (const strat of STRATS) {
      for (const cost of COST_TIERS) {
        done++;
        if (done % 1000 === 0) {
          process.stderr.write(`\r[${univ.name}] ${((done/total)*100).toFixed(1)}%  `);
        }

        try {
          const wf = runWalkForward({
            strategy:      strat,
            bars,
            mode:          'rolling',
            trainFrac:     TRAIN_FRAC,
            windows:       WINDOWS,
            commission:    cost.commission,
            slippagePct:   cost.slippage,
            initialEquity: 10_000,
            barsPerYear:   252,
          });

          if (wf.oosAggregate.numTrades === 0 && wf.inSample.numTrades === 0) continue;

          const acc = results[strat.id][cost.label];
          acc.n++;
          acc.oos    += wf.oosAggregate.sharpe;
          acc.wr     += wf.oosAggregate.winRate;
          acc.dd     += wf.oosAggregate.maxDrawdownPct;
          acc.trades += wf.oosAggregate.numTrades;
        } catch {
          // skip
        }
      }
    }
  }
  process.stderr.write('\n');

  // Print table
  console.log(`\n=== ${univ.name.toUpperCase()} — OOS Sharpe by cost tier ===`);
  console.log('Strategy'.padEnd(20) + COST_TIERS.map(c => c.label.padStart(22)).join(''));
  console.log('─'.repeat(20 + 22 * COST_TIERS.length));

  for (const strat of STRATS) {
    let row = strat.id.padEnd(20);
    for (const cost of COST_TIERS) {
      const acc = results[strat.id][cost.label];
      const n = Math.max(acc.n, 1);
      const sharpe = (acc.oos / n).toFixed(3);
      row += sharpe.padStart(22);
    }
    console.log(row);
  }

  // Also report win rate and max DD at each tier
  console.log(`\n=== ${univ.name.toUpperCase()} — OOS WinRate% by cost tier ===`);
  console.log('Strategy'.padEnd(20) + COST_TIERS.map(c => c.label.padStart(22)).join(''));
  console.log('─'.repeat(20 + 22 * COST_TIERS.length));
  for (const strat of STRATS) {
    let row = strat.id.padEnd(20);
    for (const cost of COST_TIERS) {
      const acc = results[strat.id][cost.label];
      const n = Math.max(acc.n, 1);
      row += `${(acc.wr / n * 100).toFixed(1)}%`.padStart(22);
    }
    console.log(row);
  }

  console.log(`\n=== ${univ.name.toUpperCase()} — OOS MaxDD% by cost tier ===`);
  console.log('Strategy'.padEnd(20) + COST_TIERS.map(c => c.label.padStart(22)).join(''));
  console.log('─'.repeat(20 + 22 * COST_TIERS.length));
  for (const strat of STRATS) {
    let row = strat.id.padEnd(20);
    for (const cost of COST_TIERS) {
      const acc = results[strat.id][cost.label];
      const n = Math.max(acc.n, 1);
      row += `${(acc.dd / n).toFixed(1)}%`.padStart(22);
    }
    console.log(row);
  }
}

db.close();
console.log('\nDone.');
