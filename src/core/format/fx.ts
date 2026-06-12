/**
 * Static FX conversion for the paper-trading account (account currency: USD).
 *
 * Rates are env-configurable approximations refreshed by hand, NOT live FX -
 * good enough to make a mixed USD/INR paper book roughly comparable, useless
 * for anything else. Surfaced as a limitation in the account UI tooltip.
 */

const DEFAULT_RATES: Record<string, number> = {
  USD: 1,
  INR: 0.012,
  EUR: 1.08,
  GBP: 1.27,
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
