import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { scanSymbol } from './scanner';
import type { Strategy, StrategyDecision } from '@/core/strategy/Strategy';
import type { Bar } from '@/core/types';

// ---------------------------------------------------------------------------
// Helpers (same pattern as engine.test.ts)
// ---------------------------------------------------------------------------

function makeBar(i: number, overrides: Partial<Bar> = {}): Bar {
  return {
    time:   `2024-01-${String(i + 1).padStart(2, '0')}`,
    open:   100 + i,
    high:   105 + i,
    low:    95  + i,
    close:  102 + i,
    volume: 1_000,
    ...overrides,
  };
}

function makeBars(n: number, overridesFn?: (i: number) => Partial<Bar>): Bar[] {
  return Array.from({ length: n }, (_, i) =>
    makeBar(i, overridesFn ? overridesFn(i) : {}),
  );
}

function constStrategy(decision: StrategyDecision): Strategy {
  return {
    id: 'const', name: 'const', description: '',
    params: z.object({}),
    onBar: () => decision,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scanSymbol', () => {
  it('returns null when fewer than 2 bars', () => {
    const strategy = constStrategy({ action: 'enter_long' });
    expect(scanSymbol('TEST', [makeBar(0)], strategy, {})).toBeNull();
    expect(scanSymbol('TEST', [], strategy, {})).toBeNull();
  });

  it('returns null for hold decision', () => {
    const strategy = constStrategy({ action: 'hold' });
    const bars = makeBars(10);
    expect(scanSymbol('TEST', bars, strategy, {})).toBeNull();
  });

  it('enter_long decision -> side = long signal', () => {
    const strategy = constStrategy({ action: 'enter_long', reason: 'RSI oversold' });
    const bars = makeBars(10);
    const signal = scanSymbol('AAPL', bars, strategy, {});

    expect(signal).not.toBeNull();
    expect(signal!.symbol).toBe('AAPL');
    expect(signal!.side).toBe('long');
    expect(signal!.reason).toBe('RSI oversold');
    expect(signal!.strategyId).toBe('const');
  });

  it('enter_short decision -> side = short signal', () => {
    const strategy = constStrategy({ action: 'enter_short' });
    const bars = makeBars(5);
    const signal = scanSymbol('MSFT', bars, strategy, {});
    expect(signal!.side).toBe('short');
  });

  it('exit decision -> side = flat signal', () => {
    const strategy = constStrategy({ action: 'exit' });
    const bars = makeBars(5);
    const signal = scanSymbol('TSLA', bars, strategy, {});
    expect(signal!.side).toBe('flat');
  });

  it('signal time = latest bar time', () => {
    const strategy = constStrategy({ action: 'enter_long' });
    const bars = makeBars(7);
    const signal = scanSymbol('TEST', bars, strategy, {});
    expect(signal!.time).toBe(bars[bars.length - 1].time);
  });

  it('strategy receives only bars[0..n-1] (no look-ahead)', () => {
    let seenLength: number | undefined;
    const strategy: Strategy = {
      id: 'len-spy', name: '', description: '',
      params: z.object({}),
      onBar(ctx) {
        seenLength = ctx.bars.length;
        return { action: 'hold' };
      },
    };
    const bars = makeBars(8);
    scanSymbol('TEST', bars, strategy, {});
    // Called at i = bars.length - 1 = 7, so bars.length == 8
    expect(seenLength).toBe(8);
  });

  it('reason defaults to empty string when strategy provides none', () => {
    const strategy = constStrategy({ action: 'enter_long' });
    const bars = makeBars(3);
    const signal = scanSymbol('X', bars, strategy, {});
    expect(signal!.reason).toBe('');
  });
});
