import { describe, it, expect } from 'vitest';
import type { Bar } from '@/core/types';
import type { MembershipChange } from '@/core/data/pit-membership';
import { runCrossSectional } from './cross-sectional';

// Synthetic daily bars: `days` consecutive dates from 2024-01-01, close
// following a fixed daily growth rate so momentum ranks are deterministic.
function makeBars(days: number, dailyGrowth: number, startPrice = 100): Bar[] {
  const bars: Bar[] = [];
  const start = new Date('2024-01-01T00:00:00Z');
  let price = startPrice;
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const time = d.toISOString().slice(0, 10);
    bars.push({ time, open: price, high: price * 1.01, low: price * 0.99, close: price, volume: 1000 });
    price *= 1 + dailyGrowth;
  }
  return bars;
}

const DAYS = 40;

// HOT has the strongest momentum, WARM second, COLD flat - so an unfiltered
// top-2 portfolio always wants {HOT, WARM}.
function makeUniverse(): Record<string, Bar[]> {
  return {
    HOT:  makeBars(DAYS, 0.02),
    WARM: makeBars(DAYS, 0.01),
    COLD: makeBars(DAYS, 0.0),
  };
}

const CONFIG = {
  rebalanceDays: 5,
  lookbackBars: 10,
  skipBars: 2,
  topN: 2,
  minNamesToTrade: 1,
  commission: 0,
  slippagePct: 0,
};

function heldSymbols(rebalances: { held: string[] }[]): Set<string> {
  const all = new Set<string>();
  for (const r of rebalances) for (const s of r.held) all.add(s);
  return all;
}

describe('runCrossSectional - point-in-time membership filter', () => {
  it('ranks the full universe when membership is omitted', () => {
    const result = runCrossSectional({ bars: makeUniverse(), ...CONFIG });
    expect(result.rebalances.length).toBeGreaterThan(0);
    const held = heldSymbols(result.rebalances);
    expect(held.has('HOT')).toBe(true);
    expect(held.has('WARM')).toBe(true);
  });

  it('never holds a symbol that was removed from the index before the run', () => {
    // HOT was dropped from the index on day 1 of history - despite having the
    // best momentum, it must never be ranked or held.
    const changes: MembershipChange[] = [
      { effectiveDate: '2024-01-02', symbol: 'HOT', action: 'removed' },
    ];
    const result = runCrossSectional({
      bars: makeUniverse(),
      ...CONFIG,
      membership: { currentMembers: ['WARM', 'COLD'], changes },
    });
    expect(result.rebalances.length).toBeGreaterThan(0);
    const held = heldSymbols(result.rebalances);
    expect(held.has('HOT')).toBe(false);
    expect(held.has('WARM')).toBe(true);
    expect(held.has('COLD')).toBe(true); // top-2 falls back to the members
    for (const t of result.trades) expect(t.symbol).not.toBe('HOT');
  });

  it('excludes a symbol only before its addition date', () => {
    // HOT joins the index mid-history: rebalances before the addition date
    // must not rank it; later rebalances must pick it up (best momentum).
    const additionDate = makeBars(DAYS, 0)[25].time;
    const changes: MembershipChange[] = [
      { effectiveDate: additionDate, symbol: 'HOT', action: 'added' },
    ];
    const result = runCrossSectional({
      bars: makeUniverse(),
      ...CONFIG,
      membership: { currentMembers: ['HOT', 'WARM', 'COLD'], changes },
    });
    const before = result.rebalances.filter((r) => r.date < additionDate);
    const after  = result.rebalances.filter((r) => r.date >= additionDate);
    expect(before.length).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(0);
    for (const r of before) expect(r.held).not.toContain('HOT');
    expect(after.some((r) => r.held.includes('HOT'))).toBe(true);
  });

  it('closes a held name once it drops out of the index', () => {
    // HOT is a member at the first rebalances, then removed mid-history -
    // the portfolio must sell it at the first rebalance after removal.
    const removalDate = makeBars(DAYS, 0)[25].time;
    const changes: MembershipChange[] = [
      { effectiveDate: removalDate, symbol: 'HOT', action: 'removed' },
    ];
    const result = runCrossSectional({
      bars: makeUniverse(),
      ...CONFIG,
      membership: { currentMembers: ['WARM', 'COLD'], changes },
    });
    const before = result.rebalances.filter((r) => r.date < removalDate);
    const after  = result.rebalances.filter((r) => r.date >= removalDate);
    expect(before.some((r) => r.held.includes('HOT'))).toBe(true);
    for (const r of after) expect(r.held).not.toContain('HOT');
  });
});
