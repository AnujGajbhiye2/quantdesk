import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the DB client - capture prepared SQL + positional params, no real SQLite
// ---------------------------------------------------------------------------

interface Call { sql: string; params: unknown }
const runCalls: Call[] = [];
let getResult: unknown = undefined;
let allResult: unknown[] = [];

vi.mock('./client', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      run: (params: unknown) => { runCalls.push({ sql, params }); },
      get: (params: unknown) => { runCalls.push({ sql, params }); return getResult; },
      all: (params?: unknown) => { runCalls.push({ sql, params }); return allResult; },
    }),
  }),
}));

const {
  insertMirrorOrder,
  updateMirrorOrderStatus,
  recordMirrorFill,
  getMirrorOrdersByStatus,
  getMirrorOrdersForTrades,
} = await import('./mirror');
import type { MirrorOrder } from './mirror';

const ORDER: MirrorOrder = {
  id: 'm-1',
  tradeId: 'trade-1',
  leg: 'entry',
  broker: 'alpaca',
  clientOrderId: 'qd:trade-1:entry',
  symbol: 'AAPL',
  side: 'buy',
  qty: 10,
  orderType: 'market',
  timeInForce: 'day',
  status: 'queued',
  internalPrice: 150.1,
  attempts: 0,
  createdAt: '2026-07-08T14:00:00Z',
  updatedAt: '2026-07-08T14:00:00Z',
};

beforeEach(() => {
  runCalls.length = 0;
  getResult = undefined;
  allResult = [];
});

describe('insertMirrorOrder', () => {
  it('writes all columns with positional array params (libsql write rule)', () => {
    insertMirrorOrder(ORDER);
    expect(runCalls).toHaveLength(1);
    const { sql, params } = runCalls[0];
    expect(sql).toContain('INSERT INTO mirror_orders');
    expect(Array.isArray(params)).toBe(true);
    const p = params as unknown[];
    expect(p).toHaveLength(20);
    expect(p[0]).toBe('m-1');          // id
    expect(p[1]).toBe('trade-1');      // trade_id
    expect(p[2]).toBe('entry');        // leg
    expect(p[4]).toBe('qd:trade-1:entry'); // client_order_id
    expect(p[5]).toBeNull();           // broker_order_id
    expect(p[11]).toBe('queued');      // status
    expect(p[12]).toBe(150.1);         // internal_price
  });
});

describe('updateMirrorOrderStatus', () => {
  it('bumps attempts only when asked', () => {
    updateMirrorOrderStatus('m-1', { status: 'submitted', brokerOrderId: 'ord-9', bumpAttempts: true });
    const p = runCalls[0].params as unknown[];
    expect(p[0]).toBe('submitted');
    expect(p[1]).toBe('ord-9');
    expect(p[3]).toBe(1); // attempts increment
    expect(p[7]).toBe('m-1');

    updateMirrorOrderStatus('m-1', { status: 'failed', error: 'boom' });
    const p2 = runCalls[1].params as unknown[];
    expect(p2[2]).toBe('boom');
    expect(p2[3]).toBe(0);
  });
});

describe('recordMirrorFill', () => {
  it('stores fill price/qty/time and flips status to filled', () => {
    recordMirrorFill('m-1', { fillPrice: 150.4, fillQty: 10, filledAt: '2026-07-08T14:31:00Z' });
    const { sql, params } = runCalls[0];
    expect(sql).toContain("status     = 'filled'");
    const p = params as unknown[];
    expect(p[0]).toBe(150.4);
    expect(p[1]).toBe(10);
    expect(p[2]).toBe('2026-07-08T14:31:00Z');
    expect(p[4]).toBe('m-1');
  });
});

describe('readers', () => {
  it('getMirrorOrdersByStatus builds an IN clause with one placeholder per status', () => {
    getMirrorOrdersByStatus(['queued', 'submitted']);
    const { sql, params } = runCalls[0];
    expect(sql).toContain('IN (?, ?)');
    expect(params).toEqual(['queued', 'submitted']);
  });

  it('returns [] for empty inputs without touching the DB', () => {
    expect(getMirrorOrdersByStatus([])).toEqual([]);
    expect(getMirrorOrdersForTrades([])).toEqual([]);
    expect(runCalls).toHaveLength(0);
  });
});
