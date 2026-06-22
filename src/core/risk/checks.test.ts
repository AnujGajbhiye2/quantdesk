import { describe, it, expect } from 'vitest';
import {
  checkRisk,
  positionRiskUSD,
  riskLimitsFromEnv,
  DEFAULT_RISK_LIMITS,
  type OpenPositionUSD,
} from './checks';

const account = { startingBalance: 1000, equity: 1000 };

function pos(costUSD: number, stopRiskUSD: number | null = null): OpenPositionUSD {
  return { symbol: 'X', costUSD, stopRiskUSD };
}

describe('checkRisk', () => {
  it('passes a sane trade', () => {
    const result = checkRisk(account, [], { symbol: 'A', costUSD: 100, stopRiskUSD: 10 });
    expect(result.ok).toBe(true);
  });

  it('drawdown halt blocks everything once equity falls past the limit', () => {
    const result = checkRisk(
      { startingBalance: 1000, equity: 879 }, // 12.1% down, limit 12%
      [],
      { symbol: 'A', costUSD: 10, stopRiskUSD: 1 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rule).toBe('drawdown-halt');
  });

  it('drawdown just inside the limit still trades', () => {
    const result = checkRisk(
      { startingBalance: 1000, equity: 881 }, // 11.9% down, just inside 12% limit
      [],
      { symbol: 'A', costUSD: 10, stopRiskUSD: 1 },
    );
    expect(result.ok).toBe(true);
  });

  it('rejects position over the concentration limit', () => {
    // 25% of 1000 = 250
    const result = checkRisk(account, [], { symbol: 'A', costUSD: 251, stopRiskUSD: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rule).toBe('position-concentration');
  });

  it('rejects when total open risk would exceed the cap', () => {
    // cap 6% of 1000 = 60; open trades already risk 50
    const open = [pos(200, 30), pos(200, 20)];
    const result = checkRisk(account, open, { symbol: 'A', costUSD: 100, stopRiskUSD: 15 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rule).toBe('total-open-risk');
  });

  it('stop-less positions count at FULL notional toward open risk', () => {
    expect(positionRiskUSD(pos(100, null))).toBe(100);
    // one stop-less 55 position alone busts the 6% = 60 cap with a 10-risk candidate
    const result = checkRisk(account, [pos(55, null)], { symbol: 'A', costUSD: 50, stopRiskUSD: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rule).toBe('total-open-risk');
  });

  it('rejects past the max open trade count', () => {
    const open = Array.from({ length: 8 }, () => pos(10, 1));
    const result = checkRisk(account, open, { symbol: 'A', costUSD: 10, stopRiskUSD: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rule).toBe('max-open-trades');
  });

  it('rule precedence: drawdown halt wins over everything else', () => {
    const open = Array.from({ length: 9 }, () => pos(10, 1));
    const result = checkRisk(
      { startingBalance: 1000, equity: 700 },
      open,
      { symbol: 'A', costUSD: 999, stopRiskUSD: 500 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rule).toBe('drawdown-halt');
  });
});

describe('riskLimitsFromEnv', () => {
  it('falls back to defaults on missing or junk values', () => {
    expect(riskLimitsFromEnv({} as NodeJS.ProcessEnv)).toEqual(DEFAULT_RISK_LIMITS);
    expect(
      riskLimitsFromEnv({ RISK_MAX_POSITION_PCT: 'banana' } as unknown as NodeJS.ProcessEnv).maxPositionPct,
    ).toBe(DEFAULT_RISK_LIMITS.maxPositionPct);
  });

  it('reads valid overrides', () => {
    const limits = riskLimitsFromEnv({
      RISK_MAX_POSITION_PCT: '10',
      RISK_MAX_OPEN_TRADES: '3',
    } as unknown as NodeJS.ProcessEnv);
    expect(limits.maxPositionPct).toBe(10);
    expect(limits.maxOpenTrades).toBe(3);
    expect(limits.maxOpenRiskPct).toBe(DEFAULT_RISK_LIMITS.maxOpenRiskPct);
  });
});
