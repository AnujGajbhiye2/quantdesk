import { describe, it, expect } from 'vitest';
import {
  entryFillPrice,
  exitFillPrice,
  stopTargetPrices,
  realizedPnl,
  markToMarket,
  qtyForCash,
} from './fills';

const SLIP = 0.01; // 1% for legible arithmetic

describe('entryFillPrice', () => {
  it('long: fills above market (adverse buyer)', () => {
    expect(entryFillPrice('long',  100, SLIP)).toBeCloseTo(101, 8);
  });
  it('short: fills below market (adverse seller)', () => {
    expect(entryFillPrice('short', 100, SLIP)).toBeCloseTo(99, 8);
  });
  it('zero slippage: fill equals raw price', () => {
    expect(entryFillPrice('long',  200, 0)).toBe(200);
    expect(entryFillPrice('short', 200, 0)).toBe(200);
  });
});

describe('exitFillPrice', () => {
  it('long exit: fills below market (adverse seller)', () => {
    expect(exitFillPrice('long',  100, SLIP)).toBeCloseTo(99, 8);
  });
  it('short cover: fills above market (adverse buyer)', () => {
    expect(exitFillPrice('short', 100, SLIP)).toBeCloseTo(101, 8);
  });
  it('zero slippage: fill equals raw price', () => {
    expect(exitFillPrice('long',  200, 0)).toBe(200);
    expect(exitFillPrice('short', 200, 0)).toBe(200);
  });
});

describe('stopTargetPrices', () => {
  it('long: stop below entry, target above', () => {
    const { stopPrice, targetPrice } = stopTargetPrices('long', 100, 0.05, 0.10);
    expect(stopPrice).toBeCloseTo(95,  8);
    expect(targetPrice).toBeCloseTo(110, 8);
  });
  it('short: stop above entry, target below', () => {
    const { stopPrice, targetPrice } = stopTargetPrices('short', 100, 0.05, 0.10);
    expect(stopPrice).toBeCloseTo(105, 8);
    expect(targetPrice).toBeCloseTo(90,  8);
  });
  it('undefined when pct not provided', () => {
    const { stopPrice, targetPrice } = stopTargetPrices('long', 100);
    expect(stopPrice).toBeUndefined();
    expect(targetPrice).toBeUndefined();
  });
});

describe('realizedPnl', () => {
  it('long win: profit when exit > entry', () => {
    const { pnl, costs } = realizedPnl('long', 100, 120, 10, 5);
    // gross = (120-100)*10 = 200; costs = 2*5 = 10; net = 190
    expect(costs).toBe(10);
    expect(pnl).toBeCloseTo(190, 8);
  });
  it('long loss: loss when exit < entry', () => {
    const { pnl } = realizedPnl('long', 100, 90, 10, 0);
    expect(pnl).toBeCloseTo(-100, 8);
  });
  it('short win: profit when exit < entry', () => {
    const { pnl, costs } = realizedPnl('short', 100, 80, 10, 5);
    // gross = (100-80)*10 = 200; costs = 10; net = 190
    expect(costs).toBe(10);
    expect(pnl).toBeCloseTo(190, 8);
  });
  it('short loss: loss when exit > entry', () => {
    const { pnl } = realizedPnl('short', 100, 110, 10, 0);
    expect(pnl).toBeCloseTo(-100, 8);
  });
  it('zero commission: costs = 0', () => {
    const { costs } = realizedPnl('long', 100, 100, 10, 0);
    expect(costs).toBe(0);
  });
});

describe('markToMarket', () => {
  it('long: cash + qty * close', () => {
    expect(markToMarket('long',  500, 10, 120)).toBeCloseTo(1700, 8);
  });
  it('short: cash - qty * close', () => {
    expect(markToMarket('short', 1000, 10, 80)).toBeCloseTo(200, 8);
  });
});

describe('qtyForCash', () => {
  it('full allocation', () => {
    expect(qtyForCash(1000, 1, 100)).toBeCloseTo(10, 8);
  });
  it('half allocation', () => {
    expect(qtyForCash(1000, 0.5, 100)).toBeCloseTo(5, 8);
  });
  it('fractional fill price', () => {
    expect(qtyForCash(1000, 1, 33.33)).toBeCloseTo(30.003, 2);
  });
});
