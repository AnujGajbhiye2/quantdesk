import 'server-only';
import type { Bar, Signal, Timeframe } from '@/core/types';
import type { Strategy, StrategyDecision } from '@/core/strategy/Strategy';
import { get as getStrategy } from '@/core/strategy/registry';
import { makeContext, type IndicatorCache } from '@/core/strategy/context';
import { getBars, getAllSymbols } from '@/core/db/bars';
import { insertSignals } from '@/core/db/signals';
import { checkRegime } from '@/core/market/regime';

export interface ScanOpts {
  strategyId: string;
  /** Symbols to scan. Defaults to all symbols in the DB. */
  symbols?:   string[];
  timeframe?: Timeframe;
  rawParams?: unknown;
  /** Persist signals to the DB. Default true. */
  persist?:   boolean;
  /**
   * Drop the final bar when it is dated today. Default true - a daily bar
   * fetched while the market is still open is partial and must not feed
   * signal generation. Only post-close paths (EOD cron) may pass false.
   */
  excludeToday?: boolean;
}

/**
 * Return the series without its final bar when that bar is dated today.
 * Returns the SAME array reference when nothing is trimmed, so callers can
 * cheaply detect whether cached indicator outputs (aligned to the full
 * series) are still valid.
 */
export function dropPartialToday(
  bars:  readonly Bar[],
  today: string = new Date().toISOString().slice(0, 10),
): readonly Bar[] {
  const last = bars[bars.length - 1];
  return last && last.time.slice(0, 10) === today ? bars.slice(0, -1) : bars;
}

// ---------------------------------------------------------------------------
// Pure core - testable without DB
// ---------------------------------------------------------------------------

export interface ScanSymbolResult {
  signal:   Signal;
  decision: StrategyDecision;
  bars:     readonly Bar[];
}

/**
 * Evaluate a strategy on the latest bar of the given series.
 * Returns null if there are fewer than 2 bars or the decision is 'hold'.
 * Pass a shared cache to reuse indicator outputs across strategies on the
 * same bar series (the cache key includes indicator id + params, so sharing
 * across strategies is safe as long as the bars are identical).
 */
export function scanSymbol(
  symbol:       string,
  bars:         readonly Bar[],
  strategy:     Strategy,
  parsedParams: unknown,
  cache:        IndicatorCache = new Map(),
): ScanSymbolResult | null {
  if (bars.length < 2) return null;

  const ctx      = makeContext(bars as Bar[], bars.length - 1, 'flat', cache);
  const decision = strategy.onBar(ctx, parsedParams);

  if (decision.action === 'hold') return null;

  const side: Signal['side'] =
    decision.action === 'enter_long'  ? 'long'
    : decision.action === 'enter_short' ? 'short'
    : 'flat'; // 'exit'

  const signal: Signal = {
    symbol,
    time:       bars[bars.length - 1].time,
    side,
    reason:     decision.reason ?? '',
    strategyId: strategy.id,
  };

  return { signal, decision, bars };
}

// ---------------------------------------------------------------------------
// Impure outer function - DB-bound
// ---------------------------------------------------------------------------

/**
 * Run a strategy against stored bars for each symbol and collect signals.
 * Designed for speed: pure DB reads, no network calls.
 */
export interface ScanResult {
  signals:  Signal[];
  /** Raw scan results (signal + decision + bars) for building trade ideas downstream. */
  rawResults: ScanSymbolResult[];
  /**
   * Whether the strategy's regime requirement was met at scan time.
   * false means the strategy declared a regime precondition that was not
   * satisfied - no signals were generated. null means no requirement.
   */
  regimeAligned: boolean | null;
}

export function scan(opts: ScanOpts): ScanResult {
  const strategy     = getStrategy(opts.strategyId);
  const parsedParams = strategy.params.parse(opts.rawParams ?? {});
  const timeframe    = opts.timeframe ?? '1d';
  const symbols      = opts.symbols ?? getAllSymbols().map((s) => s.symbol);

  // --- Regime gate (strategy-level, checked once before the symbol loop) ---
  let regimeAligned: boolean | null = null;
  if (strategy.regime) {
    const req = strategy.regime;
    try {
      const indexStored = getBars(req.index, timeframe);
      const indexBars   = opts.excludeToday === false ? indexStored : dropPartialToday(indexStored);
      regimeAligned = checkRegime(req, indexBars);
    } catch {
      regimeAligned = true; // index not ingested yet - neutral pass
    }
    if (regimeAligned === false) {
      return { signals: [], rawResults: [], regimeAligned: false };
    }
  }

  const signals:    Signal[]           = [];
  const rawResults: ScanSymbolResult[] = [];

  for (const symbol of symbols) {
    try {
      const stored = getBars(symbol, timeframe);
      const bars   = opts.excludeToday === false ? stored : dropPartialToday(stored);
      const result = scanSymbol(symbol, bars, strategy, parsedParams);
      if (result) {
        signals.push(result.signal);
        rawResults.push(result);
      }
    } catch {
      // skip symbol on error; don't abort the whole scan
    }
  }

  if (opts.persist !== false && signals.length > 0) {
    insertSignals(signals);
  }

  return { signals, rawResults, regimeAligned };
}
