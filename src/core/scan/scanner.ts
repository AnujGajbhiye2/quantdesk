import 'server-only';
import type { Bar, Signal, Timeframe } from '@/core/types';
import type { Strategy } from '@/core/strategy/Strategy';
import { get as getStrategy } from '@/core/strategy/registry';
import { makeContext, type IndicatorCache } from '@/core/strategy/context';
import { getBars, getAllSymbols } from '@/core/db/bars';
import { insertSignals } from '@/core/db/signals';

export interface ScanOpts {
  strategyId: string;
  /** Symbols to scan. Defaults to all symbols in the DB. */
  symbols?:   string[];
  timeframe?: Timeframe;
  rawParams?: unknown;
  /** Persist signals to the DB. Default true. */
  persist?:   boolean;
}

// ---------------------------------------------------------------------------
// Pure core - testable without DB
// ---------------------------------------------------------------------------

/**
 * Evaluate a strategy on the latest bar of the given series.
 * Returns null if there are fewer than 2 bars or the decision is 'hold'.
 */
export function scanSymbol(
  symbol:       string,
  bars:         readonly Bar[],
  strategy:     Strategy,
  parsedParams: unknown,
): Signal | null {
  if (bars.length < 2) return null;

  const cache: IndicatorCache = new Map();
  const ctx   = makeContext(bars as Bar[], bars.length - 1, 'flat', cache);
  const decision = strategy.onBar(ctx, parsedParams);

  if (decision.action === 'hold') return null;

  const side: Signal['side'] =
    decision.action === 'enter_long'  ? 'long'
    : decision.action === 'enter_short' ? 'short'
    : 'flat'; // 'exit'

  return {
    symbol,
    time:       bars[bars.length - 1].time,
    side,
    reason:     decision.reason ?? '',
    strategyId: strategy.id,
  };
}

// ---------------------------------------------------------------------------
// Impure outer function - DB-bound
// ---------------------------------------------------------------------------

/**
 * Run a strategy against stored bars for each symbol and collect signals.
 * Designed for speed: pure DB reads, no network calls.
 */
export function scan(opts: ScanOpts): Signal[] {
  const strategy     = getStrategy(opts.strategyId);
  const parsedParams = strategy.params.parse(opts.rawParams ?? {});
  const timeframe    = opts.timeframe ?? '1d';
  const symbols      = opts.symbols ?? getAllSymbols().map((s) => s.symbol);

  const signals: Signal[] = [];

  for (const symbol of symbols) {
    try {
      const bars   = getBars(symbol, timeframe);
      const signal = scanSymbol(symbol, bars, strategy, parsedParams);
      if (signal) signals.push(signal);
    } catch {
      // skip symbol on error; don't abort the whole scan
    }
  }

  if (opts.persist !== false && signals.length > 0) {
    insertSignals(signals);
  }

  return signals;
}
