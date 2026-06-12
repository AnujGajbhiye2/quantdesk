import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PaperTrade } from '@/core/types';

// ---------------------------------------------------------------------------
// Mock DB modules - no real SQLite in tests
// ---------------------------------------------------------------------------

const mockGetAccountRow = vi.fn();
const mockGetAll        = vi.fn();

vi.mock('@/core/db/account', () => ({
  getAccountRow:      (...args: unknown[]) => mockGetAccountRow(...args),
  setStartingBalance: vi.fn(),
}));

vi.mock('@/core/db/paper', () => ({
  getPaperTrades: (...args: unknown[]) => mockGetAll(...args),
}));

const { computeCashAccount, buildAccountSummary } = await import('./account');
const { capIdeaToCash } = await import('@/core/signals/recommend');
const { toUSD, fromUSD } = await import('@/core/format/fx');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trade(overrides: Partial<PaperTrade>): PaperTrade {
  return {
    id:         Math.random().toString(36).slice(2),
    strategyId: 's',
    symbol:     'TEST',
    side:       'long',
    qty:        10,
    entryTime:  '2026-06-01',
    entryPrice: 50,
    status:     'open',
    costs:      0,
    currency:   'USD',
    ...overrides,
  };
}

const accountRow = {
  startingBalance: 1000,
  currency: 'USD',
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
};

beforeEach(() => {
  mockGetAccountRow.mockReset();
  mockGetAll.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeCashAccount', () => {
  it('null when no budget is set', () => {
    mockGetAccountRow.mockReturnValue(null);
    expect(computeCashAccount()).toBeNull();
  });

  it('open trade reserves entry notional from cash', () => {
    mockGetAccountRow.mockReturnValue(accountRow);
    mockGetAll.mockReturnValue([trade({ qty: 4, entryPrice: 50 })]); // $200 basis
    const acct = computeCashAccount()!;
    expect(acct.cashUsed).toBe(200);
    expect(acct.cash).toBe(800);
    expect(acct.openTrades).toBe(1);
  });

  it('closed P&L settles back into cash (full round trip)', () => {
    mockGetAccountRow.mockReturnValue(accountRow);
    mockGetAll.mockReturnValue([
      trade({ status: 'closed', qty: 4, entryPrice: 50, pnl: 60 }),
    ]);
    const acct = computeCashAccount()!;
    expect(acct.cashUsed).toBe(0);
    expect(acct.realized).toBe(60);
    expect(acct.cash).toBe(1060);
  });

  it('converts INR trades to USD at the static rate', () => {
    mockGetAccountRow.mockReturnValue(accountRow);
    mockGetAll.mockReturnValue([
      trade({ currency: 'INR', qty: 10, entryPrice: 1000 }), // 10,000 INR -> 120 USD
    ]);
    const acct = computeCashAccount()!;
    expect(acct.cashUsed).toBeCloseTo(toUSD(10_000, 'INR'), 6);
    expect(acct.cash).toBeCloseTo(1000 - 120, 6);
  });
});

describe('buildAccountSummary', () => {
  it('equity = starting + realized + unrealized', () => {
    mockGetAccountRow.mockReturnValue(accountRow);
    mockGetAll.mockReturnValue([
      trade({ qty: 2, entryPrice: 100 }),                       // open, $200 basis
      trade({ status: 'closed', pnl: -50 }),                    // realized -50
    ]);
    const summary = buildAccountSummary(computeCashAccount()!, 30);
    expect(summary.cash).toBe(1000 - 50 - 200);
    expect(summary.equity).toBe(1000 - 50 + 30);
    expect(summary.bankrupt).toBe(false);
  });

  it('flags bankrupt when equity drops to zero or below', () => {
    mockGetAccountRow.mockReturnValue(accountRow);
    mockGetAll.mockReturnValue([
      trade({ status: 'closed', pnl: -990 }),
    ]);
    const summary = buildAccountSummary(computeCashAccount()!, -20);
    expect(summary.equity).toBe(-10);
    expect(summary.bankrupt).toBe(true);
  });
});

describe('capIdeaToCash', () => {
  const idea = {
    symbol: 'TEST', strategyId: 's', side: 'long' as const, currency: 'USD',
    entryPrice: 100, stopPrice: 95, targetPrice: 110,
    qty: 10, riskAmount: 50, rewardAmount: 100, rr: 2,
    reason: '', time: '2026-06-01',
  };

  it('leaves affordable ideas untouched', () => {
    expect(capIdeaToCash(idea, 2000)).toEqual(idea);
  });

  it('scales qty, risk and reward when cost exceeds cash', () => {
    const capped = capIdeaToCash(idea, 500); // can afford 5 of 10
    expect(capped.qty).toBe(5);
    expect(capped.riskAmount).toBe(25);
    expect(capped.rewardAmount).toBe(50);
    expect(capped.rr).toBe(2); // unchanged
  });

  it('zero cash -> zero qty', () => {
    expect(capIdeaToCash(idea, 0).qty).toBe(0);
  });
});

describe('fx round trip', () => {
  it('toUSD and fromUSD are inverse', () => {
    const inr = 50_000;
    expect(fromUSD(toUSD(inr, 'INR'), 'INR')).toBeCloseTo(inr, 6);
  });
});
