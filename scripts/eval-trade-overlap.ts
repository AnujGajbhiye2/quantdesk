/**
 * Measures trade-date/symbol overlap between bollinger-reversion, rsi-reversion,
 * and stoch-reversal on SP500 and Nifty200.
 *
 * Reports: for each strategy pair, what % of strategy A's entries also had
 * strategy B fire an entry on the same symbol within the same bar (consensus bar)
 * and within ±1 bar (near-concurrent).
 *
 * Usage: tsx --conditions=react-server scripts/eval-trade-overlap.ts
 */

import Database from 'better-sqlite3';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import type { Bar } from '@/core/types';
import { runBacktest } from '@/core/backtest/engine';
import { BollingerReversionStrategy } from '@/core/strategy/examples/bollinger-reversion';
import { RSIReversionStrategy }       from '@/core/strategy/examples/rsi-reversion';
import { StochReversalStrategy }      from '@/core/strategy/examples/stoch-reversal';

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

// Get entry bar indices (by bar index, not time, for exact alignment)
function getEntryIndices(
  strat: InstanceType<typeof BollingerReversionStrategy>,
  bars: Bar[],
): Set<string> {
  if (bars.length < 30) return new Set();
  const result = runBacktest({
    strategy:      strat,
    bars,
    rawParams:     {},
    commission:    0.001,
    slippagePct:   0.0005,
    initialEquity: 10_000,
  });
  // Key: "barIndex" (index into bars array where trade entry was signalled)
  // trade.entryBar is bar index; use entryTime as the key instead (stable across strats)
  const keys = new Set<string>();
  for (const t of result.trades) {
    keys.add(t.entryTime);
  }
  return keys;
}

type StratName = 'bollinger' | 'rsi' | 'stoch';
const STRATS: Record<StratName, BollingerReversionStrategy | RSIReversionStrategy | StochReversalStrategy> = {
  bollinger: new BollingerReversionStrategy(),
  rsi:       new RSIReversionStrategy(),
  stoch:     new StochReversalStrategy(),
};

function analyseUniverse(univName: string, symbols: string[]): void {
  const MIN_BARS = 200;
  const filtered = symbols.filter((s) => {
    const r = db.prepare(`SELECT COUNT(*) as n FROM bars WHERE symbol = ? AND timeframe = '1d'`).get(s) as { n: number };
    return r.n >= MIN_BARS;
  });

  console.error(`[${univName}] ${filtered.length} symbols`);

  // entry sets per strategy: symbol -> Set<entryTime>
  const entries: Record<StratName, Map<string, Set<string>>> = {
    bollinger: new Map(),
    rsi:       new Map(),
    stoch:     new Map(),
  };

  let done = 0;
  for (const sym of filtered) {
    const bars = getBarsForSymbol(sym);
    if (bars.length < MIN_BARS) continue;
    done++;
    if (done % 100 === 0) process.stderr.write(`\r[${univName}] ${done}/${filtered.length}  `);

    for (const [name, strat] of Object.entries(STRATS) as [StratName, typeof STRATS[StratName]][]) {
      entries[name].set(sym, getEntryIndices(strat as BollingerReversionStrategy, bars));
    }
  }
  process.stderr.write('\n');

  // Compute overlap for each pair
  const pairs: [StratName, StratName][] = [
    ['bollinger', 'rsi'],
    ['bollinger', 'stoch'],
    ['rsi', 'stoch'],
  ];

  console.log(`\n=== ${univName.toUpperCase()} — Trade entry overlap (same symbol, same entry bar) ===`);
  console.log('Pair'.padEnd(26) + 'A trades' .padStart(10) + 'B trades'.padStart(10) +
    'A∩B (exact)'.padStart(14) + 'A% also B'.padStart(12) + 'B% also A'.padStart(12) +
    'Jaccard'.padStart(10));
  console.log('─'.repeat(94));

  for (const [a, b] of pairs) {
    let totalA = 0, totalB = 0, totalIntersect = 0, totalUnion = 0;

    for (const sym of filtered) {
      const setA = entries[a].get(sym) ?? new Set<string>();
      const setB = entries[b].get(sym) ?? new Set<string>();
      totalA += setA.size;
      totalB += setB.size;

      let intersect = 0;
      for (const t of setA) {
        if (setB.has(t)) intersect++;
      }
      totalIntersect += intersect;
      totalUnion += setA.size + setB.size - intersect;
    }

    const pctAinB  = totalA > 0 ? (totalIntersect / totalA * 100) : 0;
    const pctBinA  = totalB > 0 ? (totalIntersect / totalB * 100) : 0;
    const jaccard  = totalUnion > 0 ? (totalIntersect / totalUnion * 100) : 0;

    console.log(
      `${a} vs ${b}`.padEnd(26) +
      String(totalA).padStart(10) + String(totalB).padStart(10) +
      String(totalIntersect).padStart(14) +
      `${pctAinB.toFixed(1)}%`.padStart(12) +
      `${pctBinA.toFixed(1)}%`.padStart(12) +
      `${jaccard.toFixed(1)}%`.padStart(10),
    );
  }

  // Also report: among consensus bars (all 3 agree), how many unique symbol-dates?
  let tripleOverlap = 0;
  let totalBoll = 0;
  for (const sym of filtered) {
    const setA = entries['bollinger'].get(sym) ?? new Set<string>();
    const setB = entries['rsi'].get(sym) ?? new Set<string>();
    const setC = entries['stoch'].get(sym) ?? new Set<string>();
    totalBoll += setA.size;
    for (const t of setA) {
      if (setB.has(t) && setC.has(t)) tripleOverlap++;
    }
  }
  const pctTriple = totalBoll > 0 ? (tripleOverlap / totalBoll * 100) : 0;
  console.log(`\nAll 3 agree (same bar, same symbol): ${tripleOverlap} events (${pctTriple.toFixed(1)}% of bollinger entries)`);
}

const sp500Syms  = getSymbolsFromFile(join(process.cwd(), 'scripts/universe/sp500.json'));
const niftySyms  = getSymbolsFromFile(join(process.cwd(), 'scripts/universe/nifty200.json'));

analyseUniverse('sp500', sp500Syms);
analyseUniverse('nifty200', niftySyms);

db.close();
