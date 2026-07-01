import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PaperTrade } from '@/core/types';

const mockGetPaperTrades = vi.fn();
const mockClosePaperTrade = vi.fn();
const mockMarkOpenTrades = vi.fn();
const flagStore = new Map<string, string>();

vi.mock('@/core/db/paper', () => ({
  getPaperTrades: (...args: unknown[]) => mockGetPaperTrades(...args),
}));

vi.mock('@/core/paper/broker', () => ({
  closePaperTrade: (...args: unknown[]) => mockClosePaperTrade(...args),
  markOpenTrades:  (...args: unknown[]) => mockMarkOpenTrades(...args),
}));

vi.mock('@/core/db/flags', () => ({
  getFlag: (key: string) => flagStore.get(key) ?? null,
  setFlag: (key: string, value: string) => { flagStore.set(key, value); },
}));

const { maybeRotateForCandidate, openTradesForScope, parseConviction } = await import('./rotation');

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

function trade(overrides: Partial<PaperTrade> & { id: string }): PaperTrade {
  return {
    strategyId: 'rsi-reversion',
    symbol:     overrides.id,
    side:       'long',
    qty:        10,
    entryTime:  daysAgo(5),
    entryPrice: 100,
    status:     'open',
    costs:      0,
    ...overrides,
  } as PaperTrade;
}

beforeEach(() => {
  flagStore.clear();
  mockGetPaperTrades.mockReset();
  mockClosePaperTrade.mockReset();
  mockMarkOpenTrades.mockReset();
  process.env.ROTATION_ENABLED = '1';
  process.env.ROTATION_MIN_HOLD_BARS = '3';
  process.env.ROTATION_MAX_PER_DAY = '2';
});

describe('parseConviction', () => {
  it('parses "consensus=2/3" out of a notes string', () => {
    expect(parseConviction('daily:sp500:rsi-reversion,stoch-reversal consensus=2/3')).toEqual({ agree: 2, total: 3 });
  });

  it('returns null when notes has no consensus marker', () => {
    expect(parseConviction('manual entry')).toBeNull();
    expect(parseConviction(undefined)).toBeNull();
  });
});

describe('openTradesForScope', () => {
  it('filters to market-tagged trades for a market scope', () => {
    mockGetPaperTrades.mockReturnValue([
      trade({ id: 'A', market: 'sp500' }),
      trade({ id: 'B', market: 'nse' }),
    ]);
    const result = openTradesForScope('sp500');
    expect(result.map((t) => t.id)).toEqual(['A']);
  });

  it('filters to untagged trades for the intraday scope', () => {
    mockGetPaperTrades.mockReturnValue([
      trade({ id: 'A', market: 'sp500' }),
      trade({ id: 'B' }),
    ]);
    const result = openTradesForScope('intraday');
    expect(result.map((t) => t.id)).toEqual(['B']);
  });
});

describe('maybeRotateForCandidate', () => {
  it('returns null when rotation is disabled', () => {
    process.env.ROTATION_ENABLED = '0';
    const held = [trade({ id: 'WEAK', notes: 'consensus=1/3' })];
    const result = maybeRotateForCandidate({ symbol: 'NEW', agreeCount: 3 }, 'sp500', held);
    expect(result).toBeNull();
    expect(mockClosePaperTrade).not.toHaveBeenCalled();
  });

  it('returns null when the candidate is not strictly more convincing than the weakest holding', () => {
    mockMarkOpenTrades.mockReturnValue([]);
    const held = [trade({ id: 'HOLD', notes: 'consensus=2/3' })];
    const result = maybeRotateForCandidate({ symbol: 'NEW', agreeCount: 2 }, 'sp500', held);
    expect(result).toBeNull();
    expect(mockClosePaperTrade).not.toHaveBeenCalled();
  });

  it('closes the weakest-conviction holding when the candidate has higher conviction', () => {
    mockMarkOpenTrades.mockReturnValue([
      { trade: { id: 'WEAK' }, unrealizedPnlPct: -1 },
      { trade: { id: 'STRONG' }, unrealizedPnlPct: 2 },
    ]);
    mockClosePaperTrade.mockImplementation((id: string) => trade({ id, notes: 'consensus=1/3' }));
    const held = [
      trade({ id: 'WEAK', notes: 'consensus=1/3' }),
      trade({ id: 'STRONG', notes: 'consensus=3/3' }),
    ];
    const result = maybeRotateForCandidate({ symbol: 'NEW', agreeCount: 2 }, 'sp500', held);
    expect(result).not.toBeNull();
    expect(mockClosePaperTrade).toHaveBeenCalledWith('WEAK', expect.objectContaining({ exitReason: 'rotation' }));
    expect(result?.closedAgree).toBe(1);
  });

  it('among equal conviction, rotates out the one with the worst unrealized P&L', () => {
    mockMarkOpenTrades.mockReturnValue([
      { trade: { id: 'A' }, unrealizedPnlPct: 3 },
      { trade: { id: 'B' }, unrealizedPnlPct: -5 },
    ]);
    mockClosePaperTrade.mockImplementation((id: string) => trade({ id, notes: 'consensus=1/3' }));
    const held = [
      trade({ id: 'A', notes: 'consensus=1/3' }),
      trade({ id: 'B', notes: 'consensus=1/3' }),
    ];
    maybeRotateForCandidate({ symbol: 'NEW', agreeCount: 2 }, 'sp500', held);
    expect(mockClosePaperTrade).toHaveBeenCalledWith('B', expect.anything());
  });

  it('does not rotate a holding younger than the minimum hold period', () => {
    mockMarkOpenTrades.mockReturnValue([]);
    const held = [trade({ id: 'YOUNG', notes: 'consensus=1/3', entryTime: daysAgo(1) })];
    const result = maybeRotateForCandidate({ symbol: 'NEW', agreeCount: 3 }, 'sp500', held);
    expect(result).toBeNull();
    expect(mockClosePaperTrade).not.toHaveBeenCalled();
  });

  it('respects the daily rotation cap per scope', () => {
    mockMarkOpenTrades.mockReturnValue([]);
    mockClosePaperTrade.mockImplementation((id: string) => trade({ id, notes: 'consensus=1/3' }));
    const held = [trade({ id: 'HOLD', notes: 'consensus=1/3' })];

    process.env.ROTATION_MAX_PER_DAY = '1';
    const first = maybeRotateForCandidate({ symbol: 'NEW1', agreeCount: 3 }, 'sp500', held);
    expect(first).not.toBeNull();

    const second = maybeRotateForCandidate({ symbol: 'NEW2', agreeCount: 3 }, 'sp500', held);
    expect(second).toBeNull();
  });
});
