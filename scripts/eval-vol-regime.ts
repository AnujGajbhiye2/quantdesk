/**
 * Realized-volatility regime filter experiment.
 *
 * Compares "no vol filter" vs "block entries when trailing ^GSPC realized
 * vol exceeds MAX_ANNUALIZED_PCT" for the three live mean-reversion
 * strategies (bollinger-reversion, rsi-reversion, stoch-reversal) on SP500.
 * Uses core/market/regime.ts's 'realized-vol' kind - a free VIX proxy
 * computed from ^GSPC's own price series, no separate VIX ticker ingest
 * required (see SYSTEM_AUDIT_AND_ROADMAP.md Phase 3).
 *
 * Usage:
 *   tsx --conditions=react-server scripts/eval-vol-regime.ts
 *   MAX_ANNUALIZED_PCT=20 tsx --conditions=react-server scripts/eval-vol-regime.ts
 *
 * Config (env vars):
 *   TRAIN_FRAC=0.7   MIN_BARS=200   WINDOWS=3
 *   VOL_PERIOD=21             (trailing window, trading days)
 *   MAX_ANNUALIZED_PCT=25     (gated threshold; default 25% annualized)
 */

import Database from 'libsql';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

import type { Bar } from '@/core/types';
import { runWalkForward } from '@/core/backtest/walkforward';
import type { Strategy } from '@/core/strategy/Strategy';
import type { RegimeRequirement } from '@/core/market/regime';

import { RSIReversionStrategy }      from '@/core/strategy/examples/rsi-reversion';
import { BollingerReversionStrategy } from '@/core/strategy/examples/bollinger-reversion';
import { StochReversalStrategy }      from '@/core/strategy/examples/stoch-reversal';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TRAIN_FRAC = Number(process.env.TRAIN_FRAC ?? 0.7);
const WINDOWS    = Number(process.env.WINDOWS    ?? 3);
const MIN_BARS   = Number(process.env.MIN_BARS   ?? 200);
const VOL_PERIOD = Number(process.env.VOL_PERIOD  ?? 21);
const MAX_ANNUALIZED_PCT = Number(process.env.MAX_ANNUALIZED_PCT ?? 25);

const INDEX_SYMBOL = '^GSPC';

const MR_STRATEGIES: Strategy[] = [
  new BollingerReversionStrategy(),
  new RSIReversionStrategy(),
  new StochReversalStrategy(),
];

/**
 * Return a copy of `strategy` with `.regime` overridden - lets the same eval
 * harness pattern used by eval-adx-gate.ts test an engine-level regime gate
 * (not a strategy param) without touching the live strategy classes.
 *
 * NOT a plain object spread ({...strategy}): onBar/signalStrength are class
 * PROTOTYPE methods on these strategies, not own enumerable instance
 * properties, so {...strategy} silently drops them - the engine then sees
 * onBar === undefined and every backtest quietly produces zero trades.
 * Explicitly forward each interface member, binding methods to the original
 * instance so internal `this` references keep working.
 */
function withRegime(strategy: Strategy, regime?: RegimeRequirement): Strategy {
  return {
    id: strategy.id,
    name: strategy.name,
    description: strategy.description,
    params: strategy.params,
    tier: strategy.tier,
    regime,
    onBar: strategy.onBar.bind(strategy),
    signalStrength: strategy.signalStrength?.bind(strategy),
  };
}

const SP500_FILE = join(process.cwd(), 'scripts/universe/sp500.json');

// ---------------------------------------------------------------------------
// DB
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

const indexBars = getBars(INDEX_SYMBOL);
if (indexBars.length === 0) {
  console.error(`No bars found for ${INDEX_SYMBOL} - ingest it first (regime index).`);
  process.exit(1);
}
const REGIME_BARS = { [INDEX_SYMBOL]: indexBars };

// ---------------------------------------------------------------------------
// Aggregation
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
// Run one param set (gated vs ungated) across the whole universe
// ---------------------------------------------------------------------------

function runUniverse(regime: RegimeRequirement | undefined, label: string): Map<string, Agg> {
  const symbols = getSymbolsFromFile(SP500_FILE).filter((sym) => {
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
        process.stderr.write(`\r[${label}] ${((done / total) * 100).toFixed(1)}% (${done}/${total})   `);
      }

      const acc = accs.get(strat.id)!;
      try {
        const result = runWalkForward({
          strategy:      withRegime(strat, regime),
          bars,
          rawParams:     {},
          mode:          'rolling',
          trainFrac:     TRAIN_FRAC,
          windows:       WINDOWS,
          commission:    0.001,
          slippagePct:   0.0005,
          initialEquity: 10_000,
          barsPerYear:   252,
          regimeBars:    REGIME_BARS,
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

console.log('\nRealized-Vol Regime Filter Experiment - Mean Reversion Strategies (SP500)');
console.log(`Config: trainFrac=${TRAIN_FRAC}, windows=${WINDOWS}, minBars=${MIN_BARS}`);
console.log(`Commission: 10bps | Slippage: 5bps`);
console.log(`Vol filter: block entries when trailing ${VOL_PERIOD}d realized vol of ${INDEX_SYMBOL} > ${MAX_ANNUALIZED_PCT}% annualized\n`);

const gatedRegime: RegimeRequirement = {
  kind: 'realized-vol',
  index: INDEX_SYMBOL,
  period: VOL_PERIOD,
  maxAnnualizedPct: MAX_ANNUALIZED_PCT,
};

const t0 = Date.now();
const ungated = runUniverse(undefined, 'ungated');
const gated   = runUniverse(gatedRegime, 'gated');
console.error(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

type Row = {
  strategyId: string;
  ungatedSharpe: number; ungatedDD: number; ungatedTrades: number; ungatedProfWin: number;
  gatedSharpe:   number; gatedDD:   number; gatedTrades:   number; gatedProfWin:   number;
};

const rows: Row[] = [];
for (const strat of MR_STRATEGIES) {
  const u = ungated.get(strat.id)!;
  const g = gated.get(strat.id)!;
  const un = Math.max(u.n, 1);
  const gn = Math.max(g.n, 1);

  rows.push({
    strategyId: strat.id,
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

const H = '─'.repeat(120);
console.log('\n' + H);
console.log(
  'Strategy'.padEnd(22) +
  '│ OOS Sharpe (ungated→gated  Δ)     │ OOS DD% (ungated→gated  Δ)     │ Trades (ungated→gated  Δ%)    │ ProfWin% (ungated→gated  Δ)',
);
console.log(H);

const acceptance: { strategyId: string; accept: boolean; reasons: string[] }[] = [];

for (const r of rows) {
  const dSharpe = r.gatedSharpe - r.ungatedSharpe;
  const dDD     = r.gatedDD - r.ungatedDD;
  const dProfW  = r.gatedProfWin - r.ungatedProfWin;
  const tradeReductionPct = r.ungatedTrades > 0 ? ((r.ungatedTrades - r.gatedTrades) / r.ungatedTrades) * 100 : 0;

  console.log(
    r.strategyId.padEnd(22) +
    `│ ${r.ungatedSharpe.toFixed(2)} → ${r.gatedSharpe.toFixed(2)} (${dSharpe >= 0 ? '+' : ''}${dSharpe.toFixed(2)}) ${dSharpe > 0 ? '✓' : '✗'}        │ ` +
    `${r.ungatedDD.toFixed(2)} → ${r.gatedDD.toFixed(2)} (${dDD >= 0 ? '+' : ''}${dDD.toFixed(2)}) ${dDD < 0 ? '✓' : '✗'}        │ ` +
    `${String(r.ungatedTrades).padStart(6)} → ${String(r.gatedTrades).padStart(6)} (${tradeReductionPct >= 0 ? '-' : '+'}${Math.abs(tradeReductionPct).toFixed(1)}%)   │ ` +
    `${(r.ungatedProfWin * 100).toFixed(1)}% → ${(r.gatedProfWin * 100).toFixed(1)}% (${dProfW >= 0 ? '+' : ''}${(dProfW * 100).toFixed(1)}pp)`,
  );

  const reasons: string[] = [];
  if (dSharpe <= 0) reasons.push('Sharpe did not improve');
  if (dDD >= 0) reasons.push('drawdown did not improve');
  if (dProfW < 0) reasons.push('profitable-window fraction fell');
  if (tradeReductionPct >= 50) reasons.push('trade count collapsed >50%');

  acceptance.push({ strategyId: r.strategyId, accept: reasons.length === 0, reasons });
}
console.log(H);

console.log('\nAcceptance criteria (ALL must hold): Sharpe up, DD down, ProfWin% not down, trade reduction < 50%\n');
for (const a of acceptance) {
  console.log(`  ${a.strategyId.padEnd(22)} ${a.accept ? 'ACCEPT gate' : 'REJECT gate'}${a.reasons.length ? '  (' + a.reasons.join('; ') + ')' : ''}`);
}

console.log('\nDone.');
