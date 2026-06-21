import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock flags store so no real SQLite is touched
// ---------------------------------------------------------------------------

let flagStore: Record<string, string> = {};

vi.mock('@/core/db/flags', () => ({
  getFlag:    (key: string) => flagStore[key] ?? null,
  setFlag:    (key: string, value: string) => { flagStore[key] = value; },
  deleteFlag: (key: string) => { delete flagStore[key]; },
}));

import { isTradingHalted, setTradingHalt, clearTradingHalt } from './halt';

beforeEach(() => {
  flagStore = {};
});

describe('isTradingHalted', () => {
  it('returns halted: false when no flag set', () => {
    const s = isTradingHalted();
    expect(s.halted).toBe(false);
    expect(s.reason).toBeUndefined();
  });

  it('returns halted: true with reason when flag is set', () => {
    flagStore['trading_halt'] = 'remote halt via Telegram [set 2025-01-15T12:00:00Z]';
    const s = isTradingHalted();
    expect(s.halted).toBe(true);
    expect(s.reason).toContain('remote halt via Telegram');
  });
});

describe('setTradingHalt', () => {
  it('stores the halt reason in the flag', () => {
    setTradingHalt('my reason');
    expect(flagStore['trading_halt']).toContain('my reason');
  });

  it('appends a [set ...] timestamp', () => {
    setTradingHalt('test');
    expect(flagStore['trading_halt']).toMatch(/\[set \d{4}-\d{2}-\d{2}/);
  });
});

describe('clearTradingHalt', () => {
  it('removes the flag so subsequent isTradingHalted returns false', () => {
    flagStore['trading_halt'] = 'some reason';
    clearTradingHalt();
    expect(isTradingHalted().halted).toBe(false);
    expect(flagStore['trading_halt']).toBeUndefined();
  });
});
