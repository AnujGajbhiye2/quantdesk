import { describe, it, expect } from 'vitest';
import {
  buildEntryAlert,
  buildExitAlert,
  buildRotationAlert,
  buildScanDigest,
  strategyName,
  marketName,
} from './format';

describe('strategyName / marketName', () => {
  it('maps known strategy ids to readable names', () => {
    expect(strategyName('rsi-reversion')).toBe('RSI reversion');
    expect(strategyName('bollinger-reversion')).toBe('Bollinger reversion');
    expect(strategyName('stoch-reversal')).toBe('Stochastic reversal');
  });

  it('falls back to the raw id for unknown strategies', () => {
    expect(strategyName('made-up-strategy')).toBe('made-up-strategy');
  });

  it('maps known market buckets to readable labels', () => {
    expect(marketName('sp500')).toBe('US');
    expect(marketName('nse')).toBe('India');
    expect(marketName('eu')).toBe('Europe');
  });

  it('falls back to uppercased id for unknown markets', () => {
    expect(marketName('foo')).toBe('FOO');
  });
});

describe('buildEntryAlert', () => {
  const base = {
    market:      'sp500',
    symbol:      'CTSH',
    side:        'long' as const,
    currency:    'USD',
    entryPrice:  40.44,
    stopPrice:   35.87,
    targetPrice: 47.27,
    qty:         22.1189,
    riskAmount:  100.69,
    riskPct:     0.015,
    rr:          1.5,
    agreeCount:  2,
    totalStrats: 3,
    strategyIds: ['rsi-reversion', 'stoch-reversal'],
    live:        true,
  };

  it('labels a live fill as ENTRY, not INTENDED', () => {
    const text = buildEntryAlert(base);
    expect(text).toContain('ENTRY');
    expect(text).not.toContain('INTENDED');
  });

  it('labels a dry-run fill as INTENDED', () => {
    const text = buildEntryAlert({ ...base, live: false });
    expect(text).toContain('INTENDED ENTRY');
  });

  it('includes readable strategy names and market label', () => {
    const text = buildEntryAlert(base);
    expect(text).toContain('RSI reversion');
    expect(text).toContain('Stochastic reversal');
    expect(text).toContain('US');
    expect(text).toContain('CTSH');
  });

  it('includes qty, risk, and R:R', () => {
    const text = buildEntryAlert(base);
    expect(text).toContain('22.1189');
    expect(text).toContain('$100.69');
    expect(text).toContain('1.50');
  });

  it('escapes HTML-sensitive characters in the symbol', () => {
    const text = buildEntryAlert({ ...base, symbol: 'A&B' });
    expect(text).toContain('A&amp;B');
    expect(text).not.toContain('A&B<');
  });
});

describe('buildExitAlert', () => {
  it('marks a profitable stop/target exit with a checkmark', () => {
    const text = buildExitAlert({
      market: 'sp500', symbol: 'NDAQ', side: 'long', currency: 'USD',
      action: 'targeted', exitPrice: 85.89, pnl: 21.64, pnlPct: 1.53,
    });
    expect(text).toContain('TARGET HIT');
    expect(text).toContain('✅');
    expect(text).toContain('+$21.64');
    expect(text).toContain('1.53%');
  });

  it('marks a losing stop exit with a cross', () => {
    const text = buildExitAlert({
      market: 'sp500', symbol: 'CME', side: 'long', currency: 'USD',
      action: 'stopped', exitPrice: 208.67, pnl: -26.06, pnlPct: -1.9,
    });
    expect(text).toContain('STOP HIT');
    expect(text).toContain('❌');
    expect(text).toContain('$-26.06');
  });

  it('does not double the pnlPct (pnlPct is already a percentage)', () => {
    const text = buildExitAlert({
      market: 'sp500', symbol: 'FOXA', side: 'long', currency: 'USD',
      action: 'targeted', exitPrice: 56.15, pnl: 67.67, pnlPct: 6.71,
    });
    // Should read 6.71%, never 671.00% (a pre-existing bug this replaces).
    expect(text).toContain('6.71%');
    expect(text).not.toContain('671');
  });
});

describe('buildRotationAlert', () => {
  it('names both the closed and opened symbols with conviction', () => {
    const text = buildRotationAlert({
      market: 'sp500', closedSymbol: 'T', closedPnlPct: 0.3, closedAgree: 2,
      openedSymbol: 'CTSH', openedAgree: 3, totalStrats: 3,
    });
    expect(text).toContain('ROTATION');
    expect(text).toContain('T');
    expect(text).toContain('CTSH');
    expect(text).toContain('2/3');
    expect(text).toContain('3/3');
  });
});

describe('buildScanDigest', () => {
  it('summarizes counts and lists opened/closed/rotated symbols', () => {
    const text = buildScanDigest({
      market: 'nse', runLabel: 'EOD scan', scanned: 41, signals: 12,
      entries: 2, exits: 1, rotations: 1, skips: 3,
      openedSymbols: ['ASTRAL.NS', 'ONGC.NS'], closedSymbols: ['LTM.NS'],
      rotatedOutSymbols: ['T'], halted: false, dryRun: false,
    });
    expect(text).toContain('India');
    expect(text).toContain('Entries 2');
    expect(text).toContain('Rotations 1');
    expect(text).toContain('ASTRAL.NS, ONGC.NS');
    expect(text).toContain('Rotated out: T');
  });

  it('shows the halt reason and omits it when not halted', () => {
    const halted = buildScanDigest({
      market: 'eu', signals: 0, entries: 0, exits: 0, rotations: 0, skips: 0,
      openedSymbols: [], closedSymbols: [], rotatedOutSymbols: [],
      halted: true, haltReason: 'Daily loss halt', dryRun: false,
    });
    expect(halted).toContain('HALTED');
    expect(halted).toContain('Daily loss halt');

    const clear = buildScanDigest({
      market: 'eu', signals: 0, entries: 0, exits: 0, rotations: 0, skips: 0,
      openedSymbols: [], closedSymbols: [], rotatedOutSymbols: [],
      halted: false, dryRun: false,
    });
    expect(clear).not.toContain('HALTED');
  });

  it('flags dry-run runs', () => {
    const text = buildScanDigest({
      market: 'sp500', signals: 0, entries: 0, exits: 0, rotations: 0, skips: 0,
      openedSymbols: [], closedSymbols: [], rotatedOutSymbols: [],
      halted: false, dryRun: true,
    });
    expect(text).toContain('DRY RUN');
  });
});
