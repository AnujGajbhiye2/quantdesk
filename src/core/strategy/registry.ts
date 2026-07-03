import type { Strategy } from './Strategy';
import { validateStrategy } from './validate';
import { RSIReversionStrategy }      from './examples/rsi-reversion';
import { BollingerReversionStrategy } from './examples/bollinger-reversion';
import { StochReversalStrategy }      from './examples/stoch-reversal';

/**
 * Strategy registry.
 *
 * To add a new strategy:
 * 1. Create strategy/examples/my-strategy.ts implementing the Strategy interface.
 * 2. Add one line below: register(new MyStrategy()).
 * That is it - nothing else changes.
 *
 * In development and test environments, register() automatically validates the
 * strategy (shape, params defaults, look-ahead probe, smoke backtest) and throws
 * with a clear report if it misbehaves. Zero cost in production.
 */

/**
 * Live-eligible strategy IDs.
 *
 * Only these three strategies are registered at all. They are also the only
 * ones that run on the live intraday scan and auto-trade path - the registry
 * and the live path are identical (no separate research-only tier).
 *
 * BINNED strategies live in strategy/graveyard/ and are NOT registered
 * (they no longer appear in backtest, compare, or research UI):
 *   roc-momentum      - BROKEN: zero trades generated across entire SP500 OOS run.
 *   atr-trend         - BROKEN: negative OOS Sharpe (-0.4 to -0.8).
 *   ma-crossover, macd-momentum, donchian-breakout, rsi2-pullback, down-streak,
 *   ema-pullback, ma44-support - Phase 5 roster re-evaluation (SYSTEM_AUDIT_AND_ROADMAP.md):
 *   every candidate underperformed the live trio on walk-forward OOS Sharpe
 *   despite "better" mechanics (real stops/targets/time exits). Not broken,
 *   just never proved better than what's live - moved out of the live app
 *   surface, kept for eval-walkforward.ts / eval-cost-sensitivity.ts so the
 *   rejection evidence stays reproducible.
 */
const LIVE_STRATEGY_IDS = new Set<string>([
  'bollinger-reversion',
  'rsi-reversion',
  'stoch-reversal',
]);

const _registry = new Map<string, Strategy>();

export function register(strategy: Strategy): void {
  if (process.env.NODE_ENV !== 'production') {
    const { ok, errors } = validateStrategy(strategy);
    if (!ok) {
      throw new Error(
        `Strategy '${strategy.id}' failed validation:\n  - ${errors.join('\n  - ')}`,
      );
    }
  }
  _registry.set(strategy.id, strategy);
}

export function get(id: string): Strategy {
  const s = _registry.get(id);
  if (!s) throw new Error(`Strategy '${id}' not registered.`);
  return s;
}

export function list(): { id: string; name: string; description: string; tier: 'baseline' | 'production' }[] {
  return Array.from(_registry.values()).map(({ id, name, description, tier }) => ({
    id,
    name,
    description,
    tier: tier ?? 'baseline',
  }));
}

/**
 * Returns only the live-eligible strategies for the intraday scan and auto-trade path.
 * Use list() for backtesting and research UI (all registered strategies).
 */
export function listLive(): { id: string; name: string; description: string; tier: 'baseline' | 'production' }[] {
  return list().filter(({ id }) => LIVE_STRATEGY_IDS.has(id));
}

// Seed built-in strategies
register(new RSIReversionStrategy());
register(new BollingerReversionStrategy());
register(new StochReversalStrategy());
