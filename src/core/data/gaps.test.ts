import { describe, it, expect } from 'vitest';
import { detectGapsForGroup, detectGapsAcrossGroups, totalGapCount, type SymbolBarDates } from './gaps';

function group(entries: Record<string, string[]>): SymbolBarDates[] {
  return Object.entries(entries).map(([symbol, dates]) => ({ symbol, dates }));
}

describe('detectGapsForGroup', () => {
  it('flags a symbol missing a date that the rest of its peers traded', () => {
    const g = group({
      A: ['2024-01-01', '2024-01-02', '2024-01-03'],
      B: ['2024-01-01', '2024-01-02', '2024-01-03'],
      C: ['2024-01-01', '2024-01-02', '2024-01-03'],
      D: ['2024-01-01', '2024-01-02', '2024-01-03'],
      E: ['2024-01-01',              '2024-01-03'], // missing 01-02
    });
    const result = detectGapsForGroup('test-exchange', g);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].symbol).toBe('E');
    expect(result.gaps[0].missingDates).toEqual(['2024-01-02']);
  });

  it('does not flag a date the whole market skipped (holiday) - no peer traded it either', () => {
    const g = group({
      A: ['2024-01-01', '2024-01-03'],
      B: ['2024-01-01', '2024-01-03'],
      C: ['2024-01-01', '2024-01-03'],
      D: ['2024-01-01', '2024-01-03'],
      E: ['2024-01-01', '2024-01-03'],
    });
    const result = detectGapsForGroup('test-exchange', g);
    expect(result.gaps).toHaveLength(0);
    expect(result.referenceCalendarSize).toBe(2);
  });

  it('does not flag dates before a symbol was first listed', () => {
    const g = group({
      A: ['2024-01-01', '2024-01-02', '2024-01-03'],
      B: ['2024-01-01', '2024-01-02', '2024-01-03'],
      C: ['2024-01-01', '2024-01-02', '2024-01-03'],
      D: ['2024-01-01', '2024-01-02', '2024-01-03'],
      E: [/* newly listed */              '2024-01-03'],
    });
    const result = detectGapsForGroup('test-exchange', g);
    expect(result.gaps).toHaveLength(0);
  });

  it('skips groups below minGroupSize (peer consensus too noisy to trust)', () => {
    const g = group({
      A: ['2024-01-01', '2024-01-02'],
      B: ['2024-01-01'],
    });
    const result = detectGapsForGroup('tiny-group', g, 0.6, 5);
    expect(result.gaps).toHaveLength(0);
    expect(result.referenceCalendarSize).toBe(0);
  });

  it('respects minPeerCoveragePct - a date only 2/5 symbols have is not a reference date', () => {
    const g = group({
      A: ['2024-01-01', '2024-01-02'],
      B: ['2024-01-01', '2024-01-02'],
      C: ['2024-01-01'],
      D: ['2024-01-01'],
      E: ['2024-01-01'],
    });
    // 01-02 covered by only 2/5 (40%) < 60% threshold -> not part of reference calendar
    const result = detectGapsForGroup('test-exchange', g, 0.6, 5);
    expect(result.referenceCalendarSize).toBe(1);
    expect(result.gaps).toHaveLength(0);
  });

  it('sorts gaps with the most-missing symbol first', () => {
    const g = group({
      A: ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04'],
      B: ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04'],
      C: ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04'],
      D: ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04'],
      E: ['2024-01-01'],                                          // missing 3
      F: ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04'],
      G: ['2024-01-01', '2024-01-04'],                            // missing 2
    });
    const result = detectGapsForGroup('test-exchange', g);
    expect(result.gaps[0].symbol).toBe('E');
    expect(result.gaps[1].symbol).toBe('G');
  });
});

describe('detectGapsAcrossGroups / totalGapCount', () => {
  it('aggregates gap counts across multiple exchange groups', () => {
    const groups = new Map<string, SymbolBarDates[]>([
      ['NYSE', group({
        A: ['2024-01-01', '2024-01-02'],
        B: ['2024-01-01', '2024-01-02'],
        C: ['2024-01-01', '2024-01-02'],
        D: ['2024-01-01', '2024-01-02'],
        E: ['2024-01-01'], // 1 gap
      })],
      ['NSE', group({
        F: ['2024-01-01', '2024-01-02'],
        G: ['2024-01-01', '2024-01-02'],
        H: ['2024-01-01', '2024-01-02'],
        I: ['2024-01-01', '2024-01-02'],
        J: [], // no bars at all - skipped, not a gap
      })],
    ]);
    const results = detectGapsAcrossGroups(groups);
    expect(totalGapCount(results)).toBe(1);
  });
});
