import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { scanSymbol, dropPartialToday } from './scanner';
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
    const result = scanSymbol('AAPL', bars, strategy, {});

    expect(result).not.toBeNull();
    expect(result!.signal.symbol).toBe('AAPL');
    expect(result!.signal.side).toBe('long');
    expect(result!.signal.reason).toBe('RSI oversold');
    expect(result!.signal.strategyId).toBe('const');
  });

  it('exposes decision on result', () => {
    const strategy = constStrategy({ action: 'enter_long', stopPct: 0.05 });
    const bars = makeBars(5);
    const result = scanSymbol('X', bars, strategy, {});
    expect(result!.decision.stopPct).toBe(0.05);
  });

  it('enter_short decision -> side = short signal', () => {
    const strategy = constStrategy({ action: 'enter_short' });
    const bars = makeBars(5);
    const result = scanSymbol('MSFT', bars, strategy, {});
    expect(result!.signal.side).toBe('short');
  });

  it('exit decision -> side = flat signal', () => {
    const strategy = constStrategy({ action: 'exit' });
    const bars = makeBars(5);
    const result = scanSymbol('TSLA', bars, strategy, {});
    expect(result!.signal.side).toBe('flat');
  });

  it('signal time = latest bar time', () => {
    const strategy = constStrategy({ action: 'enter_long' });
    const bars = makeBars(7);
    const result = scanSymbol('TEST', bars, strategy, {});
    expect(result!.signal.time).toBe(bars[bars.length - 1].time);
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
    const result = scanSymbol('X', bars, strategy, {});
    expect(result!.signal.reason).toBe('');
  });

  it('shared indicator cache produces identical signals to fresh caches', () => {
    // Two strategies that both read RSI(14) and decide off its latest value
    const mkRsiStrategy = (id: string, threshold: number): Strategy => ({
      id, name: id, description: '',
      params: z.object({}),
      onBar(ctx) {
        const rsi = ctx.indicator('rsi', { period: 14 }) as number[];
        const last = rsi[rsi.length - 1];
        if (!isFinite(last)) return { action: 'hold' };
        return last < threshold
          ? { action: 'enter_long', reason: `RSI ${last.toFixed(1)}` }
          : { action: 'hold' };
      },
    });
    // Falling closes -> low RSI
    const bars = makeBars(40, (i) => ({ close: 200 - i * 2 }));
    const sA = mkRsiStrategy('a', 50);
    const sB = mkRsiStrategy('b', 60);

    const fresh  = [scanSymbol('X', bars, sA, {}), scanSymbol('X', bars, sB, {})];
    const shared = new Map();
    const cached = [
      scanSymbol('X', bars, sA, {}, shared),
      scanSymbol('X', bars, sB, {}, shared),
    ];

    expect(cached[0]?.signal).toEqual(fresh[0]?.signal);
    expect(cached[1]?.signal).toEqual(fresh[1]?.signal);
    // The shared cache was actually populated and reused (one RSI entry, not two)
    expect(shared.size).toBe(1);
  });
});

describe('dropPartialToday', () => {
  it('drops the final bar when it is dated today', () => {
    const bars = [
      makeBar(0, { time: '2026-06-10' }),
      makeBar(1, { time: '2026-06-11' }),
    ];
    const trimmed = dropPartialToday(bars, '2026-06-11');
    expect(trimmed.length).toBe(1);
    expect(trimmed[0].time).toBe('2026-06-10');
  });

  it('returns the SAME array reference when the last bar is older', () => {
    const bars = [
      makeBar(0, { time: '2026-06-09' }),
      makeBar(1, { time: '2026-06-10' }),
    ];
    expect(dropPartialToday(bars, '2026-06-11')).toBe(bars);
  });

  it('handles intraday ISO timestamps on the final bar', () => {
    const bars = [
      makeBar(0, { time: '2026-06-10' }),
      makeBar(1, { time: '2026-06-11T14:30:00.000Z' }),
    ];
    expect(dropPartialToday(bars, '2026-06-11').length).toBe(1);
  });

  it('returns empty input unchanged', () => {
    const bars: Bar[] = [];
    expect(dropPartialToday(bars, '2026-06-11')).toBe(bars);
  });
});
