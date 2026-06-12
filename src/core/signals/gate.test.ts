import { describe, it, expect } from 'vitest';
import {
  gateIdea,
  GATE_MIN_RR,
  GATE_MIN_CLASS_WIN_RATE,
  GATE_MIN_TRADES,
  type GateContext,
} from './gate';

function ctx(over: Partial<GateContext> = {}): GateContext {
  return {
    rr: 2.0,
    classEdge: { winRate: 0.55, numTrades: 100 },
    assetClass: 'equity',
    ...over,
  };
}

describe('gateIdea', () => {
  it('passes a healthy idea', () => {
    expect(gateIdea(ctx())).toEqual({ passed: true, reason: null });
  });

  it('R:R boundary: 1.49 fails, exactly 1.5 passes', () => {
    expect(gateIdea(ctx({ rr: 1.49 })).passed).toBe(false);
    expect(gateIdea(ctx({ rr: 1.49 })).reason).toBe('R:R 1.49 < 1.5');
    expect(gateIdea(ctx({ rr: GATE_MIN_RR })).passed).toBe(true);
  });

  it('fails with a reason when class edge is missing entirely', () => {
    const g = gateIdea(ctx({ classEdge: null }));
    expect(g.passed).toBe(false);
    expect(g.reason).toBe(`only 0 closed trades on equity record (< ${GATE_MIN_TRADES})`);
  });

  it('trade-count boundary: 14 fails, 15 passes', () => {
    expect(gateIdea(ctx({ classEdge: { winRate: 0.55, numTrades: 14 } })).passed).toBe(false);
    expect(gateIdea(ctx({ classEdge: { winRate: 0.55, numTrades: 15 } })).passed).toBe(true);
  });

  it('win-rate boundary: 39% fails, 40% passes', () => {
    const fail = gateIdea(ctx({ classEdge: { winRate: 0.39, numTrades: 100 } }));
    expect(fail.passed).toBe(false);
    expect(fail.reason).toBe('win rate 39% on equity < 40%');
    expect(
      gateIdea(ctx({ classEdge: { winRate: GATE_MIN_CLASS_WIN_RATE, numTrades: 100 } })).passed,
    ).toBe(true);
  });

  it('rule precedence: R:R failure reported even when win rate is also bad', () => {
    const g = gateIdea(ctx({ rr: 1.0, classEdge: { winRate: 0.2, numTrades: 5 } }));
    expect(g.reason).toBe('R:R 1.00 < 1.5');
  });

  it('trade-count failure reported before win rate (protects the estimate)', () => {
    const g = gateIdea(ctx({ classEdge: { winRate: 0.1, numTrades: 5 } }));
    expect(g.reason).toBe(`only 5 closed trades on equity record (< ${GATE_MIN_TRADES})`);
  });

  it('uses a generic label when asset class is unknown', () => {
    const g = gateIdea(ctx({ classEdge: null, assetClass: null }));
    expect(g.reason).toContain('asset class record');
  });
});
