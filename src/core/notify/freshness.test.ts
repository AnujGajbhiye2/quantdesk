import { describe, it, expect } from 'vitest';
import { classifyFreshness, worstFreshness } from './freshness';

const NOW = new Date('2025-01-15T22:00:00Z');

describe('classifyFreshness', () => {
  it('fresh: bar is less than threshold minutes old', () => {
    const bar = '2025-01-15T21:00:00Z'; // 60 min ago
    const f   = classifyFreshness(bar, NOW, 1440);
    expect(f.stale).toBe(false);
    expect(f.ageMinutes).toBeCloseTo(60, 0);
    expect(f.label).toMatch(/fresh/);
  });

  it('stale: bar is older than threshold minutes', () => {
    const bar = '2025-01-14T22:00:00Z'; // 24h ago = 1440 min exactly, stale > threshold
    const f   = classifyFreshness(bar, NOW, 1439);
    expect(f.stale).toBe(true);
    expect(f.label).toMatch(/STALE/);
  });

  it('null bar time -> stale with Infinity age', () => {
    const f = classifyFreshness(null, NOW, 1440);
    expect(f.stale).toBe(true);
    expect(f.ageMinutes).toBe(Infinity);
    expect(f.label).toBe('no data');
  });
});

describe('worstFreshness', () => {
  it('returns empty no-data when array is empty', () => {
    const f = worstFreshness([], NOW);
    expect(f.stale).toBe(true);
    expect(f.latestBarTime).toBeNull();
  });

  it('returns the oldest bar across the set', () => {
    const times = [
      '2025-01-15T20:00:00Z', // 2h ago
      '2025-01-14T20:00:00Z', // 26h ago - worst and stale
      '2025-01-15T21:30:00Z', // 30m ago
    ];
    const f = worstFreshness(times, NOW, 1440);
    expect(f.latestBarTime).toBe('2025-01-14T20:00:00Z');
    expect(f.stale).toBe(true);
  });

  it('not stale when all bars are fresh', () => {
    const times = [
      '2025-01-15T21:00:00Z',
      '2025-01-15T21:30:00Z',
    ];
    const f = worstFreshness(times, NOW, 1440);
    expect(f.stale).toBe(false);
  });
});
