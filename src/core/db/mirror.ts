import 'server-only';
import { getDb } from './client';

// ---------------------------------------------------------------------------
// Broker mirror orders - DB access layer for the mirror_orders table.
// One row per (trade, leg). See core/broker/mirror.ts for the engine.
// ---------------------------------------------------------------------------

export type MirrorLeg = 'entry' | 'exit';
export type MirrorStatus =
  | 'queued'
  | 'submitted'
  | 'filled'
  | 'rejected'
  | 'canceled'
  | 'failed'
  | 'skipped';

export interface MirrorOrder {
  id: string;
  tradeId: string;
  leg: MirrorLeg;
  broker: string;
  clientOrderId: string;
  brokerOrderId?: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  orderType: string;
  timeInForce: string;
  status: MirrorStatus;
  internalPrice: number;
  fillPrice?: number;
  fillQty?: number;
  filledAt?: string;
  error?: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

interface MirrorOrderRow {
  id: string;
  trade_id: string;
  leg: string;
  broker: string;
  client_order_id: string;
  broker_order_id: string | null;
  symbol: string;
  side: string;
  qty: number;
  order_type: string;
  time_in_force: string;
  status: string;
  internal_price: number;
  fill_price: number | null;
  fill_qty: number | null;
  filled_at: string | null;
  error: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}

function rowToMirrorOrder(r: MirrorOrderRow): MirrorOrder {
  return {
    id: r.id,
    tradeId: r.trade_id,
    leg: r.leg as MirrorLeg,
    broker: r.broker,
    clientOrderId: r.client_order_id,
    brokerOrderId: r.broker_order_id ?? undefined,
    symbol: r.symbol,
    side: r.side as 'buy' | 'sell',
    qty: r.qty,
    orderType: r.order_type,
    timeInForce: r.time_in_force,
    status: r.status as MirrorStatus,
    internalPrice: r.internal_price,
    fillPrice: r.fill_price ?? undefined,
    fillQty: r.fill_qty ?? undefined,
    filledAt: r.filled_at ?? undefined,
    error: r.error ?? undefined,
    attempts: r.attempts,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

// NOTE: all writes use positional (?) params, never named (@param) objects -
// libsql's embedded-replica connection silently drops writes bound via named
// object args. See client.ts header comment.

export function insertMirrorOrder(order: MirrorOrder): void {
  getDb().prepare(`
    INSERT INTO mirror_orders
      (id, trade_id, leg, broker, client_order_id, broker_order_id, symbol,
       side, qty, order_type, time_in_force, status, internal_price,
       fill_price, fill_qty, filled_at, error, attempts, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run([
    order.id,
    order.tradeId,
    order.leg,
    order.broker,
    order.clientOrderId,
    order.brokerOrderId ?? null,
    order.symbol,
    order.side,
    order.qty,
    order.orderType,
    order.timeInForce,
    order.status,
    order.internalPrice,
    order.fillPrice ?? null,
    order.fillQty ?? null,
    order.filledAt ?? null,
    order.error ?? null,
    order.attempts,
    order.createdAt,
    order.updatedAt,
  ]);
}

/** Transition status; bumps attempts when submitting, records broker id / error. */
export function updateMirrorOrderStatus(
  id: string,
  update: {
    status: MirrorStatus;
    brokerOrderId?: string;
    error?: string;
    bumpAttempts?: boolean;
    timeInForce?: string;
    qty?: number;
  },
): void {
  getDb().prepare(`
    UPDATE mirror_orders SET
      status          = ?,
      broker_order_id = COALESCE(?, broker_order_id),
      error           = ?,
      attempts        = attempts + ?,
      time_in_force   = COALESCE(?, time_in_force),
      qty             = COALESCE(?, qty),
      updated_at      = ?
    WHERE id = ?
  `).run([
    update.status,
    update.brokerOrderId ?? null,
    update.error ?? null,
    update.bumpAttempts ? 1 : 0,
    update.timeInForce ?? null,
    update.qty ?? null,
    new Date().toISOString(),
    id,
  ]);
}

/** Record the broker's actual fill on a submitted order. */
export function recordMirrorFill(
  id: string,
  fill: { fillPrice: number; fillQty: number; filledAt: string },
): void {
  getDb().prepare(`
    UPDATE mirror_orders SET
      status     = 'filled',
      fill_price = ?,
      fill_qty   = ?,
      filled_at  = ?,
      updated_at = ?
    WHERE id = ?
  `).run([fill.fillPrice, fill.fillQty, fill.filledAt, new Date().toISOString(), id]);
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

export function getMirrorOrder(id: string): MirrorOrder | null {
  const row = getDb()
    .prepare('SELECT * FROM mirror_orders WHERE id = ?')
    .get(id) as MirrorOrderRow | undefined;
  return row ? rowToMirrorOrder(row) : null;
}

export function getMirrorOrderByClientOrderId(clientOrderId: string): MirrorOrder | null {
  const row = getDb()
    .prepare('SELECT * FROM mirror_orders WHERE client_order_id = ?')
    .get(clientOrderId) as MirrorOrderRow | undefined;
  return row ? rowToMirrorOrder(row) : null;
}

export function getMirrorOrdersByStatus(statuses: MirrorStatus[]): MirrorOrder[] {
  if (statuses.length === 0) return [];
  const placeholders = statuses.map(() => '?').join(', ');
  const rows = getDb()
    .prepare(`SELECT * FROM mirror_orders WHERE status IN (${placeholders}) ORDER BY created_at ASC`)
    .all(statuses) as MirrorOrderRow[];
  return rows.map(rowToMirrorOrder);
}

export function getMirrorOrdersForTrades(tradeIds: string[]): MirrorOrder[] {
  if (tradeIds.length === 0) return [];
  const placeholders = tradeIds.map(() => '?').join(', ');
  const rows = getDb()
    .prepare(`SELECT * FROM mirror_orders WHERE trade_id IN (${placeholders}) ORDER BY created_at ASC`)
    .all(tradeIds) as MirrorOrderRow[];
  return rows.map(rowToMirrorOrder);
}

/** All filled mirror legs - input for slippage drift stats. */
export function getFilledMirrorOrders(): MirrorOrder[] {
  const rows = getDb()
    .prepare("SELECT * FROM mirror_orders WHERE status = 'filled' ORDER BY filled_at ASC")
    .all() as MirrorOrderRow[];
  return rows.map(rowToMirrorOrder);
}
