/**
 * Currency formatting utilities.
 * Maps ISO 4217 currency codes to display glyphs and formats monetary values.
 */

const GLYPH: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
  AUD: 'A$',
  CAD: 'C$',
  CHF: 'Fr',
  SEK: 'kr',
  NOK: 'kr',
  DKK: 'kr',
  PLN: 'zł',
  HUF: 'Ft',
  CZK: 'Kč',
};

/** Returns the currency glyph (₹, $, €, ...) for a given ISO currency code. */
export function curGlyph(currency: string): string {
  return GLYPH[currency] ?? '';
}

/**
 * Format a number as a monetary string prefixed with the currency glyph.
 * Returns '--' for non-finite values.
 */
export function fmtMoney(n: number, currency: string, dec = 2): string {
  return isFinite(n) ? `${curGlyph(currency)}${n.toFixed(dec)}` : '--';
}
