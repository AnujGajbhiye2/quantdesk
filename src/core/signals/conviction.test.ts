import { describe, it, expect } from 'vitest';
import { computeConviction, type ConvictionInputs } from './conviction';

function inputs(overrides: Partial<ConvictionInputs> = {}): ConvictionInputs {
  return {
    edgeScore: null,
    edgeTrades: null,
    consensusStrength: null,
    rr: null,
    hitRate: null,
    regimeAligned: null,
    ...overrides,
  };
}

describe('computeConviction', () => {
  it('all unknown -> neutral 50, MODERATE', () => {
    const c = computeConviction(inputs());
    expect(c.score).toBe(50);
    expect(c.band).toBe('MODERATE');
  });

  it('everything perfect -> 100 STRONG', () => {
    const c = computeConviction(inputs({
      edgeScore: 1, edgeTrades: 100,
      consensusStrength: 1,
      rr: 3,
      hitRate: 1,
      regimeAligned: true,
    }));
    expect(c.score).toBe(100);
    expect(c.band).toBe('STRONG');
  });

  it('everything terrible -> 0 WEAK', () => {
    const c = computeConviction(inputs({
      edgeScore: 0, edgeTrades: 100,
      consensusStrength: 0,
      rr: 1,
      hitRate: 0,
      regimeAligned: false,
    }));
    expect(c.score).toBe(0);
    expect(c.band).toBe('WEAK');
  });

  it('thin edge sample is discounted toward neutral', () => {
    const fat  = computeConviction(inputs({ edgeScore: 1, edgeTrades: 50 }));
    const thin = computeConviction(inputs({ edgeScore: 1, edgeTrades: 5 }));
    expect(thin.score).toBeLessThan(fat.score);
    const thinEdge = thin.components.find((c) => c.key === 'edge')!;
    expect(thinEdge.value).toBeCloseTo(0.75, 5); // 1*0.5 + 0.5*0.5
    expect(thinEdge.detail).toContain('discounted');
  });

  it('rr maps 1->0, 2->0.5, 3->1 and clamps beyond', () => {
    const at = (rr: number) =>
      computeConviction(inputs({ rr })).components.find((c) => c.key === 'rr')!.value;
    expect(at(1)).toBe(0);
    expect(at(2)).toBeCloseTo(0.5, 5);
    expect(at(3)).toBe(1);
    expect(at(10)).toBe(1);
  });

  it('regime against the trade hurts more than unknown', () => {
    const unknown = computeConviction(inputs({ regimeAligned: null }));
    const against = computeConviction(inputs({ regimeAligned: false }));
    expect(against.score).toBeLessThan(unknown.score);
  });

  it('weights sum to 100 and components always returned', () => {
    const c = computeConviction(inputs());
    expect(c.components.reduce((s, x) => s + x.weight, 0)).toBe(100);
    expect(c.components).toHaveLength(5);
  });

  it('band boundaries: >=70 STRONG, >=45 MODERATE, else WEAK', () => {
    // neutral base 50 + rr(15) + hitRate(15) lifts to 65 -> still MODERATE
    expect(computeConviction(inputs({ rr: 3, hitRate: 1 })).score).toBe(65);
    expect(computeConviction(inputs({ rr: 3, hitRate: 1 })).band).toBe('MODERATE');
    // + consensus(20 -> +10 over neutral) = 75 -> STRONG
    expect(computeConviction(inputs({ rr: 3, hitRate: 1, consensusStrength: 1 })).band).toBe('STRONG');
    // bad edge with fat sample drags neutral 50 down by 20 -> 30 -> WEAK
    expect(computeConviction(inputs({ edgeScore: 0, edgeTrades: 50 })).band).toBe('WEAK');
  });
});
