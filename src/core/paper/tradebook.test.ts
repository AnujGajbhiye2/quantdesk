import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PaperTrade } from '@/core/types';

// ---------------------------------------------------------------------------
// Mock DB module
// ---------------------------------------------------------------------------

const mockGetAll = vi.fn();

vi.mock('@/core/db/paper', () => ({
  getPaperTrades: (...args: unknown[]) => mockGetAll(...args),
  insertPaperTrade: vi.fn(),
  updatePaperTrade: vi.fn(),
  getPaperTrade:    vi.fn(),
}));

const { buildTradeBook } = await import('./tradebook');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    id:         't1',
    strategyId: 'rsi',
    symbol:     'AAPL',
    side:       'long',
    qty:        10,
    entryTime:  '2024-01-01',
    entryPrice: 100,
    status:     'open',
    costs:      0,
    ...overrides,
  };
}

function closedWin(id: string, pnl = 50, strategyId = 'rsi'): PaperTrade {
  return makeTrade({
    id, strategyId, status: 'closed',
    exitTime: '2024-01-10', exitPrice: 105,
    pnl, pnlPct: pnl / 1000 * 100, costs: 10,
  });
}

function closedLoss(id: string, pnl = -30, strategyId = 'rsi'): PaperTrade {
  return makeTrade({
    id, strategyId, status: 'closed',
    exitTime: '2024-01-10', exitPrice: 97,
    pnl, pnlPct: pnl / 1000 * 100, costs: 10,
  });
}

beforeEach(() => vi.clearAllMocks());

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildTradeBook', () => {
  it('returns zero/null aggregate on empty history', () => {
    mockGetAll.mockReturnValue([]);
    const book = buildTradeBook();
    expect(book.totalTrades).toBe(0);
    expect(book.open).toBe(0);
    expect(book.closed).toBe(0);
    expect(book.winRate).toBe(0);
    expect(book.totalPnl).toBe(0);
    expect(book.bestTrade).toBeNull();
    expect(book.worstTrade).toBeNull();
    expect(book.openExposure).toBe(0);
  });

  it('counts open and closed trades', () => {
    mockGetAll.mockReturnValue([
      makeTrade({ id: 'o1', status: 'open' }),
      makeTrade({ id: 'o2', status: 'open' }),
      closedWin('c1'),
    ]);
    const book = buildTradeBook();
    expect(book.totalTrades).toBe(3);
    expect(book.open).toBe(2);
    expect(book.closed).toBe(1);
  });

  it('winRate counts closed trades only', () => {
    mockGetAll.mockReturnValue([
      closedWin('w1'),
      closedWin('w2'),
      closedLoss('l1'),
      makeTrade({ id: 'o1', status: 'open' }), // open - not counted
    ]);
    const book = buildTradeBook();
    // 2 wins out of 3 closed = 0.667
    expect(book.winRate).toBeCloseTo(2 / 3, 4);
  });

  it('totalPnl sums closed trades', () => {
    mockGetAll.mockReturnValue([
      closedWin('w1',  50),
      closedWin('w2',  30),
      closedLoss('l1', -20),
      makeTrade({ id: 'o1', status: 'open' }), // open - excluded from totalPnl
    ]);
    const book = buildTradeBook();
    expect(book.totalPnl).toBeCloseTo(60, 6);
  });

  it('bestTrade and worstTrade are the max/min pnl closed trades', () => {
    const w = closedWin('best', 100);
    const l = closedLoss('worst', -80);
    const m = closedWin('mid', 40);
    mockGetAll.mockReturnValue([m, w, l]);
    const book = buildTradeBook();
    expect(book.bestTrade!.id).toBe('best');
    expect(book.worstTrade!.id).toBe('worst');
  });

  it('openExposure = sum of entryPrice * qty for open trades', () => {
    mockGetAll.mockReturnValue([
      makeTrade({ id: 'o1', status: 'open', entryPrice: 100, qty: 5 }),
      makeTrade({ id: 'o2', status: 'open', entryPrice: 200, qty: 3 }),
      closedWin('c1'), // not counted in exposure
    ]);
    const book = buildTradeBook();
    // 100*5 + 200*3 = 500 + 600 = 1100
    expect(book.openExposure).toBeCloseTo(1100, 6);
  });

  it('byStrategy breaks down per strategyId', () => {
    mockGetAll.mockReturnValue([
      closedWin('w1', 50, 'rsi'),
      closedWin('w2', 30, 'rsi'),
      closedLoss('l1', -20, 'rsi'),
      closedWin('w3', 100, 'ma'),
      makeTrade({ id: 'o1', strategyId: 'ma', status: 'open' }),
    ]);
    const book = buildTradeBook();

    expect(book.byStrategy['rsi'].trades).toBe(3);
    expect(book.byStrategy['rsi'].winRate).toBeCloseTo(2 / 3, 4);
    expect(book.byStrategy['rsi'].totalPnl).toBeCloseTo(60, 6);

    expect(book.byStrategy['ma'].trades).toBe(2);
    expect(book.byStrategy['ma'].winRate).toBeCloseTo(1, 4); // 1 closed win out of 1 closed
    expect(book.byStrategy['ma'].totalPnl).toBeCloseTo(100, 6);
  });

  it('avgPnlPct averages closed pnlPct values', () => {
    mockGetAll.mockReturnValue([
      closedWin('w1',  50),  // pnlPct = 5
      closedLoss('l1', -30), // pnlPct = -3
    ]);
    const book = buildTradeBook();
    // avg = (5 + (-3)) / 2 = 1
    expect(book.avgPnlPct).toBeCloseTo(1, 4);
  });
});
