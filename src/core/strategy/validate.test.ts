import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { validateStrategy, makeSyntheticBars } from './validate';
import type { Strategy, StrategyContext, StrategyDecision } from './Strategy';
import { RSIReversionStrategy  } from './examples/rsi-reversion';
import { MACrossoverStrategy   } from './examples/ma-crossover';
import { MACDMomentumStrategy  } from './examples/macd-momentum';

// ---------------------------------------------------------------------------
// Helpers for test strategies
// ---------------------------------------------------------------------------

function makeMinimalStrategy(overrides: Partial<Strategy> = {}): Strategy {
  return {
    id:          'test-strategy',
    name:        'Test Strategy',
    description: 'Used in tests only',
    params:      z.object({ period: z.number().default(14) }),
    onBar(_ctx: StrategyContext, _rawParams: unknown): StrategyDecision {
      return { action: 'hold' };
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// makeSyntheticBars
// ---------------------------------------------------------------------------

describe('makeSyntheticBars', () => {
  it('returns the requested length', () => {
    expect(makeSyntheticBars(50)).toHaveLength(50);
    expect(makeSyntheticBars(300)).toHaveLength(300);
  });

  it('is deterministic', () => {
    const a = makeSyntheticBars(100);
    const b = makeSyntheticBars(100);
    expect(a).toEqual(b);
  });

  it('produces valid OHLCV bars', () => {
    for (const bar of makeSyntheticBars(50)) {
      expect(bar.high).toBeGreaterThanOrEqual(bar.open);
      expect(bar.high).toBeGreaterThanOrEqual(bar.close);
      expect(bar.low).toBeLessThanOrEqual(bar.open);
      expect(bar.low).toBeLessThanOrEqual(bar.close);
      expect(bar.volume).toBeGreaterThan(0);
      expect(bar.time).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// Built-in strategies all pass
// ---------------------------------------------------------------------------

describe('validateStrategy - built-ins', () => {
  it('rsi-reversion passes', () => {
    const result = validateStrategy(new RSIReversionStrategy());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('ma-crossover passes', () => {
    const result = validateStrategy(new MACrossoverStrategy());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('macd-momentum passes', () => {
    const result = validateStrategy(new MACDMomentumStrategy());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Shape failures
// ---------------------------------------------------------------------------

describe('validateStrategy - shape failures', () => {
  it('fails when id is empty', () => {
    const { ok, errors } = validateStrategy(makeMinimalStrategy({ id: '' }));
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes('id'))).toBe(true);
  });

  it('fails when name is empty', () => {
    const { ok, errors } = validateStrategy(makeMinimalStrategy({ name: '' }));
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes('name'))).toBe(true);
  });

  it('fails when params has no .parse method', () => {
    const { ok, errors } = validateStrategy(
      makeMinimalStrategy({ params: {} as ReturnType<typeof z.object> }),
    );
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes('params'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Params defaults failure
// ---------------------------------------------------------------------------

describe('validateStrategy - params defaults', () => {
  it('fails when a params field has no default', () => {
    const noDefaultStrategy = makeMinimalStrategy({
      params: z.object({ period: z.number() }), // no .default()
    });
    const { ok, errors } = validateStrategy(noDefaultStrategy);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes('default'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Look-ahead probe
// ---------------------------------------------------------------------------

describe('validateStrategy - look-ahead probe', () => {
  it('catches a strategy that reads ctx.bars[ctx.i + 1]', () => {
    const lookAheadStrategy = makeMinimalStrategy({
      onBar(ctx: StrategyContext): StrategyDecision {
        // Deliberately peek at the next bar - this is the look-ahead trap
        const nextBar = ctx.bars[ctx.i + 1];
        if (nextBar) return { action: 'enter_long', reason: `future close ${nextBar.close}` };
        return { action: 'hold' };
      },
    });
    const { ok, errors } = validateStrategy(lookAheadStrategy);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes('look-ahead'))).toBe(true);
  });

  it('does NOT flag a strategy that reads only ctx.bars[ctx.i]', () => {
    const safeStrategy = makeMinimalStrategy({
      onBar(ctx: StrategyContext): StrategyDecision {
        const bar = ctx.bars[ctx.i];
        return bar.close > 100 ? { action: 'enter_long' } : { action: 'hold' };
      },
    });
    const { ok } = validateStrategy(safeStrategy);
    expect(ok).toBe(true);
  });

  it('does NOT flag a strategy that throws non-look-ahead errors during warm-up', () => {
    // Strategy returns hold during warm-up when indicator is NaN
    const warmUpStrategy = makeMinimalStrategy({
      onBar(ctx: StrategyContext): StrategyDecision {
        const rsi = ctx.indicator('rsi', { period: 14 }) as number[];
        if (!Number.isFinite(rsi[ctx.i])) return { action: 'hold' };
        return { action: 'hold' };
      },
    });
    const { ok } = validateStrategy(warmUpStrategy);
    expect(ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Smoke backtest
// ---------------------------------------------------------------------------

describe('validateStrategy - smoke backtest', () => {
  it('fails a strategy whose onBar always throws', () => {
    const throwingStrategy = makeMinimalStrategy({
      onBar(): StrategyDecision {
        throw new Error('boom');
      },
    });
    const { ok, errors } = validateStrategy(throwingStrategy);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes('smoke backtest threw'))).toBe(true);
  });
});
