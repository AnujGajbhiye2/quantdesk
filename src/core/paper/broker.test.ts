import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PaperTrade } from '@/core/types';

// ---------------------------------------------------------------------------
// Mock DB modules so no real SQLite is touched in tests
// ---------------------------------------------------------------------------

const mockInsert   = vi.fn();
const mockUpdate   = vi.fn();
const mockGetOne   = vi.fn();
const mockGetAll   = vi.fn();
const mockGetClose = vi.fn();
const mockGetBars  = vi.fn();

vi.mock('@/core/db/paper', () => ({
  insertPaperTrade: (...args: unknown[]) => mockInsert(...args),
  updatePaperTrade: (...args: unknown[]) => mockUpdate(...args),
  getPaperTrade:    (...args: unknown[]) => mockGetOne(...args),
  getPaperTrades:   (...args: unknown[]) => mockGetAll(...args),
}));

vi.mock('@/core/db/bars', () => ({
  getLatestClose: (...args: unknown[]) => mockGetClose(...args),
  getBars:        (...args: unknown[]) => mockGetBars(...args),
  getAllSymbols:  () => [],
}));

// Import broker AFTER mocks are registered
const { openPaperTrade, closePaperTrade, markOpenTrades, projectTrade } =
  await import('./broker');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBar(i: number) {
  return {
    time:   `2024-01-${String(i + 1).padStart(2, '0')}`,
    open:   100 + i,
    high:   105 + i,
    low:    95  + i,
    close:  102 + i,
    volume: 1_000,
  };
}

function makeBars(n: number) {
  return Array.from({ length: n }, (_, i) => makeBar(i));
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// openPaperTrade
// ---------------------------------------------------------------------------

describe('openPaperTrade', () => {
  it('applies entry slippage to fill price', () => {
    const trade = openPaperTrade({
      strategyId:  'rsi',
      symbol:      'AAPL',
      side:        'long',
      entryPrice:  100,
      entryTime:   '2024-01-01',
      slippagePct: 0.01,   // 1%
      equity:      1_000,
    });
    // fillPrice = 100 * 1.01 = 101
    expect(trade.entryPrice).toBeCloseTo(101, 6);
  });

  it('computes qty from equity and fill price', () => {
    const trade = openPaperTrade({
      strategyId: 'rsi', symbol: 'AAPL', side: 'long',
      entryPrice: 100, entryTime: '2024-01-01',
      slippagePct: 0, equity: 1_000, sizePct: 1,
    });
    // qty = 1000 / 100 = 10
    expect(trade.qty).toBeCloseTo(10, 6);
  });

  it('sets stop and target prices on long', () => {
    const trade = openPaperTrade({
      strategyId: 'rsi', symbol: 'AAPL', side: 'long',
      entryPrice: 100, entryTime: '2024-01-01',
      slippagePct: 0, equity: 1_000,
      stopPct: 0.05, targetPct: 0.10,
    });
    expect(trade.stopPrice).toBeCloseTo(95,  6);
    expect(trade.targetPrice).toBeCloseTo(110, 6);
  });

  it('sets stop and target prices on short (inverted)', () => {
    const trade = openPaperTrade({
      strategyId: 'rsi', symbol: 'AAPL', side: 'short',
      entryPrice: 100, entryTime: '2024-01-01',
      slippagePct: 0, equity: 1_000,
      stopPct: 0.05, targetPct: 0.10,
    });
    expect(trade.stopPrice).toBeCloseTo(105, 6);
    expect(trade.targetPrice).toBeCloseTo(90,  6);
  });

  it('status is open and costs are 0 at open', () => {
    const trade = openPaperTrade({
      strategyId: 'rsi', symbol: 'AAPL', side: 'long',
      entryPrice: 100, entryTime: '2024-01-01',
    });
    expect(trade.status).toBe('open');
    expect(trade.costs).toBe(0);
  });

  it('calls insertPaperTrade', () => {
    openPaperTrade({
      strategyId: 'rsi', symbol: 'AAPL', side: 'long',
      entryPrice: 100, entryTime: '2024-01-01',
    });
    expect(mockInsert).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// closePaperTrade - hand-calculated P&L parity with backtest engine
// ---------------------------------------------------------------------------

describe('closePaperTrade', () => {
  const openTrade: PaperTrade = {
    id:         'trade-1',
    strategyId: 'rsi',
    symbol:     'AAPL',
    side:       'long',
    qty:        10,
    entryTime:  '2024-01-01',
    entryPrice: 100,  // already slippage-adjusted (mirrors engine)
    status:     'open',
    costs:      0,
  };

  beforeEach(() => {
    mockGetOne.mockReturnValue(openTrade);
  });

  it('long win: P&L matches engine formula to the cent', () => {
    // exit raw price = 120, slippage 0%, commission 5
    // exitFill = 120 * (1 - 0) = 120
    // pnl = (120 - 100) * 10 - 2*5 = 200 - 10 = 190
    // costs = 2 * 5 = 10
    // pnlPct = 190 / (100 * 10) * 100 = 19
    const result = closePaperTrade('trade-1', {
      exitPrice:   120,
      exitTime:    '2024-01-10',
      commission:  5,
      slippagePct: 0,
    });
    expect(result.pnl).toBeCloseTo(190, 6);
    expect(result.costs).toBeCloseTo(10, 6);
    expect(result.pnlPct).toBeCloseTo(19, 4);
    expect(result.exitPrice).toBeCloseTo(120, 6);
    expect(result.status).toBe('closed');
  });

  it('long loss: P&L is negative', () => {
    // exit 90, slippage 0, commission 0
    // pnl = (90 - 100) * 10 = -100
    const result = closePaperTrade('trade-1', {
      exitPrice: 90, exitTime: '2024-01-05',
      commission: 0, slippagePct: 0,
    });
    expect(result.pnl).toBeCloseTo(-100, 6);
    expect(result.pnlPct).toBeCloseTo(-10, 4);
  });

  it('applies adverse exit slippage (long exit fills below market)', () => {
    // exit raw = 100, slippage 1% -> fill = 99
    // pnl = (99 - 100) * 10 = -10
    const result = closePaperTrade('trade-1', {
      exitPrice: 100, exitTime: '2024-01-05',
      commission: 0, slippagePct: 0.01,
    });
    expect(result.exitPrice).toBeCloseTo(99, 6);
    expect(result.pnl).toBeCloseTo(-10, 6);
  });

  it('short win: profit when exit < entry', () => {
    const shortTrade: PaperTrade = {
      ...openTrade, side: 'short', entryPrice: 100, qty: 10,
    };
    mockGetOne.mockReturnValue(shortTrade);

    // exit 80, no commission, no slippage
    // pnl = (100 - 80) * 10 = 200
    const result = closePaperTrade('trade-1', {
      exitPrice: 80, exitTime: '2024-01-10',
      commission: 0, slippagePct: 0,
    });
    expect(result.pnl).toBeCloseTo(200, 6);
  });

  it('throws if trade not found', () => {
    mockGetOne.mockReturnValue(undefined);
    expect(() =>
      closePaperTrade('missing', { exitPrice: 100, exitTime: '2024-01-01' }),
    ).toThrow("Paper trade 'missing' not found.");
  });

  it('throws if already closed', () => {
    mockGetOne.mockReturnValue({ ...openTrade, status: 'closed' });
    expect(() =>
      closePaperTrade('trade-1', { exitPrice: 100, exitTime: '2024-01-01' }),
    ).toThrow("already closed");
  });

  it('calls updatePaperTrade', () => {
    closePaperTrade('trade-1', {
      exitPrice: 120, exitTime: '2024-01-10', commission: 0, slippagePct: 0,
    });
    expect(mockUpdate).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// markOpenTrades
// ---------------------------------------------------------------------------

describe('markOpenTrades', () => {
  it('marks long position unrealized P&L against latest close', () => {
    const trade: PaperTrade = {
      id: 't1', strategyId: 'rsi', symbol: 'AAPL',
      side: 'long', qty: 10, entryTime: '2024-01-01', entryPrice: 100,
      status: 'open', costs: 0,
    };
    mockGetAll.mockReturnValue([trade]);
    mockGetClose.mockReturnValue(115);

    const [mark] = markOpenTrades();
    expect(mark.markPrice).toBe(115);
    // unrealized = (115 - 100) * 10 = 150
    expect(mark.unrealizedPnl).toBeCloseTo(150, 6);
    expect(mark.unrealizedPnlPct).toBeCloseTo(15, 4);
  });

  it('marks short position unrealized P&L correctly', () => {
    const trade: PaperTrade = {
      id: 't2', strategyId: 'rsi', symbol: 'MSFT',
      side: 'short', qty: 10, entryTime: '2024-01-01', entryPrice: 100,
      status: 'open', costs: 0,
    };
    mockGetAll.mockReturnValue([trade]);
    mockGetClose.mockReturnValue(85);

    const [mark] = markOpenTrades();
    // unrealized = (100 - 85) * 10 = 150
    expect(mark.unrealizedPnl).toBeCloseTo(150, 6);
  });

  it('falls back to entryPrice when no close available', () => {
    const trade: PaperTrade = {
      id: 't3', strategyId: 'rsi', symbol: 'UNKNOWN',
      side: 'long', qty: 5, entryTime: '2024-01-01', entryPrice: 200,
      status: 'open', costs: 0,
    };
    mockGetAll.mockReturnValue([trade]);
    mockGetClose.mockReturnValue(null);

    const [mark] = markOpenTrades();
    expect(mark.markPrice).toBe(200);
    expect(mark.unrealizedPnl).toBeCloseTo(0, 6);
  });
});

// ---------------------------------------------------------------------------
// projectTrade P&L parity with runBacktest
// ---------------------------------------------------------------------------

describe('projectTrade', () => {
  it('returns no-data when symbol has no bars at or after entryDate', () => {
    mockGetBars.mockReturnValue([]);
    const result = projectTrade({ symbol: 'X', entryDate: '2024-01-01', holdingBars: 5 });
    expect(result.status).toBe('no-data');
  });

  it('returns open when not enough bars to close the trade', () => {
    // Need holdingBars+2 = 7 bars; provide only 5
    mockGetBars.mockReturnValue(makeBars(5));
    const result = projectTrade({ symbol: 'X', entryDate: '2024-01-01', holdingBars: 5 });
    expect(result.status).toBe('open');
  });

  it('returns closed trade with P&L matching runBacktest for same inputs', async () => {
    // Build a 12-bar series; entry on bar 0, hold for 5 bars
    const bars = makeBars(12);
    mockGetBars.mockReturnValue(bars);

    const result = projectTrade({
      symbol: 'TEST', entryDate: bars[0].time,
      holdingBars: 5, commission: 5, slippagePct: 0,
    });

    expect(result.status).toBe('closed');
    if (result.status !== 'closed') return;

    // Independently verify via runBacktest with the same fixed-hold logic
    const { runBacktest } = await import('@/core/backtest/engine');
    const { z } = await import('zod');
    const strategy = {
      id: 'fixed-hold', name: 'Fixed Hold', description: '',
      params: z.object({}),
      onBar(ctx: import('@/core/strategy/Strategy').StrategyContext) {
        if (ctx.i === 0 && ctx.position === 'flat') return { action: 'enter_long' as const, reason: 'project-entry' };
        if (ctx.i >= 5 && ctx.position !== 'flat')  return { action: 'exit' as const, reason: 'project-exit' };
        return { action: 'hold' as const };
      },
    };
    const slice    = bars.slice(0, 7); // holdingBars+2
    const expected = runBacktest({ strategy, bars: slice, symbol: 'TEST', rawParams: {}, commission: 5, slippagePct: 0 });

    expect(result.trade.pnl).toBeCloseTo(expected.trades[0].pnl, 4);
    expect(result.trade.entryPrice).toBeCloseTo(expected.trades[0].entryPrice, 4);
  });
});
