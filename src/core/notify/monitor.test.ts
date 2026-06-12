import { describe, it, expect } from 'vitest';
import { checkLevel, decideAlert } from './monitor';

describe('checkLevel', () => {
  it('long target hit from below', () => {
    expect(checkLevel('long', 'target', 110, 110).hit).toBe(true);
    expect(checkLevel('long', 'target', 110, 112).hit).toBe(true);
    expect(checkLevel('long', 'target', 110, 109).hit).toBe(false);
  });

  it('long stop hit from above', () => {
    expect(checkLevel('long', 'stop', 95, 95).hit).toBe(true);
    expect(checkLevel('long', 'stop', 95, 94).hit).toBe(true);
    expect(checkLevel('long', 'stop', 95, 96).hit).toBe(false);
  });

  it('short target hit from above, stop from below', () => {
    expect(checkLevel('short', 'target', 90, 89).hit).toBe(true);
    expect(checkLevel('short', 'target', 90, 91).hit).toBe(false);
    expect(checkLevel('short', 'stop', 105, 106).hit).toBe(true);
    expect(checkLevel('short', 'stop', 105, 104).hit).toBe(false);
  });

  it('distance is % of the level price', () => {
    // price 108, target 110 -> 2/110 = 1.818%
    expect(checkLevel('long', 'target', 110, 108).distancePct).toBeCloseTo(1.818, 2);
    expect(checkLevel('long', 'stop', 100, 103).distancePct).toBeCloseTo(3, 5);
  });
});

describe('decideAlert', () => {
  const prox = 2;

  it('sends once on entering the proximity band', () => {
    const near = { distancePct: 1.5, hit: false };
    expect(decideAlert(null, near, prox)).toEqual({ nextState: 'near', send: true });
    // second tick still near - no resend
    expect(decideAlert('near', near, prox)).toEqual({ nextState: 'near', send: false });
  });

  it('sends once on hit, even from near', () => {
    const hit = { distancePct: 0.2, hit: true };
    expect(decideAlert(null, hit, prox)).toEqual({ nextState: 'hit', send: true });
    expect(decideAlert('near', hit, prox)).toEqual({ nextState: 'hit', send: true });
    expect(decideAlert('hit', hit, prox)).toEqual({ nextState: 'hit', send: false });
  });

  it('hit falling back inside the band does not re-alert as near', () => {
    const near = { distancePct: 1.0, hit: false };
    expect(decideAlert('hit', near, prox)).toEqual({ nextState: 'hit', send: false });
  });

  it('re-arms only past proximity * 1.5 (hysteresis)', () => {
    // 2.5% away: outside band but inside hysteresis - stays armed-silent
    expect(decideAlert('near', { distancePct: 2.5, hit: false }, prox))
      .toEqual({ nextState: 'near', send: false });
    // 3.5% away: beyond 2 * 1.5 = 3 - re-armed
    expect(decideAlert('near', { distancePct: 3.5, hit: false }, prox))
      .toEqual({ nextState: null, send: false });
    // and a fresh approach alerts again
    expect(decideAlert(null, { distancePct: 1.9, hit: false }, prox))
      .toEqual({ nextState: 'near', send: true });
  });

  it('far price with no prior state stays silent', () => {
    expect(decideAlert(null, { distancePct: 10, hit: false }, prox))
      .toEqual({ nextState: null, send: false });
  });
});
