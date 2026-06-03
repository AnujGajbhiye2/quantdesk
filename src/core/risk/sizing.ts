/**
 * Risk-based position sizing.
 *
 * Core formula:
 *   qty = (equity * riskPct) / |entryPrice - stopPrice|
 *
 * This sizes a position so that if the stop is hit, the loss equals exactly
 * `equity * riskPct`. For a 10,000 account risking 1% with entry at 100 and
 * stop at 97 (3 points away): qty = (10,000 * 0.01) / 3 = 33.3 shares.
 *
 * Industry standard for systematic swing trading. Pure, no I/O.
 */

export interface SizingInput {
  /** Total portfolio equity in the base currency. Default: 10,000. */
  equity:      number;
  /** Fraction of equity to risk per trade (0..1]. Default: 0.01 (1%). */
  riskPct:     number;
  /** Expected entry fill price. */
  entryPrice:  number;
  /** Stop-loss price level. Must differ from entryPrice. */
  stopPrice:   number;
}

export interface SizingResult {
  qty:         number;   // shares / units to buy or sell
  riskAmount:  number;   // actual dollar amount at risk
  stopDistance: number;  // |entryPrice - stopPrice|
}

/**
 * Compute risk-based position size.
 *
 * Throws if stopPrice === entryPrice (would produce infinite qty).
 * Returns fractional units (this is a single-user research tool; fractional
 * shares are common in paper trading).
 */
export function riskBasedQty(input: SizingInput): SizingResult {
  const { equity, riskPct, entryPrice, stopPrice } = input;

  if (equity <= 0)   throw new Error('equity must be positive');
  if (riskPct <= 0 || riskPct > 1) throw new Error('riskPct must be in (0, 1]');
  if (entryPrice <= 0) throw new Error('entryPrice must be positive');

  const stopDistance = Math.abs(entryPrice - stopPrice);
  if (stopDistance < 1e-8) throw new Error('stopPrice is too close to entryPrice - stop distance is effectively zero');

  const riskAmount = equity * riskPct;
  const qty        = riskAmount / stopDistance;

  return { qty, riskAmount, stopDistance };
}

/** Default sizing config used by the recommendation engine. */
export interface SizingConfig {
  equity:  number;
  riskPct: number;
}

export const DEFAULT_SIZING: SizingConfig = {
  equity:  10_000,
  riskPct: 0.01,    // 1% per trade
};
