import type { Strategy } from './Strategy';
import { validateStrategy } from './validate';
import { RSIReversionStrategy }      from './examples/rsi-reversion';
import { MACrossoverStrategy }        from './examples/ma-crossover';
import { MACDMomentumStrategy }       from './examples/macd-momentum';
import { BollingerReversionStrategy } from './examples/bollinger-reversion';
import { DonchianBreakoutStrategy }   from './examples/donchian-breakout';
import { RocMomentumStrategy }        from './examples/roc-momentum';
import { AtrTrendStrategy }           from './examples/atr-trend';
import { StochReversalStrategy }      from './examples/stoch-reversal';
import { Rsi2PullbackStrategy }       from './examples/rsi2-pullback';
import { DownStreakStrategy }         from './examples/down-streak';
import { EmaPullbackStrategy }        from './examples/ema-pullback';
import { Ma44SupportStrategy }        from './examples/ma44-support';

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

// Seed built-in strategies
register(new RSIReversionStrategy());
register(new MACrossoverStrategy());
register(new MACDMomentumStrategy());
register(new BollingerReversionStrategy());
register(new DonchianBreakoutStrategy());
register(new RocMomentumStrategy());
register(new AtrTrendStrategy());
register(new StochReversalStrategy());
register(new Rsi2PullbackStrategy());
register(new DownStreakStrategy());
register(new EmaPullbackStrategy());
register(new Ma44SupportStrategy());
