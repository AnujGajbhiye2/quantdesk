import type { Strategy } from './Strategy';
import { validateStrategy } from './validate';
import { RSIReversionStrategy }      from './examples/rsi-reversion';
import { BollingerReversionStrategy } from './examples/bollinger-reversion';
import { StochReversalStrategy }      from './examples/stoch-reversal';
import { RSIReversionShortStrategy }      from './examples/rsi-reversion-short';
import { BollingerReversionShortStrategy } from './examples/bollinger-reversion-short';
import { StochReversalShortStrategy }      from './examples/stoch-reversal-short';
import { Ema8MomentumBreakoutStrategy }    from './examples/ema8-momentum-breakout';
import { CapitulationReversalStrategy }    from './examples/capitulation-reversal';
import { Sma44PullbackStrategy }           from './examples/sma44-pullback';
import { Ema50FibPullbackStrategy }        from './examples/ema50-fib-pullback';
import { SupertrendPivotStrategy }         from './examples/supertrend-pivot';

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
 * Six strategies are registered: the original long trio plus their short
 * mirrors (fade-the-overbought-bounce counterparts, added for bearish-market
 * coverage). All six run on the live intraday scan and auto-trade path - the
 * registry and the live path are identical (no separate research-only tier).
 * Long and short entries are mutually exclusive per symbol per bar (a symbol
 * can't be oversold and overbought at once), so consensus and rotation stay
 * side-scoped automatically via scan/consensus.ts's symbol+side grouping.
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
  'bollinger-reversion-short',
  'rsi-reversion-short',
  'stoch-reversal-short',
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
register(new RSIReversionShortStrategy());
register(new BollingerReversionShortStrategy());
register(new StochReversalShortStrategy());
// Transcript strategies (docs/transcription/strat-1..5) - research/backtest only,
// not in LIVE_STRATEGY_IDS pending walk-forward validation.
register(new Ema8MomentumBreakoutStrategy());
register(new CapitulationReversalStrategy());
register(new Sma44PullbackStrategy());
register(new Ema50FibPullbackStrategy());
register(new SupertrendPivotStrategy());
