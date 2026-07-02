/**
 * Tests for the automated intraday paper-trading engine.
 *
 * All external I/O (DB, broker, scanner, Telegram, market-hours) is mocked.
 * Tests focus on the psychology rules and control-flow logic in runAutoTrade.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Bar } from '@/core/types';

// ---------------------------------------------------------------------------
// Shared mock state (mutated per-test in beforeEach)
// ---------------------------------------------------------------------------

// Market hours - default to open
const mockIsUsMarketOpen = vi.fn(() => true);
const mockIsNearMarketClose = vi.fn(() => false);
const mockEtTimeString = vi.fn(() => '10:00');

vi.mock('@/core/market/hours', () => ({
  isUsMarketOpen:    (...args: unknown[]) => mockIsUsMarketOpen(...args),
  isNearMarketClose: (...args: unknown[]) => mockIsNearMarketClose(...args),
  etTimeString:      (...args: unknown[]) => mockEtTimeString(...args),
  // Tests build fixture trade times off new Date().toISOString().slice(0,10)
  // ("today"); mirror that here rather than doing a real ET conversion so
  // fixtures and the code under test agree on what "today" is.
  todayET:           () => new Date().toISOString().slice(0, 10),
  etDateOfIso:       (iso: string) => iso.slice(0, 10),
}));

// Universe
vi.mock('@/core/data/universe', () => ({
  autoTradeUniverse: () => [
    { symbol: 'AAPL', name: 'Apple', assetClass: 'equity', currency: 'USD', providerId: 'alpaca' },
    { symbol: 'MSFT', name: 'Microsoft', assetClass: 'equity', currency: 'USD', providerId: 'alpaca' },
    { symbol: 'GLD',  name: 'SPDR Gold', assetClass: 'commodity', currency: 'USD', providerId: 'alpaca' },
  ],
}));

// DB paper functions
const mockGetPaperTrades     = vi.fn<[], import('@/core/types').PaperTrade[]>(() => []);
const mockGetActiveTrade     = vi.fn(() => undefined);
const mockSweepOpen          = vi.fn(() => []);
const mockMarkOpen           = vi.fn(() => []);
const mockOpenPaperTrade     = vi.fn();

vi.mock('@/core/paper/broker', () => ({
  sweepOpenTrades:        (...args: unknown[]) => mockSweepOpen(...args),
  markOpenTrades:         (...args: unknown[]) => mockMarkOpen(...args),
  openPaperTrade:         (...args: unknown[]) => mockOpenPaperTrade(...args),
  DuplicateOpenTradeError: class DuplicateOpenTradeError extends Error {
    symbol = 'AAPL'; existingTradeId = 'x';
    constructor() { super('duplicate'); this.name = 'DuplicateOpenTradeError'; }
  },
  RiskCheckError: class RiskCheckError extends Error {
    rule = 'total-open-risk';
    constructor(rule?: string, message?: string) { super(message ?? 'risk check failed'); this.name = 'RiskCheckError'; if (rule) this.rule = rule; }
  },
}));

vi.mock('@/core/db/paper', () => ({
  getPaperTrades:              (...args: unknown[]) => mockGetPaperTrades(...args),
  getActivePaperTradeBySymbol: (...args: unknown[]) => mockGetActiveTrade(...args),
}));

// Account
const mockCashAccount = vi.fn(() => ({
  startingBalance: 10_000, realized: 0, cashUsed: 0, cash: 10_000,
  openTrades: 0, closedTrades: 0,
}));
vi.mock('@/core/paper/account', () => ({
  computeCashAccount: () => mockCashAccount(),
  buildAccountSummary: (ca: { startingBalance: number; realized: number; cashUsed: number }, unr: number) => ({
    ...ca, unrealized: unr, equity: ca.startingBalance + ca.realized + unr, bankrupt: false,
  }),
}));

// Strategies
vi.mock('@/core/strategy/registry', () => ({
  listLive: () => [{ id: 'strat-a', name: 'A', description: '' }, { id: 'strat-b', name: 'B', description: '' }],
  list:     () => [{ id: 'strat-a', name: 'A', description: '' }, { id: 'strat-b', name: 'B', description: '' }],
  get:  (id: string) => ({
    id,
    name: id,
    description: '',
    params: { parse: () => ({}) },
  }),
}));

// Bars
const STUB_BARS: Bar[] = Array.from({ length: 50 }, (_, i) => ({
  time: `2025-06-18T${String(9 + Math.floor(i / 4)).padStart(2,'0')}:${String((i % 4) * 15).padStart(2,'0')}:00Z`,
  open: 100 + i * 0.1, high: 101 + i * 0.1, low: 99 + i * 0.1, close: 100.5 + i * 0.1, volume: 1000,
}));

// Scanner - returns entry signal for each strategy by default
const mockScanSymbol = vi.fn((sym: string, _bars: Bar[], strategy: { id: string }) => ({
  signal:   { symbol: sym, time: '2025-06-18T14:30:00Z', side: 'long', strategyId: strategy.id, reason: 'test' },
  decision: { action: 'enter_long', stopPct: 0.05, targetPct: 0.10 },
}));
vi.mock('@/core/scan/scanner', () => ({
  scanSymbol: (...args: unknown[]) => mockScanSymbol(...(args as Parameters<typeof mockScanSymbol>)),
}));

// Consensus - default returns 2-strategy agreement on all symbols
vi.mock('@/core/scan/consensus', () => ({
  buildConsensus: (signals: Array<{ symbol: string; side: string; strategyId: string; reason: string }>, _total: number) => {
    const byKey = new Map<string, { symbol: string; side: string; agreeCount: number; strategyIds: string[]; reasons: Record<string, string>; time: string; totalStrategies: number; strength: number }>();
    for (const s of signals) {
      const key = `${s.symbol}|${s.side}`;
      if (!byKey.has(key)) byKey.set(key, { symbol: s.symbol, side: s.side, agreeCount: 0, strategyIds: [], reasons: {}, time: s.time, totalStrategies: 2, strength: 0 });
      const g = byKey.get(key)!;
      if (!(s.strategyId in g.reasons)) { g.agreeCount++; g.strategyIds.push(s.strategyId); g.reasons[s.strategyId] = s.reason; }
    }
    return Array.from(byKey.values()).map((g) => ({ ...g, strength: g.agreeCount / 2 }));
  },
}));

// recommendTrade - returns a valid idea
vi.mock('@/core/signals/recommend', () => ({
  recommendTrade: (_sig: unknown, _bars: unknown, _dec: unknown, cfg: { equity: number }) => ({
    symbol: 'AAPL', strategyId: 'strat-a', side: 'long', currency: 'USD',
    entryPrice: 150, stopPrice: 142.5, targetPrice: 165,
    qty: Math.floor((cfg.equity * 0.01) / (150 - 142.5)),
    riskAmount: (cfg.equity * 0.01), rewardAmount: (cfg.equity * 0.01) * 2, rr: 2, reason: 'test', time: '2025-06-18',
  }),
  capIdeaToCash: (idea: { qty: number }, cash: number) => ({ ...idea, qty: Math.min(idea.qty, Math.floor(cash / 150)) }),
}));

// Telegram - silent
vi.mock('@/core/notify/telegram', () => ({
  telegramConfigured: () => false,
  sendTelegram:       async () => true,
  escapeHtml:         (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
}));

// Halt switch - not halted by default in auto-trade tests
vi.mock('@/core/paper/halt', () => ({
  isTradingHalted: () => ({ halted: false }),
  setTradingHalt:  () => {},
  clearTradingHalt: () => {},
}));

// Flags - no-op (used for no-budget warning dedup key)
vi.mock('@/core/db/flags', () => ({
  getFlag:    () => null,
  setFlag:    () => {},
  deleteFlag: () => {},
}));

// Freshness - not stale in tests
vi.mock('@/core/notify/freshness', () => ({
  classifyFreshness: () => ({ latestBarTime: '2025-06-18', ageMinutes: 15, stale: false, label: 'fresh (15m ago)' }),
}));

// getLatestBarTime - needed for journalWhy
vi.mock('@/core/db/bars', () => ({
  getRecentBars:    () => STUB_BARS,
  getLatestBarTime: () => '2025-06-18T14:30:00Z',
}));

// ---------------------------------------------------------------------------
// Environment: set AUTO_TRADE_ENABLED=1 by default
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.resetAllMocks();
  // Re-apply defaults after reset
  mockIsUsMarketOpen.mockReturnValue(true);
  mockIsNearMarketClose.mockReturnValue(false);
  mockEtTimeString.mockReturnValue('10:00');
  mockGetPaperTrades.mockReturnValue([]);
  mockGetActiveTrade.mockReturnValue(undefined);
  mockSweepOpen.mockReturnValue([]);
  mockMarkOpen.mockReturnValue([]);
  mockOpenPaperTrade.mockReturnValue(undefined);
  mockCashAccount.mockReturnValue({ startingBalance: 10_000, realized: 0, cashUsed: 0, cash: 10_000, openTrades: 0, closedTrades: 0 });
  mockScanSymbol.mockImplementation((sym: string, _bars: Bar[], strategy: { id: string }) => ({
    signal:   { symbol: sym, time: '2025-06-18T14:30:00Z', side: 'long', strategyId: strategy.id, reason: 'test' },
    decision: { action: 'enter_long', stopPct: 0.05, targetPct: 0.10 },
  }));

  // Set env
  process.env.AUTO_TRADE_ENABLED       = '1';
  process.env.AUTO_TRADE_DRY_RUN       = '0';
  process.env.AUTO_TRADE_MIN_CONSENSUS = '2';
  process.env.AUTO_TRADE_MAX_TRADES_PER_DAY = '5';
  process.env.AUTO_TRADE_DAILY_LOSS_HALT_PCT = '0.03';
});

// Lazy import so env/mocks are applied before module load
async function autoTrade(opts = {}) {
  const { runAutoTrade } = await import('./auto-trade');
  return runAutoTrade(opts);
}

describe('runAutoTrade - enabled / market guard', () => {
  it('returns enabled:false when AUTO_TRADE_ENABLED is not set', async () => {
    process.env.AUTO_TRADE_ENABLED = '0';
    const res = await autoTrade();
    expect(res.enabled).toBe(false);
    expect(res.entries).toHaveLength(0);
  });

  it('returns marketOpen:false and no entries when market is closed', async () => {
    mockIsUsMarketOpen.mockReturnValue(false);
    const res = await autoTrade();
    expect(res.marketOpen).toBe(false);
    expect(res.entries).toHaveLength(0);
    expect(mockOpenPaperTrade).not.toHaveBeenCalled();
  });
});

describe('runAutoTrade - position-exists skip', () => {
  it('skips a symbol when active trade already exists', async () => {
    // AAPL has active trade; MSFT and GLD do not
    mockGetActiveTrade.mockImplementation((sym: string) =>
      sym === 'AAPL' ? { id: 'x', symbol: 'AAPL', status: 'open' } : undefined,
    );
    const res = await autoTrade();
    const aaplSkip = res.skips.find((s) => s.symbol === 'AAPL');
    expect(aaplSkip?.reason).toBe('position-exists');
    // MSFT and GLD should NOT be skipped for position-exists
    const msfSkip = res.skips.find((s) => s.symbol === 'MSFT' && s.reason === 'position-exists');
    expect(msfSkip).toBeUndefined();
  });
});

describe('runAutoTrade - consensus filter', () => {
  it('skips symbol when only one strategy agrees (below min-consensus=2)', async () => {
    // Make strat-b return null (no signal) for all symbols
    mockScanSymbol.mockImplementation((sym: string, _bars: Bar[], strategy: { id: string }) => {
      if (strategy.id === 'strat-b') return null;
      return { signal: { symbol: sym, time: '2025-06-18T14:30:00Z', side: 'long', strategyId: strategy.id, reason: 'test' }, decision: { action: 'enter_long', stopPct: 0.05, targetPct: 0.10 } };
    });
    const res = await autoTrade();
    // No entries: only 1 strategy fires
    expect(res.entries).toHaveLength(0);
  });
});

describe('runAutoTrade - near-close skip', () => {
  it('skips all new entries when near market close', async () => {
    mockIsNearMarketClose.mockReturnValue(true);
    const res = await autoTrade();
    expect(res.entries).toHaveLength(0);
    const nearCloseSkips = res.skips.filter((s) => s.reason === 'near-close');
    expect(nearCloseSkips.length).toBeGreaterThan(0);
  });
});

describe('runAutoTrade - no-budget skip', () => {
  it('skips when no budget is set (computeCashAccount returns null)', async () => {
    mockCashAccount.mockReturnValue(null);
    const res = await autoTrade();
    expect(res.entries).toHaveLength(0);
    const budgetSkips = res.skips.filter((s) => s.reason === 'no-budget');
    expect(budgetSkips.length).toBeGreaterThan(0);
  });
});

describe('runAutoTrade - anti-revenge: no-re-entry-today', () => {
  it('skips symbol that was stopped out today', async () => {
    const today = new Date().toISOString().slice(0, 10);
    // MSFT was stopped out (closed today, negative P&L, not manual)
    mockGetPaperTrades.mockImplementation((opts?: { status?: string }) => {
      if (opts?.status === 'open') return [];
      if (opts?.status === 'closed') return [{
        id: 'old', symbol: 'MSFT', side: 'long', qty: 1, entryPrice: 300,
        entryTime: `${today}T09:30:00Z`, exitTime: `${today}T10:00:00Z`,
        status: 'closed', strategyId: 'strat-a', pnl: -50, pnlPct: -0.016,
        costs: 1, stopPrice: null, targetPrice: null, notes: null,
        currency: 'USD',
      }];
      // Default: return all trades for the "opened today" count
      return [{
        id: 'old', symbol: 'MSFT', side: 'long', qty: 1, entryPrice: 300,
        entryTime: `${today}T09:30:00Z`, exitTime: `${today}T10:00:00Z`,
        status: 'closed', strategyId: 'strat-a', pnl: -50, pnlPct: -0.016,
        costs: 1, stopPrice: null, targetPrice: null, notes: null,
        currency: 'USD',
      }];
    });
    const res = await autoTrade();
    const msftSkip = res.skips.find((s) => s.symbol === 'MSFT' && s.reason === 'no-re-entry-today');
    expect(msftSkip).toBeDefined();
  });
});

describe('runAutoTrade - max-trades-per-day', () => {
  it('halts when max trades per day already reached', async () => {
    const today = new Date().toISOString().slice(0, 10);
    // 5 auto trades already opened today (matching maxTradesPerDay default)
    const fakeTrades = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`, symbol: `SYM${i}`, side: 'long', qty: 1, entryPrice: 100,
      entryTime: `${today}T09:${String(30 + i).padStart(2,'0')}:00Z`,
      status: 'open', strategyId: 'strat-a',
      pnl: null, pnlPct: null, costs: 0, stopPrice: null, targetPrice: null, notes: 'auto:strat-a',
      currency: 'USD',
    }));
    mockGetPaperTrades.mockReturnValue(fakeTrades);
    const res = await autoTrade();
    expect(res.halted).toBe(true);
    expect(res.haltReason).toMatch(/max trades\/day/i);
    expect(res.entries).toHaveLength(0);
  });
});

describe('runAutoTrade - daily-loss halt', () => {
  it('halts when day P&L drops below -3% of equity', async () => {
    const today = new Date().toISOString().slice(0, 10);
    // Realized loss today: -$500 on equity of $10k = -5% (above 3% halt threshold)
    mockGetPaperTrades.mockImplementation((opts?: { status?: string }) => {
      if (opts?.status === 'open') return [];
      if (opts?.status === 'closed') return [{
        id: 'loss1', symbol: 'AAPL', side: 'long', qty: 1, entryPrice: 150,
        entryTime: `${today}T09:30:00Z`, exitTime: `${today}T09:45:00Z`,
        status: 'closed', strategyId: 'strat-a', pnl: -500, pnlPct: -0.05,
        costs: 1, stopPrice: null, targetPrice: null, notes: 'auto:strat-a',
        currency: 'USD',
      }];
      return [];
    });
    // Mark returns no unrealized (no open trades)
    mockMarkOpen.mockReturnValue([]);
    const res = await autoTrade();
    expect(res.halted).toBe(true);
    expect(res.haltReason).toMatch(/daily loss halt/i);
    expect(res.entries).toHaveLength(0);
  });

  it('counts a realized loss on a manual trade toward the halt (account-wide scope)', async () => {
    // Previously realizedToday excluded strategyId === 'manual' trades while
    // unrealizedUSD summed every open position including manual - a scope
    // mismatch. A bad day driven entirely by a manual trade should still
    // trip the safety brake.
    const today = new Date().toISOString().slice(0, 10);
    mockGetPaperTrades.mockImplementation((opts?: { status?: string }) => {
      if (opts?.status === 'open') return [];
      if (opts?.status === 'closed') return [{
        id: 'loss1', symbol: 'AAPL', side: 'long', qty: 1, entryPrice: 150,
        entryTime: `${today}T09:30:00Z`, exitTime: `${today}T09:45:00Z`,
        status: 'closed', strategyId: 'manual', pnl: -500, pnlPct: -0.05,
        costs: 1, stopPrice: null, targetPrice: null, notes: 'manual entry',
        currency: 'USD',
      }];
      return [];
    });
    mockMarkOpen.mockReturnValue([]);
    const res = await autoTrade();
    expect(res.halted).toBe(true);
    expect(res.haltReason).toMatch(/daily loss halt/i);
  });
});

describe('runAutoTrade - dry run', () => {
  it('does not call openPaperTrade in dry-run mode', async () => {
    process.env.AUTO_TRADE_DRY_RUN = '1';
    const res = await autoTrade();
    expect(mockOpenPaperTrade).not.toHaveBeenCalled();
    // But entries should still be recorded in summary
    expect(res.dryRun).toBe(true);
    // Entries listed even in dry-run (intended)
    expect(res.entries.every((e) => e.dryRun)).toBe(true);
  });
});

describe('runAutoTrade - successful live entry', () => {
  it('calls openPaperTrade with risk-sized qty when all gates pass', async () => {
    const res = await autoTrade();
    expect(mockOpenPaperTrade).toHaveBeenCalled();
    // All entries should have qty > 0
    for (const entry of res.entries) {
      expect(entry.qty).toBeGreaterThan(0);
    }
  });

  it('does not re-run scanSymbol for the lead strategy at execution time (no re-derivation drift)', async () => {
    // Stateful mock: a real stateful strategy (e.g. atr-trend's WeakMap-held
    // trailing high) can return a different decision on a second call with
    // the same bars. scanSymbol should be called exactly once per
    // (symbol, strategy) during the scan phase - the execution phase must
    // reuse that cached decision, not call it again.
    let callCount = 0;
    mockScanSymbol.mockImplementation((sym: string, _bars: Bar[], strategy: { id: string }) => {
      callCount++;
      return {
        signal:   { symbol: sym, time: '2025-06-18T14:30:00Z', side: 'long', strategyId: strategy.id, reason: 'test' },
        decision: { action: 'enter_long', stopPct: 0.05, targetPct: 0.10 },
      };
    });

    await autoTrade();

    // 3 universe symbols x 2 strategies = 6 calls total during the scan
    // phase. If execution re-ran scanSymbol for the lead strategy per
    // opened symbol, the count would be higher.
    expect(callCount).toBe(6);
  });
});
