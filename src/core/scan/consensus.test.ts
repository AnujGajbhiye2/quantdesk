import { describe, it, expect } from 'vitest';
import { buildConsensus } from './consensus';
import type { Signal } from '@/core/types';

function sig(symbol: string, side: Signal['side'], strategyId: string, reason = ''): Signal {
  return { symbol, time: '2024-06-03', side, reason, strategyId };
}

describe('buildConsensus', () => {
  it('groups agreeing strategies by symbol + side', () => {
    const out = buildConsensus(
      [
        sig('NVDA', 'long', 'rsi-reversion', 'RSI 28 oversold'),
        sig('NVDA', 'long', 'ma-crossover', 'fast above slow'),
        sig('NVDA', 'long', 'macd-momentum'),
        sig('AAPL', 'short', 'roc-momentum'),
      ],
      8,
    );

    expect(out).toHaveLength(2);
    const nvda = out.find((c) => c.symbol === 'NVDA')!;
    expect(nvda.side).toBe('long');
    expect(nvda.agreeCount).toBe(3);
    expect(nvda.totalStrategies).toBe(8);
    expect(nvda.strength).toBeCloseTo(3 / 8, 10);
    expect(nvda.strategyIds).toEqual(['rsi-reversion', 'ma-crossover', 'macd-momentum']);
    expect(nvda.reasons['rsi-reversion']).toBe('RSI 28 oversold');
  });

  it('excludes flat (exit) signals from consensus', () => {
    const out = buildConsensus(
      [sig('NVDA', 'flat', 'rsi-reversion'), sig('NVDA', 'long', 'ma-crossover')],
      8,
    );
    expect(out).toHaveLength(1);
    expect(out[0].agreeCount).toBe(1);
  });

  it('keeps long and short on the same symbol as separate groups', () => {
    const out = buildConsensus(
      [
        sig('TSLA', 'long', 'ma-crossover'),
        sig('TSLA', 'short', 'rsi-reversion'),
        sig('TSLA', 'short', 'stoch-reversal'),
      ],
      8,
    );
    expect(out).toHaveLength(2);
    // Short group has more agreement, ranks first
    expect(out[0].side).toBe('short');
    expect(out[0].agreeCount).toBe(2);
    expect(out[1].side).toBe('long');
  });

  it('ranks strongest consensus first, ties broken by symbol', () => {
    const out = buildConsensus(
      [
        sig('B', 'long', 's1'),
        sig('A', 'long', 's1'),
        sig('C', 'long', 's1'),
        sig('C', 'long', 's2'),
      ],
      4,
    );
    expect(out.map((c) => c.symbol)).toEqual(['C', 'A', 'B']);
  });

  it('counts one vote per strategy even with duplicate signals', () => {
    const out = buildConsensus(
      [sig('NVDA', 'long', 'rsi-reversion'), sig('NVDA', 'long', 'rsi-reversion')],
      8,
    );
    expect(out[0].agreeCount).toBe(1);
  });

  it('handles empty input and zero strategies', () => {
    expect(buildConsensus([], 8)).toEqual([]);
    expect(buildConsensus([sig('A', 'long', 's1')], 0)[0].strength).toBe(0);
  });
});
