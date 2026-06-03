import { describe, it, expect } from 'vitest';
import { curGlyph, fmtMoney } from './currency';

describe('curGlyph', () => {
  it('returns ₹ for INR', () => expect(curGlyph('INR')).toBe('₹'));
  it('returns $ for USD', () => expect(curGlyph('USD')).toBe('$'));
  it('returns € for EUR', () => expect(curGlyph('EUR')).toBe('€'));
  it('returns £ for GBP', () => expect(curGlyph('GBP')).toBe('£'));
  it('returns empty string for unknown currency', () => expect(curGlyph('XYZ')).toBe(''));
  it('returns empty string for empty string', () => expect(curGlyph('')).toBe(''));
});

describe('fmtMoney', () => {
  it('formats USD value with $ prefix', () => expect(fmtMoney(1234.56, 'USD')).toBe('$1234.56'));
  it('formats INR value with ₹ prefix', () => expect(fmtMoney(2500, 'INR')).toBe('₹2500.00'));
  it('formats EUR with custom decimals', () => expect(fmtMoney(9.9, 'EUR', 1)).toBe('€9.9'));
  it('returns -- for NaN', () => expect(fmtMoney(NaN, 'USD')).toBe('--'));
  it('returns -- for Infinity', () => expect(fmtMoney(Infinity, 'INR')).toBe('--'));
  it('handles unknown currency with no prefix', () => expect(fmtMoney(100, 'XYZ')).toBe('100.00'));
  it('formats negative value correctly', () => expect(fmtMoney(-42.5, 'USD')).toBe('$-42.50'));
});
