import { describe, it, expect } from 'vitest';
import { edgeScore, tierOpacity, type EdgeScoreInput } from './score';

function input(winRate: number, profitFactor: number, numTrades: number): EdgeScoreInput {
  return { winRate, profitFactor, numTrades };
}

describe('edgeScore', () => {
  it('returns unknown for null input', () => {
    expect(edgeScore(null)).toEqual({ score: 0, tier: 'unknown' });
  });

  it('returns unknown below 5 trades regardless of stats', () => {
    expect(edgeScore(input(0.9, 5, 4)).tier).toBe('unknown');
    expect(edgeScore(input(0.9, 5, 0)).tier).toBe('unknown');
  });

  it('spec weak case: 35% win rate, PF 0.8 scores 0 and is weak', () => {
    const r = edgeScore(input(0.35, 0.8, 47));
    expect(r.score).toBe(0);
    expect(r.tier).toBe('weak');
  });

  it('spec strong case: 58% win rate, PF 1.6, 47 trades is strong', () => {
    const r = edgeScore(input(0.58, 1.6, 47));
    expect(r.tier).toBe('strong');
    expect(r.score).toBeGreaterThanOrEqual(0.65);
  });

  it('PF below 1 forces weak even with a high win rate', () => {
    const r = edgeScore(input(0.65, 0.95, 100));
    expect(r.tier).toBe('weak');
  });

  it('PF 9999 sentinel with small sample is confidence-damped, not strong', () => {
    // 10 trades, all winners: confidence 10/30 caps the score
    const r = edgeScore(input(1, 9999, 10));
    expect(r.score).toBeLessThan(0.65);
    expect(r.tier).not.toBe('strong');
  });

  it('PF 9999 sentinel with 5 trades stays well below strong', () => {
    const r = edgeScore(input(1, 9999, 5));
    expect(r.score).toBeCloseTo(1 / 6, 10); // (0.5 + 0.5) * 5/30
    expect(r.tier).toBe('weak');
  });

  it('is monotonic in win rate', () => {
    const lo = edgeScore(input(0.45, 1.4, 30)).score;
    const hi = edgeScore(input(0.55, 1.4, 30)).score;
    expect(hi).toBeGreaterThan(lo);
  });

  it('is monotonic in trade count up to the confidence cap', () => {
    const lo = edgeScore(input(0.55, 1.5, 10)).score;
    const mid = edgeScore(input(0.55, 1.5, 20)).score;
    const hi = edgeScore(input(0.55, 1.5, 30)).score;
    const beyond = edgeScore(input(0.55, 1.5, 300)).score;
    expect(mid).toBeGreaterThan(lo);
    expect(hi).toBeGreaterThan(mid);
    expect(beyond).toBe(hi); // capped at 30
  });
});

describe('tierOpacity', () => {
  it('maps tiers to visual weight', () => {
    expect(tierOpacity('strong')).toBe(1.0);
    expect(tierOpacity('moderate')).toBe(0.75);
    expect(tierOpacity('weak')).toBe(0.45);
    expect(tierOpacity('unknown')).toBe(0.45);
  });
});
