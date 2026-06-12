/**
 * Cross-cutting runtime config resolved from env with safe defaults.
 * Keep this file tiny - provider- or strategy-specific settings do not belong here.
 */

/** Default swing hold cap: ~1 trading month. */
const DEFAULT_MAX_HOLD_BARS = 21;

/**
 * Global maximum holding period in bars for every backtest, comparison and
 * paper trade. The user swing-trades; positions held longer than ~a month are
 * force-exited so every stat in the app reflects that constraint.
 * Override with MAX_HOLD_BARS in .env.local.
 */
export function maxHoldBars(): number {
  const raw = Number(process.env.MAX_HOLD_BARS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_HOLD_BARS;
}
