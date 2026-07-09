/**
 * Broker mirror engine - follower orders on the Alpaca paper account.
 *
 * The internal paper system is the single source of truth. Every eligible
 * US-symbol entry/exit enqueues a mirror_orders row (sync DB write) and then
 * kicks an async submit pass. The 15-min monitor cron re-drives anything
 * still queued/submitted, so a crash or Alpaca outage never loses a mirror.
 *
 * HARD RULE: a mirror failure must never break internal paper trading. All
 * hook entry points swallow errors (log + Telegram alert).
 *
 * Gating (see alpacaEnv().mirrorEnabled):
 *   ALPACA_MIRROR_ENABLED=1 + keys, blocked under LOCAL_DEV_MODE=1 unless
 *   ALPACA_MIRROR_ALLOW_LOCAL=1.
 */

import { randomUUID } from 'node:crypto';
import type { PaperTrade } from '@/core/types';
import { alpacaEnv } from './alpaca-env';
import {
  getAlpacaTradingClient,
  AlpacaApiError,
  type AlpacaOrder,
  type AlpacaTradingClient,
} from './alpaca-trading';
import {
  insertMirrorOrder,
  updateMirrorOrderStatus,
  recordMirrorFill,
  getMirrorOrdersByStatus,
  getMirrorOrdersForTrades,
  type MirrorOrder,
  type MirrorLeg,
} from '@/core/db/mirror';
import { isAutoTradeSymbol } from '@/core/data/universe';
import { isUsMarketOpen } from '@/core/market/hours';
import { telegramConfigured, sendTelegram } from '@/core/notify/telegram';

const MAX_SUBMIT_ATTEMPTS = 5;

// Alpaca order states that mean "terminal, did not fill".
const DEAD_ORDER_STATUSES = new Set(['canceled', 'expired', 'rejected', 'suspended', 'stopped']);

export function mirrorEnabled(): boolean {
  return alpacaEnv().mirrorEnabled;
}

/** Only US symbols in the sp500/gold universes can mirror to Alpaca. */
export function isMirrorEligible(symbol: string): boolean {
  return isAutoTradeSymbol(symbol.toUpperCase());
}

function notify(text: string): void {
  if (telegramConfigured()) void sendTelegram(text);
}

// ---------------------------------------------------------------------------
// Enqueue (called from paper broker hooks - must be sync and non-throwing)
// ---------------------------------------------------------------------------

function buildMirrorOrder(trade: PaperTrade, leg: MirrorLeg): MirrorOrder {
  // Long entry = buy, long exit = sell; short entry = sell, short exit = buy.
  const side: 'buy' | 'sell' =
    (trade.side === 'long') === (leg === 'entry') ? 'buy' : 'sell';
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    tradeId: trade.id,
    leg,
    broker: 'alpaca',
    clientOrderId: `qd:${trade.id}:${leg}`,
    symbol: trade.symbol,
    side,
    qty: trade.qty,
    orderType: 'market',
    // tif is finalized at submit time (market may have opened/closed since)
    timeInForce: isUsMarketOpen() ? 'day' : 'opg',
    status: 'queued',
    internalPrice: leg === 'entry' ? trade.entryPrice : (trade.exitPrice ?? trade.entryPrice),
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function enqueue(trade: PaperTrade, leg: MirrorLeg): void {
  const existing = getMirrorOrdersForTrades([trade.id]).find((m) => m.leg === leg);
  if (existing) return; // already enqueued (e.g. re-entrant call)
  insertMirrorOrder(buildMirrorOrder(trade, leg));
  // Fire-and-forget submit pass; the monitor cron re-drives leftovers.
  void submitQueuedMirrorOrders().catch((err) => {
    console.error('[mirror] async submit pass failed:', err);
  });
}

/** Hook: internal entry recorded - mirror a follower entry order. Never throws. */
export function tryEnqueueEntryMirror(trade: PaperTrade): void {
  try {
    if (!mirrorEnabled() || !isMirrorEligible(trade.symbol)) return;
    enqueue(trade, 'entry');
  } catch (err) {
    console.error(`[mirror] entry enqueue failed for ${trade.symbol}:`, err);
    notify(`⚠️ mirror: entry enqueue failed for ${trade.symbol} - ${String(err).slice(0, 200)}`);
  }
}

/** Hook: internal exit recorded - mirror a flattening order. Never throws. */
export function tryEnqueueExitMirror(trade: PaperTrade): void {
  try {
    if (!mirrorEnabled() || !isMirrorEligible(trade.symbol)) return;
    enqueue(trade, 'exit');
  } catch (err) {
    console.error(`[mirror] exit enqueue failed for ${trade.symbol}:`, err);
    notify(`⚠️ mirror: exit enqueue failed for ${trade.symbol} - ${String(err).slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// Submit pass
// ---------------------------------------------------------------------------

export interface MirrorSubmitResult {
  mirrorOrderId: string;
  symbol: string;
  outcome: 'submitted' | 'recovered' | 'skipped' | 'failed';
  detail?: string;
}

/**
 * Adjust qty for Alpaca constraints. Short sells cannot be fractional -
 * round down to whole shares; below 1 share the mirror is skipped.
 * Exit legs reuse the entry leg's actual fill qty when known so the Alpaca
 * position flattens exactly.
 */
function effectiveQty(order: MirrorOrder, siblings: MirrorOrder[]): number {
  let qty = order.qty;
  if (order.leg === 'exit') {
    const entry = siblings.find((m) => m.tradeId === order.tradeId && m.leg === 'entry');
    if (entry?.fillQty && entry.fillQty > 0) qty = entry.fillQty;
    // Entry that never made it to the broker - nothing to flatten.
    if (entry && (entry.status === 'skipped' || entry.status === 'failed' || entry.status === 'rejected')) {
      return 0;
    }
  }
  // Opening a short (sell entry) must be whole shares.
  const isShortOpen = order.leg === 'entry' && order.side === 'sell';
  if (isShortOpen) qty = Math.floor(qty);
  return qty;
}

/** Submit all queued mirror orders. Idempotent via client_order_id. */
export async function submitQueuedMirrorOrders(): Promise<MirrorSubmitResult[]> {
  if (!mirrorEnabled()) return [];
  const client = getAlpacaTradingClient();
  if (!client) return [];

  const queued = getMirrorOrdersByStatus(['queued']);
  if (queued.length === 0) return [];

  const tradeIds = Array.from(new Set(queued.map((m) => m.tradeId)));
  const siblings = getMirrorOrdersForTrades(tradeIds);
  const results: MirrorSubmitResult[] = [];

  for (const order of queued) {
    try {
      results.push(await submitOne(client, order, siblings));
    } catch (err) {
      const detail = String(err).slice(0, 300);
      const failed = order.attempts + 1 >= MAX_SUBMIT_ATTEMPTS;
      updateMirrorOrderStatus(order.id, {
        status: failed ? 'failed' : 'queued',
        error: detail,
        bumpAttempts: true,
      });
      if (failed) {
        notify(`⚠️ mirror: giving up on ${order.symbol} ${order.leg} after ${MAX_SUBMIT_ATTEMPTS} attempts - ${detail}`);
      }
      results.push({ mirrorOrderId: order.id, symbol: order.symbol, outcome: 'failed', detail });
    }
  }
  return results;
}

async function submitOne(
  client: AlpacaTradingClient,
  order: MirrorOrder,
  siblings: MirrorOrder[],
): Promise<MirrorSubmitResult> {
  // Idempotency: a previous attempt may have reached Alpaca before we crashed.
  const existing = await client.getOrderByClientOrderId(order.clientOrderId);
  if (existing) {
    updateMirrorOrderStatus(order.id, {
      status: 'submitted',
      brokerOrderId: existing.id,
      bumpAttempts: true,
    });
    return { mirrorOrderId: order.id, symbol: order.symbol, outcome: 'recovered' };
  }

  const qty = effectiveQty(order, siblings);
  if (qty <= 0) {
    updateMirrorOrderStatus(order.id, {
      status: 'skipped',
      error: order.leg === 'exit'
        ? 'entry leg never filled at broker - nothing to flatten'
        : 'short qty rounds to 0 whole shares',
    });
    return { mirrorOrderId: order.id, symbol: order.symbol, outcome: 'skipped' };
  }

  // Exit legs must wait until the entry leg has resolved at the broker,
  // otherwise Alpaca wash-trade protection rejects the opposite-side order.
  if (order.leg === 'exit') {
    const entry = siblings.find((m) => m.tradeId === order.tradeId && m.leg === 'entry');
    if (entry && (entry.status === 'queued' || entry.status === 'submitted')) {
      // Same-symbol open order at the broker? Cancel it first (entry OPG that
      // never filled), then let the next pass submit the exit.
      const open = await client.getOpenOrders(order.symbol);
      const conflicting = open.find((o) => o.clientOrderId === entry.clientOrderId);
      if (conflicting) {
        await client.cancelOrder(conflicting.id);
        updateMirrorOrderStatus(entry.id, { status: 'canceled', error: 'canceled unfilled entry to allow exit' });
        updateMirrorOrderStatus(order.id, {
          status: 'skipped',
          error: 'entry canceled before fill - no broker position to flatten',
        });
        return { mirrorOrderId: order.id, symbol: order.symbol, outcome: 'skipped' };
      }
      // Entry still in flight (fill unknown) - leave queued for the next pass.
      return {
        mirrorOrderId: order.id,
        symbol: order.symbol,
        outcome: 'skipped',
        detail: 'entry leg still in flight - deferred',
      };
    }
  }

  const timeInForce: 'day' | 'opg' = isUsMarketOpen() ? 'day' : 'opg';
  try {
    const submitted = await client.submitOrder({
      symbol: order.symbol,
      qty,
      side: order.side,
      type: 'market',
      timeInForce,
      clientOrderId: order.clientOrderId,
    });
    updateMirrorOrderStatus(order.id, {
      status: 'submitted',
      brokerOrderId: submitted.id,
      bumpAttempts: true,
      timeInForce,
      qty,
    });
    return { mirrorOrderId: order.id, symbol: order.symbol, outcome: 'submitted' };
  } catch (err) {
    // 422 duplicate client_order_id - recover the existing order id.
    if (err instanceof AlpacaApiError && err.status === 422 && /client_order_id/i.test(err.message)) {
      const dup = await client.getOrderByClientOrderId(order.clientOrderId);
      if (dup) {
        updateMirrorOrderStatus(order.id, { status: 'submitted', brokerOrderId: dup.id, bumpAttempts: true });
        return { mirrorOrderId: order.id, symbol: order.symbol, outcome: 'recovered' };
      }
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Fill polling
// ---------------------------------------------------------------------------

export interface MirrorPollResult {
  mirrorOrderId: string;
  symbol: string;
  status: 'filled' | 'rejected' | 'pending';
}

/** Poll submitted orders: record fills, alert on rejections. */
export async function pollMirrorFills(): Promise<MirrorPollResult[]> {
  if (!mirrorEnabled()) return [];
  const client = getAlpacaTradingClient();
  if (!client) return [];

  const submitted = getMirrorOrdersByStatus(['submitted']);
  const results: MirrorPollResult[] = [];

  for (const order of submitted) {
    try {
      const broker: AlpacaOrder | null = order.brokerOrderId
        ? await client.getOrder(order.brokerOrderId)
        : await client.getOrderByClientOrderId(order.clientOrderId);
      if (!broker) continue;

      if (broker.status === 'filled' && broker.filledAvgPrice != null) {
        recordMirrorFill(order.id, {
          fillPrice: broker.filledAvgPrice,
          fillQty: broker.filledQty,
          filledAt: broker.filledAt ?? new Date().toISOString(),
        });
        results.push({ mirrorOrderId: order.id, symbol: order.symbol, status: 'filled' });
      } else if (DEAD_ORDER_STATUSES.has(broker.status)) {
        updateMirrorOrderStatus(order.id, {
          status: broker.status === 'rejected' ? 'rejected' : 'canceled',
          error: `broker status: ${broker.status}`,
        });
        notify(`⚠️ mirror: ${order.symbol} ${order.leg} order ${broker.status} at Alpaca`);
        results.push({ mirrorOrderId: order.id, symbol: order.symbol, status: 'rejected' });
      } else {
        results.push({ mirrorOrderId: order.id, symbol: order.symbol, status: 'pending' });
      }
    } catch (err) {
      console.error(`[mirror] fill poll failed for ${order.symbol}:`, err);
    }
  }
  return results;
}
