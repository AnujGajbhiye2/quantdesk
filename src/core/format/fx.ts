/**
 * Static FX conversion for the paper-trading account (account currency: USD).
 *
 * Rates are env-configurable approximations refreshed by hand, NOT live FX -
 * good enough to make a mixed USD/INR/EUR paper book roughly comparable.
 * Surfaced as a limitation in the account UI tooltip.
 *
 * NOTE: London (.L) symbols on Yahoo Finance quote in pence (GBp = 1/100 GBP),
 * not pounds, while the currency column stores 'GBP'. Values for .L symbols
 * will be 100x overstated until a GBp->GBP normalisation layer is added.
 * Out of scope for now - treat all GBP-tagged values as approximate.
 *
 * Override any rate via env: FX_<CUR>_USD=<rate> in .env.local.
 */

const DEFAULT_RATES: Record<string, number> = {
  // Major
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  // Asia
  INR: 0.012,
  JPY: 0.0065,
  CNY: 0.138,
  // Oceania
  AUD: 0.645,
  CAD: 0.735,
  // Europe (STOXX 600 universe)
  CHF: 1.12,   // Swiss franc
  SEK: 0.092,  // Swedish krona
  NOK: 0.092,  // Norwegian krone
  DKK: 0.145,  // Danish krone
  PLN: 0.24,   // Polish zloty
  HUF: 0.0027, // Hungarian forint
  CZK: 0.044,  // Czech koruna
};

const warned = new Set<string>();

/** Multiplier that converts 1 unit of `currency` into USD. */
export function usdRate(currency: string | undefined): number {
  const cur = (currency ?? 'USD').toUpperCase();
  const env = Number(process.env[`FX_${cur}_USD`]);
  if (Number.isFinite(env) && env > 0) return env;
  const rate = DEFAULT_RATES[cur];
  if (rate !== undefined) return rate;
  if (!warned.has(cur)) {
    console.warn(`[fx] no rate for ${cur} - treating as 1:1 with USD (set FX_${cur}_USD in .env.local)`);
    warned.add(cur);
  }
  return 1;
}

export function toUSD(amount: number, currency: string | undefined): number {
  return amount * usdRate(currency);
}

export function fromUSD(amountUSD: number, currency: string | undefined): number {
  return amountUSD / usdRate(currency);
}

/**
 * Convert `amount` from one currency to another via USD as pivot.
 * Uses the same static rates as toUSD/fromUSD.
 */
export function convert(amount: number, from: string | undefined, to: string | undefined): number {
  return fromUSD(toUSD(amount, from), to);
}

/**
 * Returns a snapshot of all known USD rates (DEFAULT_RATES merged with env overrides).
 * Used by the /api/fx endpoint to share rates with the client.
 */
export function getAllRates(): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const cur of Object.keys(DEFAULT_RATES)) {
    merged[cur] = usdRate(cur);
  }
  return merged;
}
