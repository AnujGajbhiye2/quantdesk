import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PaperTrade } from '@/core/types';
import type { MirrorOrder } from '@/core/db/mirror';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const store = new Map<string, MirrorOrder>();

vi.mock('@/core/db/mirror', () => ({
  insertMirrorOrder: (o: MirrorOrder) => { store.set(o.id, { ...o }); },
  updateMirrorOrderStatus: (
    id: string,
    u: { status: MirrorOrder['status']; brokerOrderId?: string; error?: string; bumpAttempts?: boolean; timeInForce?: string; qty?: number },
  ) => {
    const o = store.get(id);
    if (!o) return;
    o.status = u.status;
    if (u.brokerOrderId) o.brokerOrderId = u.brokerOrderId;
    o.error = u.error;
    if (u.bumpAttempts) o.attempts += 1;
    if (u.timeInForce) o.timeInForce = u.timeInForce;
    if (u.qty != null) o.qty = u.qty;
  },
  recordMirrorFill: (id: string, f: { fillPrice: number; fillQty: number; filledAt: string }) => {
    const o = store.get(id);
    if (!o) return;
    o.status = 'filled';
    o.fillPrice = f.fillPrice;
    o.fillQty = f.fillQty;
    o.filledAt = f.filledAt;
  },
  getMirrorOrdersByStatus: (statuses: string[]) =>
    Array.from(store.values()).filter((o) => statuses.includes(o.status)),
  getMirrorOrdersForTrades: (tradeIds: string[]) =>
    Array.from(store.values()).filter((o) => tradeIds.includes(o.tradeId)),
  getFilledMirrorOrders: () =>
    Array.from(store.values()).filter((o) => o.status === 'filled'),
}));

// US-symbol eligibility: pretend AAPL + GLD are in the universe, TCS.NS is not
vi.mock('@/core/data/universe', () => ({
  isAutoTradeSymbol: (s: string) => s === 'AAPL' || s === 'GLD',
}));

// Market open by default; individual tests flip it
const marketOpen = vi.fn(() => true);
vi.mock('@/core/market/hours', () => ({
  isUsMarketOpen: () => marketOpen(),
}));

vi.mock('@/core/notify/telegram', () => ({
  telegramConfigured: () => false,
  sendTelegram: () => Promise.resolve(false),
}));

// Alpaca trading client mock
const mockSubmitOrder = vi.fn();
const mockGetOrder = vi.fn();
const mockGetByClientId = vi.fn();
const mockGetOpenOrders = vi.fn();
const mockCancelOrder = vi.fn();
let clientAvailable = true;

vi.mock('./alpaca-trading', async (importOriginal) => {
  const original = await importOriginal<typeof import('./alpaca-trading')>();
  return {
    ...original,
    getAlpacaTradingClient: () =>
      clientAvailable
        ? {
            submitOrder: mockSubmitOrder,
            getOrder: mockGetOrder,
            getOrderByClientOrderId: mockGetByClientId,
            getOpenOrders: mockGetOpenOrders,
            cancelOrder: mockCancelOrder,
          }
        : null,
  };
});

const {
  tryEnqueueEntryMirror,
  tryEnqueueExitMirror,
  submitQueuedMirrorOrders,
  pollMirrorFills,
  isMirrorEligible,
} = await import('./mirror');
const { AlpacaApiError } = await import('./alpaca-trading');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    id: 'trade-1',
    strategyId: 'rsi-reversion',
    symbol: 'AAPL',
    side: 'long',
    qty: 10.5,
    entryTime: '2026-07-08T14:30:00Z',
    entryPrice: 150.1,
    status: 'open',
    costs: 0,
    ...overrides,
  };
}

function brokerOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ord-1',
    clientOrderId: 'qd:trade-1:entry',
    symbol: 'AAPL',
    side: 'buy',
    qty: 10.5,
    notional: null,
    status: 'accepted',
    filledQty: 0,
    filledAvgPrice: null,
    submittedAt: '2026-07-08T14:30:01Z',
    filledAt: null,
    ...overrides,
  };
}

const ENV_KEYS = ['ALPACA_MIRROR_ENABLED', 'ALPACA_KEY_ID', 'ALPACA_SECRET_KEY', 'LOCAL_DEV_MODE', 'ALPACA_MIRROR_ALLOW_LOCAL'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  marketOpen.mockReturnValue(true);
  clientAvailable = true;
  mockGetByClientId.mockResolvedValue(null);
  mockGetOpenOrders.mockResolvedValue([]);
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.ALPACA_MIRROR_ENABLED = '1';
  process.env.ALPACA_KEY_ID = 'k';
  process.env.ALPACA_SECRET_KEY = 's';
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('gating', () => {
  it('does nothing when ALPACA_MIRROR_ENABLED is unset', () => {
    delete process.env.ALPACA_MIRROR_ENABLED;
    tryEnqueueEntryMirror(makeTrade());
    expect(store.size).toBe(0);
  });

  it('is blocked under LOCAL_DEV_MODE without the local override', () => {
    process.env.LOCAL_DEV_MODE = '1';
    tryEnqueueEntryMirror(makeTrade());
    expect(store.size).toBe(0);
    process.env.ALPACA_MIRROR_ALLOW_LOCAL = '1';
    tryEnqueueEntryMirror(makeTrade());
    expect(store.size).toBe(1);
  });

  it('skips non-US symbols (NSE)', () => {
    tryEnqueueEntryMirror(makeTrade({ symbol: 'TCS.NS' }));
    expect(store.size).toBe(0);
    expect(isMirrorEligible('TCS.NS')).toBe(false);
    expect(isMirrorEligible('AAPL')).toBe(true);
  });
});

describe('enqueue', () => {
  it('creates one entry row per trade, buy side for long, idempotent', () => {
    const trade = makeTrade();
    tryEnqueueEntryMirror(trade);
    tryEnqueueEntryMirror(trade); // duplicate call - no second row
    const rows = Array.from(store.values());
    expect(rows).toHaveLength(1);
    expect(rows[0].leg).toBe('entry');
    expect(rows[0].side).toBe('buy');
    expect(rows[0].clientOrderId).toBe('qd:trade-1:entry');
    expect(rows[0].internalPrice).toBe(150.1);
  });

  it('short entry mirrors as sell; long exit as sell', () => {
    tryEnqueueEntryMirror(makeTrade({ id: 't-short', side: 'short' }));
    tryEnqueueExitMirror(makeTrade({ id: 't-long', status: 'closed', exitPrice: 155.5 }));
    const short = Array.from(store.values()).find((o) => o.tradeId === 't-short')!;
    const exit = Array.from(store.values()).find((o) => o.tradeId === 't-long')!;
    expect(short.side).toBe('sell');
    expect(exit.side).toBe('sell');
    expect(exit.leg).toBe('exit');
    expect(exit.internalPrice).toBe(155.5);
  });
});

describe('submitQueuedMirrorOrders', () => {
  it('submits queued orders with the qd client_order_id and day tif during RTH', async () => {
    mockSubmitOrder.mockResolvedValue(brokerOrder());
    tryEnqueueEntryMirror(makeTrade());
    const results = await submitQueuedMirrorOrders();
    expect(results).toHaveLength(1);
    expect(results[0].outcome).toBe('submitted');
    expect(mockSubmitOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'AAPL',
        side: 'buy',
        type: 'market',
        timeInForce: 'day',
        clientOrderId: 'qd:trade-1:entry',
      }),
    );
    const row = Array.from(store.values())[0];
    expect(row.status).toBe('submitted');
    expect(row.brokerOrderId).toBe('ord-1');
  });

  it('uses opg tif when the market is closed', async () => {
    marketOpen.mockReturnValue(false);
    mockSubmitOrder.mockResolvedValue(brokerOrder());
    tryEnqueueEntryMirror(makeTrade());
    await submitQueuedMirrorOrders();
    expect(mockSubmitOrder.mock.calls[0][0].timeInForce).toBe('opg');
  });

  it('recovers an order that already exists at the broker (idempotency)', async () => {
    mockGetByClientId.mockResolvedValue(brokerOrder());
    tryEnqueueEntryMirror(makeTrade());
    const results = await submitQueuedMirrorOrders();
    expect(results[0].outcome).toBe('recovered');
    expect(mockSubmitOrder).not.toHaveBeenCalled();
  });

  it('rounds short entries down to whole shares', async () => {
    mockSubmitOrder.mockResolvedValue(brokerOrder({ side: 'sell' }));
    tryEnqueueEntryMirror(makeTrade({ side: 'short', qty: 3.7 }));
    await submitQueuedMirrorOrders();
    expect(mockSubmitOrder.mock.calls[0][0].qty).toBe(3);
  });

  it('skips a short entry that rounds to 0 shares', async () => {
    tryEnqueueEntryMirror(makeTrade({ side: 'short', qty: 0.6 }));
    const results = await submitQueuedMirrorOrders();
    expect(results[0].outcome).toBe('skipped');
    expect(Array.from(store.values())[0].status).toBe('skipped');
    expect(mockSubmitOrder).not.toHaveBeenCalled();
  });

  it('keeps an order queued (bumping attempts) on transient errors, fails after max attempts', async () => {
    mockSubmitOrder.mockRejectedValue(new Error('network down'));
    tryEnqueueEntryMirror(makeTrade());
    for (let i = 0; i < 4; i++) {
      const r = await submitQueuedMirrorOrders();
      expect(r[0].outcome).toBe('failed');
      expect(Array.from(store.values())[0].status).toBe('queued');
    }
    await submitQueuedMirrorOrders(); // 5th attempt - give up
    expect(Array.from(store.values())[0].status).toBe('failed');
  });

  it('recovers via lookup after a 422 duplicate client_order_id', async () => {
    mockSubmitOrder.mockRejectedValue(new AlpacaApiError(422, '{"message":"client_order_id must be unique"}'));
    mockGetByClientId
      .mockResolvedValueOnce(null)          // pre-submit idempotency check
      .mockResolvedValueOnce(brokerOrder()); // post-422 recovery lookup
    tryEnqueueEntryMirror(makeTrade());
    const results = await submitQueuedMirrorOrders();
    expect(results[0].outcome).toBe('recovered');
  });

  it('defers an exit while its entry leg is still in flight', async () => {
    const trade = makeTrade();
    tryEnqueueEntryMirror(trade);
    // Entry stays queued (not yet at broker); now the internal trade closes.
    tryEnqueueExitMirror({ ...trade, status: 'closed', exitPrice: 152 });
    mockSubmitOrder.mockResolvedValue(brokerOrder());
    const results = await submitQueuedMirrorOrders();
    // Entry submits; exit defers to the next pass.
    const exitResult = results.find((r) => r.mirrorOrderId === Array.from(store.values()).find((o) => o.leg === 'exit')!.id);
    expect(exitResult?.detail).toContain('deferred');
    const exitRow = Array.from(store.values()).find((o) => o.leg === 'exit')!;
    expect(exitRow.status).toBe('queued');
  });

  it('skips the exit when the entry was skipped (never reached the broker)', async () => {
    const trade = makeTrade({ side: 'short', qty: 0.4 });
    tryEnqueueEntryMirror(trade);
    await submitQueuedMirrorOrders(); // entry -> skipped
    tryEnqueueExitMirror({ ...trade, status: 'closed', exitPrice: 149 });
    const results = await submitQueuedMirrorOrders();
    expect(results[0].outcome).toBe('skipped');
    expect(mockSubmitOrder).not.toHaveBeenCalled();
  });

  it('returns [] when the client is unavailable', async () => {
    clientAvailable = false;
    tryEnqueueEntryMirror(makeTrade());
    expect(await submitQueuedMirrorOrders()).toEqual([]);
  });
});

describe('pollMirrorFills', () => {
  it('records fills from the broker', async () => {
    mockSubmitOrder.mockResolvedValue(brokerOrder());
    tryEnqueueEntryMirror(makeTrade());
    await submitQueuedMirrorOrders();
    mockGetOrder.mockResolvedValue(brokerOrder({
      status: 'filled', filledQty: 10.5, filledAvgPrice: 150.4, filledAt: '2026-07-08T14:31:00Z',
    }));
    const results = await pollMirrorFills();
    expect(results[0].status).toBe('filled');
    const row = Array.from(store.values())[0];
    expect(row.status).toBe('filled');
    expect(row.fillPrice).toBe(150.4);
    expect(row.fillQty).toBe(10.5);
  });

  it('marks rejected orders and keeps pending ones', async () => {
    mockSubmitOrder.mockResolvedValue(brokerOrder());
    tryEnqueueEntryMirror(makeTrade());
    await submitQueuedMirrorOrders();
    mockGetOrder.mockResolvedValue(brokerOrder({ status: 'rejected' }));
    const results = await pollMirrorFills();
    expect(results[0].status).toBe('rejected');
    expect(Array.from(store.values())[0].status).toBe('rejected');
  });
});

describe('hook safety', () => {
  it('never throws even when the DB layer explodes', async () => {
    // Point the insert at a throwing implementation via the store mock:
    // simulate by making enqueue hit a frozen store - simplest: symbol valid,
    // but force getMirrorOrdersForTrades to throw via a poisoned entry.
    const { tryEnqueueEntryMirror: hook } = await import('./mirror');
    const bad = makeTrade();
    Object.defineProperty(bad, 'symbol', { get() { throw new Error('poison'); } });
    expect(() => hook(bad)).not.toThrow();
  });
});
