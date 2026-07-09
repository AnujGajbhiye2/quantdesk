/**
 * Realistic US trading cost model - commission + regulatory fees.
 *
 * Alpaca stock trades are commission-free, but two regulatory fees apply to
 * every SELL (never buys):
 *   - SEC Section 31 fee: a fraction of sell proceeds (rate changes
 *     periodically - env-configurable, verify current before going live)
 *   - FINRA TAF: per share sold, capped per trade
 *
 * Which leg pays: long trades sell at EXIT, short trades sell at ENTRY.
 *
 * Scope: USD trades only. NSE/EU trades keep the plain commission model
 * (their fee structures differ - documented limitation, extend when the
 * India leg goes live).
 *
 * All values env-driven and DEFAULT OFF (0) so historical paper/backtest
 * evidence stays reproducible with an unset env. Enable by setting the fee
 * envs - realistic values documented in .env.local.example:
 *   SEC_FEE_RATE=0.0000278  TAF_FEE_PER_SHARE=0.000166  TAF_FEE_CAP=8.30
 */

export interface CostModel {
  /** Flat commission per fill (Alpaca stocks: 0). Env: COMMISSION_PER_FILL. */
  commissionPerFill: number;
  /** SEC Section 31 - fraction of sell proceeds. Env: SEC_FEE_RATE. */
  secFeeRate: number;
  /** FINRA TAF - per share sold. Env: TAF_FEE_PER_SHARE. */
  tafPerShare: number;
  /** FINRA TAF cap per trade. Env: TAF_FEE_CAP. */
  tafCap: number;
}

// Defaults are all 0 (fees off) - see header. The realistic Alpaca-era values
// for reference: SEC ~0.0000278 ($27.80 per $1M sold, changes periodically),
// TAF 0.000166/share capped at $8.30.
export const DEFAULT_COST_MODEL: CostModel = {
  commissionPerFill: 0,
  secFeeRate: 0,
  tafPerShare: 0,
  tafCap: 8.3,
};

function envNumber(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

/** Cost model from env with Alpaca-realistic defaults. Read at call time. */
export function costModelFromEnv(): CostModel {
  return {
    commissionPerFill: envNumber('COMMISSION_PER_FILL', DEFAULT_COST_MODEL.commissionPerFill),
    secFeeRate:        envNumber('SEC_FEE_RATE',        DEFAULT_COST_MODEL.secFeeRate),
    tafPerShare:       envNumber('TAF_FEE_PER_SHARE',   DEFAULT_COST_MODEL.tafPerShare),
    tafCap:            envNumber('TAF_FEE_CAP',         DEFAULT_COST_MODEL.tafCap),
  };
}

/**
 * Fees for one fill. Buys pay commission only; sells additionally pay
 * SEC fee (on proceeds) + TAF (per share, capped).
 */
export function fillFees(
  model: CostModel,
  action: 'buy' | 'sell',
  qty: number,
  fillPrice: number,
): number {
  let fees = model.commissionPerFill;
  if (action === 'sell') {
    fees += model.secFeeRate * qty * fillPrice;
    fees += Math.min(model.tafPerShare * qty, model.tafCap);
  }
  return fees;
}

/**
 * Total round-trip costs for a closed trade.
 * Long: buy at entry, sell at exit. Short: sell at entry, buy to cover at exit.
 */
export function roundTripCosts(
  model: CostModel,
  side: 'long' | 'short',
  entryFill: number,
  exitFill: number,
  qty: number,
): number {
  return side === 'long'
    ? fillFees(model, 'buy', qty, entryFill) + fillFees(model, 'sell', qty, exitFill)
    : fillFees(model, 'sell', qty, entryFill) + fillFees(model, 'buy', qty, exitFill);
}
