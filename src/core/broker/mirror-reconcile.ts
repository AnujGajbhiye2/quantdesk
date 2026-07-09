/**
 * Mirror reconciliation - nightly diff of Alpaca paper positions vs internal
 * open trades, plus real-vs-modeled slippage drift stats from filled mirror
 * legs.
 *
 * The internal book leads; Alpaca follows. Any mismatch means the follower
 * lost sync (rejected order, manual intervention in the Alpaca dashboard,
 * buying-power rejection) and needs a human look - Telegram alert.
 */

import { getPaperTrades } from '@/core/db/paper';
import { getFilledMirrorOrders, getMirrorOrdersByStatus } from '@/core/db/mirror';
import { getAlpacaTradingClient } from './alpaca-trading';
import { mirrorEnabled, isMirrorEligible } from './mirror';
import { telegramConfigured, sendTelegram } from '@/core/notify/telegram';

const STUCK_ORDER_HOURS = 24;

export interface MirrorMismatch {
  symbol: string;
  kind: 'missing-at-alpaca' | 'orphan-at-alpaca' | 'qty-mismatch';
  internalQty: number | null;
  alpacaQty: number | null;
}

export interface MirrorReconcileReport {
  generatedAt: string;
  enabled: boolean;
  alpacaPositions: number;
  internalOpenTrades: number;
  matched: number;
  mismatches: MirrorMismatch[];
  /** queued/submitted orders older than STUCK_ORDER_HOURS. */
  stuckOrders: number;
}

/** Compare Alpaca paper positions against internal open mirror-eligible trades. */
export async function reconcileMirror(): Promise<MirrorReconcileReport> {
  const generatedAt = new Date().toISOString();
  if (!mirrorEnabled()) {
    return {
      generatedAt, enabled: false, alpacaPositions: 0, internalOpenTrades: 0,
      matched: 0, mismatches: [], stuckOrders: 0,
    };
  }
  const client = getAlpacaTradingClient();
  if (!client) {
    return {
      generatedAt, enabled: false, alpacaPositions: 0, internalOpenTrades: 0,
      matched: 0, mismatches: [], stuckOrders: 0,
    };
  }

  const positions = await client.getPositions();
  const internal  = getPaperTrades({ status: 'open' }).filter((t) => isMirrorEligible(t.symbol));

  const posBySymbol = new Map(positions.map((p) => [p.symbol, p]));
  const intBySymbol = new Map(internal.map((t) => [t.symbol, t]));

  const mismatches: MirrorMismatch[] = [];
  let matched = 0;

  for (const trade of internal) {
    const pos = posBySymbol.get(trade.symbol);
    if (!pos) {
      mismatches.push({
        symbol: trade.symbol, kind: 'missing-at-alpaca',
        internalQty: trade.qty, alpacaQty: null,
      });
      continue;
    }
    // Whole-share short rounding makes small qty diffs expected - tolerate 1
    // share or 1% of qty, whichever is larger.
    const signedInternal = trade.side === 'long' ? trade.qty : -trade.qty;
    const signedAlpaca   = pos.side === 'long' ? pos.qty : -pos.qty;
    const tolerance = Math.max(1, Math.abs(signedInternal) * 0.01);
    if (Math.abs(signedInternal - signedAlpaca) > tolerance) {
      mismatches.push({
        symbol: trade.symbol, kind: 'qty-mismatch',
        internalQty: signedInternal, alpacaQty: signedAlpaca,
      });
    } else {
      matched += 1;
    }
  }

  for (const pos of positions) {
    if (!intBySymbol.has(pos.symbol)) {
      mismatches.push({
        symbol: pos.symbol, kind: 'orphan-at-alpaca',
        internalQty: null, alpacaQty: pos.side === 'long' ? pos.qty : -pos.qty,
      });
    }
  }

  const cutoff = Date.now() - STUCK_ORDER_HOURS * 3600_000;
  const stuckOrders = getMirrorOrdersByStatus(['queued', 'submitted'])
    .filter((o) => new Date(o.createdAt).getTime() < cutoff).length;

  if ((mismatches.length > 0 || stuckOrders > 0) && telegramConfigured()) {
    const lines = mismatches
      .slice(0, 10)
      .map((m) => `- ${m.symbol}: ${m.kind} (internal ${m.internalQty ?? '-'}, alpaca ${m.alpacaQty ?? '-'})`);
    void sendTelegram(
      `⚠️ mirror reconcile: ${mismatches.length} mismatch(es), ${stuckOrders} stuck order(s)\n` +
      lines.join('\n'),
    );
  }

  return {
    generatedAt,
    enabled: true,
    alpacaPositions: positions.length,
    internalOpenTrades: internal.length,
    matched,
    mismatches,
    stuckOrders,
  };
}

// ---------------------------------------------------------------------------
// Slippage drift
// ---------------------------------------------------------------------------

export interface MirrorDriftStats {
  /** Filled legs measured (day-tif only unless includeOpg). */
  fills: number;
  /** Signed mean drift in bps: positive = worse than the internal model. */
  meanDriftBps: number;
  medianDriftBps: number;
  worstDriftBps: number;
  /** OPG legs excluded from the headline stats (they embed overnight gap). */
  opgFills: number;
}

/**
 * Real-vs-modeled slippage from filled mirror legs.
 *
 * internal_price already embeds the modeled 5 bps adverse slippage, so a
 * drift of 0 bps means Alpaca filled exactly where the model predicted.
 * Positive drift = the real fill was worse than modeled (adverse direction
 * for that leg's side).
 *
 * Only day-tif legs count - OPG (market-on-open) legs include the overnight
 * gap between the internal signal-close fill and the next open, which is a
 * timing convention difference, not slippage.
 */
export function mirrorDriftStats(): MirrorDriftStats | null {
  const filled = getFilledMirrorOrders().filter((o) => o.fillPrice != null && o.internalPrice > 0);
  if (filled.length === 0) return null;

  const dayLegs = filled.filter((o) => o.timeInForce === 'day');
  const opgFills = filled.length - dayLegs.length;
  if (dayLegs.length === 0) {
    return { fills: 0, meanDriftBps: 0, medianDriftBps: 0, worstDriftBps: 0, opgFills };
  }

  const drifts = dayLegs.map((o) => {
    const raw = ((o.fillPrice as number) - o.internalPrice) / o.internalPrice * 10_000;
    // Adverse direction depends on the leg's side: buys are worse when the
    // fill is HIGHER than modeled, sells when it is LOWER.
    return o.side === 'buy' ? raw : -raw;
  });

  drifts.sort((a, b) => a - b);
  const mean = drifts.reduce((s, d) => s + d, 0) / drifts.length;
  const median = drifts[Math.floor(drifts.length / 2)];
  const worst = Math.max(...drifts);

  return {
    fills: dayLegs.length,
    meanDriftBps: mean,
    medianDriftBps: median,
    worstDriftBps: worst,
    opgFills,
  };
}
