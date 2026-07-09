import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { costModelFromEnv, fillFees, roundTripCosts, type CostModel } from './costs';

const REALISTIC: CostModel = {
  commissionPerFill: 0,
  secFeeRate: 0.0000278,
  tafPerShare: 0.000166,
  tafCap: 8.3,
};

const ENV_KEYS = ['COMMISSION_PER_FILL', 'SEC_FEE_RATE', 'TAF_FEE_PER_SHARE', 'TAF_FEE_CAP'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('costModelFromEnv', () => {
  it('defaults to zero fees with env unset (existing evidence reproducible)', () => {
    const m = costModelFromEnv();
    expect(m.commissionPerFill).toBe(0);
    expect(m.secFeeRate).toBe(0);
    expect(m.tafPerShare).toBe(0);
  });

  it('reads fee envs', () => {
    process.env.SEC_FEE_RATE = '0.0000278';
    process.env.TAF_FEE_PER_SHARE = '0.000166';
    process.env.TAF_FEE_CAP = '8.30';
    process.env.COMMISSION_PER_FILL = '1';
    const m = costModelFromEnv();
    expect(m.secFeeRate).toBeCloseTo(0.0000278, 10);
    expect(m.tafPerShare).toBeCloseTo(0.000166, 10);
    expect(m.tafCap).toBeCloseTo(8.3, 10);
    expect(m.commissionPerFill).toBe(1);
  });

  it('ignores negative/garbage values', () => {
    process.env.SEC_FEE_RATE = '-1';
    process.env.TAF_FEE_PER_SHARE = 'abc';
    const m = costModelFromEnv();
    expect(m.secFeeRate).toBe(0);
    expect(m.tafPerShare).toBe(0);
  });
});

describe('fillFees', () => {
  it('buys pay commission only', () => {
    expect(fillFees(REALISTIC, 'buy', 100, 50)).toBe(0);
    expect(fillFees({ ...REALISTIC, commissionPerFill: 1 }, 'buy', 100, 50)).toBe(1);
  });

  it('sells pay SEC fee on proceeds + TAF per share', () => {
    // 100 shares at $50: proceeds 5000 -> SEC 5000*0.0000278 = 0.139;
    // TAF 100*0.000166 = 0.0166
    const fees = fillFees(REALISTIC, 'sell', 100, 50);
    expect(fees).toBeCloseTo(0.139 + 0.0166, 6);
  });

  it('caps TAF per trade', () => {
    // 100k shares: TAF uncapped = 16.6 -> capped at 8.30
    const fees = fillFees(REALISTIC, 'sell', 100_000, 10);
    const sec  = 100_000 * 10 * REALISTIC.secFeeRate;
    expect(fees).toBeCloseTo(sec + 8.3, 6);
  });
});

describe('roundTripCosts', () => {
  it('long pays sell fees on the exit leg', () => {
    const costs = roundTripCosts(REALISTIC, 'long', 100, 110, 10);
    expect(costs).toBeCloseTo(fillFees(REALISTIC, 'sell', 10, 110), 10);
  });

  it('short pays sell fees on the entry leg', () => {
    const costs = roundTripCosts(REALISTIC, 'short', 100, 90, 10);
    expect(costs).toBeCloseTo(fillFees(REALISTIC, 'sell', 10, 100), 10);
  });

  it('is zero with the all-zero model', () => {
    const zero: CostModel = { commissionPerFill: 0, secFeeRate: 0, tafPerShare: 0, tafCap: 8.3 };
    expect(roundTripCosts(zero, 'long', 100, 110, 10)).toBe(0);
  });
});
