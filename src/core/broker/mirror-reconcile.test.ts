import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MirrorOrder } from '@/core/db/mirror';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let filledOrders: MirrorOrder[] = [];
let pendingOrders: MirrorOrder[] = [];

vi.mock('@/core/db/mirror', () => ({
  getFilledMirrorOrders: () => filledOrders,
  getMirrorOrdersByStatus: () => pendingOrders,
}));

let internalTrades: Array<{ symbol: string; side: 'long' | 'short'; qty: number; status: string }> = [];
vi.mock('@/core/db/paper', () => ({
  getPaperTrades: () => internalTrades,
}));

const mockGetPositions = vi.fn();
vi.mock('./alpaca-trading', () => ({
  getAlpacaTradingClient: () => ({ getPositions: mockGetPositions }),
}));

vi.mock('./mirror', () => ({
  mirrorEnabled: () => true,
  isMirrorEligible: (s: string) => !s.endsWith('.NS'),
}));

const sentMessages: string[] = [];
vi.mock('@/core/notify/telegram', () => ({
  telegramConfigured: () => true,
  sendTelegram: (text: string) => { sentMessages.push(text); return Promise.resolve(true); },
}));

const { reconcileMirror, mirrorDriftStats } = await import('./mirror-reconcile');

function mkFill(overrides: Partial<MirrorOrder>): MirrorOrder {
  return {
    id: Math.random().toString(36).slice(2),
    tradeId: 't',
    leg: 'entry',
    broker: 'alpaca',
    clientOrderId: Math.random().toString(36).slice(2),
    symbol: 'AAPL',
    side: 'buy',
    qty: 10,
    orderType: 'market',
    timeInForce: 'day',
    status: 'filled',
    internalPrice: 100,
    fillPrice: 100,
    fillQty: 10,
    filledAt: '2026-07-08T15:00:00Z',
    attempts: 1,
    createdAt: '2026-07-08T14:59:00Z',
    updatedAt: '2026-07-08T15:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  filledOrders = [];
  pendingOrders = [];
  internalTrades = [];
  sentMessages.length = 0;
  mockGetPositions.mockReset();
  mockGetPositions.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// reconcileMirror
// ---------------------------------------------------------------------------

describe('reconcileMirror', () => {
  it('reports matched when internal and Alpaca agree', async () => {
    internalTrades = [{ symbol: 'AAPL', side: 'long', qty: 10, status: 'open' }];
    mockGetPositions.mockResolvedValue([
      { symbol: 'AAPL', qty: 10, side: 'long', avgEntryPrice: 100, marketValue: 1000 },
    ]);
    const rec = await reconcileMirror();
    expect(rec.matched).toBe(1);
    expect(rec.mismatches).toHaveLength(0);
    expect(sentMessages).toHaveLength(0);
  });

  it('flags missing-at-alpaca, orphan-at-alpaca, and qty mismatches', async () => {
    internalTrades = [
      { symbol: 'AAPL', side: 'long', qty: 10, status: 'open' },   // missing at broker
      { symbol: 'MSFT', side: 'long', qty: 100, status: 'open' },  // qty off by 50
    ];
    mockGetPositions.mockResolvedValue([
      { symbol: 'MSFT', qty: 50, side: 'long', avgEntryPrice: 100, marketValue: 5000 },
      { symbol: 'NVDA', qty: 5, side: 'long', avgEntryPrice: 100, marketValue: 500 }, // orphan
    ]);
    const rec = await reconcileMirror();
    const kinds = rec.mismatches.map((m) => `${m.symbol}:${m.kind}`).sort();
    expect(kinds).toEqual([
      'AAPL:missing-at-alpaca',
      'MSFT:qty-mismatch',
      'NVDA:orphan-at-alpaca',
    ]);
    expect(sentMessages).toHaveLength(1); // Telegram alert fired
  });

  it('tolerates small qty diffs from whole-share short rounding', async () => {
    internalTrades = [{ symbol: 'ACGL', side: 'short', qty: 25.3, status: 'open' }];
    mockGetPositions.mockResolvedValue([
      { symbol: 'ACGL', qty: 25, side: 'short', avgEntryPrice: 100, marketValue: -2500 },
    ]);
    const rec = await reconcileMirror();
    expect(rec.matched).toBe(1);
    expect(rec.mismatches).toHaveLength(0);
  });

  it('ignores non-eligible internal trades (NSE)', async () => {
    internalTrades = [{ symbol: 'TCS.NS', side: 'long', qty: 5, status: 'open' }];
    const rec = await reconcileMirror();
    expect(rec.internalOpenTrades).toBe(0);
    expect(rec.mismatches).toHaveLength(0);
  });

  it('counts stuck queued/submitted orders older than 24h', async () => {
    pendingOrders = [
      mkFill({ status: 'queued', createdAt: '2026-07-01T00:00:00Z' }),
      mkFill({ status: 'submitted', createdAt: new Date().toISOString() }),
    ];
    const rec = await reconcileMirror();
    expect(rec.stuckOrders).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// mirrorDriftStats
// ---------------------------------------------------------------------------

describe('mirrorDriftStats', () => {
  it('returns null with no fills', () => {
    expect(mirrorDriftStats()).toBeNull();
  });

  it('computes signed adverse drift in bps (buy: higher fill = worse)', () => {
    filledOrders = [
      mkFill({ side: 'buy', internalPrice: 100, fillPrice: 100.10 }), // +10 bps adverse
      mkFill({ side: 'buy', internalPrice: 100, fillPrice: 99.95 }),  // -5 bps favorable
    ];
    const stats = mirrorDriftStats()!;
    expect(stats.fills).toBe(2);
    expect(stats.meanDriftBps).toBeCloseTo((10 - 5) / 2, 5);
    expect(stats.worstDriftBps).toBeCloseTo(10, 5);
  });

  it('inverts the sign for sells (lower fill = worse)', () => {
    filledOrders = [
      mkFill({ side: 'sell', internalPrice: 100, fillPrice: 99.9 }), // -10 raw -> +10 adverse
    ];
    const stats = mirrorDriftStats()!;
    expect(stats.meanDriftBps).toBeCloseTo(10, 5);
  });

  it('excludes opg legs from the headline stats', () => {
    filledOrders = [
      mkFill({ side: 'buy', internalPrice: 100, fillPrice: 100.05, timeInForce: 'day' }),
      mkFill({ side: 'buy', internalPrice: 100, fillPrice: 102, timeInForce: 'opg' }), // overnight gap
    ];
    const stats = mirrorDriftStats()!;
    expect(stats.fills).toBe(1);
    expect(stats.opgFills).toBe(1);
    expect(stats.meanDriftBps).toBeCloseTo(5, 5);
  });
});
