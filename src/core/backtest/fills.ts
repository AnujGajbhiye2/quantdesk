/**
 * Pure fill-math primitives shared by the backtest engine and the paper broker.
 *
 * Both consumers import from here so paper P&L is identical to backtest P&L for the
 * same inputs. No state, no I/O.
 *
 * Conservative choices documented inline - these prevent the system from over-reporting
 * returns.
 */

// ---------------------------------------------------------------------------
// Entry / exit fill prices (adverse slippage)
// ---------------------------------------------------------------------------

/**
 * Entry fill price with adverse slippage.
 * Long buyer fills above market (pays more); short seller fills below (receives less).
 */
export function entryFillPrice(
  side: 'long' | 'short',
  rawPrice: number,
  slippagePct: number,
): number {
  return side === 'long'
    ? rawPrice * (1 + slippagePct)
    : rawPrice * (1 - slippagePct);
}

/**
 * Exit fill price with adverse slippage.
 * Long exit (sell) fills below market; short cover fills above (pays more to cover).
 */
export function exitFillPrice(
  side: 'long' | 'short',
  rawPrice: number,
  slippagePct: number,
): number {
  return side === 'long'
    ? rawPrice * (1 - slippagePct)
    : rawPrice * (1 + slippagePct);
}

// ---------------------------------------------------------------------------
// Stop / target price levels
// ---------------------------------------------------------------------------

/**
 * Compute absolute stop and target prices from entry fill and fractional distances.
 * Long: stop is below entry, target above.
 * Short: inverted - stop above entry, target below.
 */
export function stopTargetPrices(
  side: 'long' | 'short',
  entryFill: number,
  stopPct?: number,
  targetPct?: number,
): { stopPrice?: number; targetPrice?: number } {
  if (side === 'long') {
    return {
      stopPrice:   stopPct   != null ? entryFill * (1 - stopPct)   : undefined,
      targetPrice: targetPct != null ? entryFill * (1 + targetPct) : undefined,
    };
  } else {
    return {
      stopPrice:   stopPct   != null ? entryFill * (1 + stopPct)   : undefined,
      targetPrice: targetPct != null ? entryFill * (1 - targetPct) : undefined,
    };
  }
}

// ---------------------------------------------------------------------------
// P&L
// ---------------------------------------------------------------------------

/**
 * Realized P&L for a closed trade.
 *
 * Commission: charged per fill; a round-trip costs 2 * commission.
 * Slippage is already embedded in entryFill and exitFill (don't add it again here).
 *
 * Conservative: both fills include adverse slippage, so costs are
 * slightly over-stated relative to an optimistic fill assumption.
 */
export function realizedPnl(
  side: 'long' | 'short',
  entryFill: number,
  exitFill: number,
  qty: number,
  commission: number,
): { pnl: number; costs: number } {
  const costs = 2 * commission;
  const pnl =
    side === 'long'
      ? (exitFill - entryFill) * qty - costs
      : (entryFill - exitFill) * qty - costs;
  return { pnl, costs };
}

// ---------------------------------------------------------------------------
// Mark-to-market and sizing
// ---------------------------------------------------------------------------

/**
 * Mark-to-market portfolio value at a given close price.
 * Long: cash + qty * close
 * Short: cash - qty * close (owe qty * close to cover short)
 */
export function markToMarket(
  side: 'long' | 'short',
  cash: number,
  qty: number,
  closePrice: number,
): number {
  return side === 'long'
    ? cash + qty * closePrice
    : cash - qty * closePrice;
}

/**
 * Quantity purchasable given available cash, size fraction, and fill price.
 * Fractional units are intentional - this is a single-user research tool.
 */
export function qtyForCash(
  cash: number,
  sizePct: number,
  fillPrice: number,
): number {
  return (cash * sizePct) / fillPrice;
}
