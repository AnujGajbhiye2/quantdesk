import 'server-only';
import { getDb } from './client';
import type { PaperTrade, TradeStatus } from '@/core/types';

// ---------------------------------------------------------------------------
// Row type (snake_case DB columns -> camelCase TS)
// ---------------------------------------------------------------------------

interface PaperTradeRow {
  id:           string;
  strategy_id:  string;
  symbol:       string;
  side:         string;
  qty:          number;
  entry_time:   string;
  entry_price:  number;
  exit_time:    string | null;
  exit_price:   number | null;
  stop_price:   number | null;
  target_price: number | null;
  status:       string;
  pnl:          number | null;
  pnl_pct:      number | null;
  costs:        number;
  notes:        string | null;
  market:       string | null;
  currency:     string | null; // joined from symbols table
}

function rowToTrade(r: PaperTradeRow): PaperTrade {
  return {
    id:          r.id,
    strategyId:  r.strategy_id,
    symbol:      r.symbol,
    side:        r.side as 'long' | 'short',
    currency:    r.currency ?? undefined,
    qty:         r.qty,
    entryTime:   r.entry_time,
    entryPrice:  r.entry_price,
    exitTime:    r.exit_time  ?? undefined,
    exitPrice:   r.exit_price ?? undefined,
    stopPrice:   r.stop_price   ?? undefined,
    targetPrice: r.target_price ?? undefined,
    status:      r.status as TradeStatus,
    pnl:         r.pnl     ?? undefined,
    pnlPct:      r.pnl_pct ?? undefined,
    costs:       r.costs,
    notes:       r.notes ?? undefined,
    market:      r.market ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

// NOTE: all writes below use positional (?) params, never named (@param)
// objects - libsql's embedded-replica connection silently drops writes bound
// via named object args (no error, no persisted row). See client.ts header
// comment for the full explanation.

export function insertPaperTrade(trade: PaperTrade): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO paper_trades
      (id, strategy_id, symbol, side, qty, entry_time, entry_price,
       stop_price, target_price, status, costs, notes, market)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run([
    trade.id,
    trade.strategyId,
    trade.symbol,
    trade.side,
    trade.qty,
    trade.entryTime,
    trade.entryPrice,
    trade.stopPrice   ?? null,
    trade.targetPrice ?? null,
    trade.status,
    trade.costs,
    trade.notes ?? null,
    trade.market ?? null,
  ]);
}

/**
 * Flip a pending trade to open by recording the actual fill price and time.
 * Does NOT touch stop/target/qty - those are set correctly at creation.
 */
export function fillPendingPaperTrade(
  id: string,
  fill: { entryPrice: number; entryTime: string },
): void {
  const db = getDb();
  db.prepare(`
    UPDATE paper_trades SET
      entry_price = ?,
      entry_time  = ?,
      status      = 'open'
    WHERE id = ? AND status = 'pending'
  `).run([fill.entryPrice, fill.entryTime, id]);
}

/** Ratchet an open trade's stop price (trailing stop). No-op on closed/pending trades. */
export function updatePaperTradeStop(id: string, stopPrice: number): void {
  getDb()
    .prepare("UPDATE paper_trades SET stop_price = ? WHERE id = ? AND status = 'open'")
    .run([stopPrice, id]);
}

/** Delete a pending trade (cancel a resting limit order - no history kept). */
export function cancelPendingPaperTrade(id: string): void {
  getDb()
    .prepare("DELETE FROM paper_trades WHERE id = ? AND status = 'pending'")
    .run([id]);
}

/** Update exit fields and status when a trade is closed. */
export function updatePaperTrade(trade: PaperTrade): void {
  const db = getDb();
  db.prepare(`
    UPDATE paper_trades SET
      exit_time    = ?,
      exit_price   = ?,
      status       = ?,
      pnl          = ?,
      pnl_pct      = ?,
      costs        = ?,
      notes        = ?
    WHERE id = ?
  `).run([
    trade.exitTime  ?? null,
    trade.exitPrice ?? null,
    trade.status,
    trade.pnl    ?? null,
    trade.pnlPct ?? null,
    trade.costs,
    trade.notes  ?? null,
    trade.id,
  ]);
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

export function getPaperTrade(id: string): PaperTrade | undefined {
  const db = getDb();
  const row = db
    .prepare(`
      SELECT pt.*, s.currency
      FROM paper_trades pt
      LEFT JOIN symbols s ON pt.symbol = s.symbol
      WHERE pt.id = ?
    `)
    .get(id) as PaperTradeRow | undefined;
  return row ? rowToTrade(row) : undefined;
}

/** Return any active (open OR pending) paper trade for a symbol, if one exists. */
export function getActivePaperTradeBySymbol(symbol: string): PaperTrade | undefined {
  const db = getDb();
  const row = db
    .prepare(`
      SELECT pt.*, s.currency
      FROM paper_trades pt
      LEFT JOIN symbols s ON pt.symbol = s.symbol
      WHERE pt.symbol = ? AND pt.status IN ('open', 'pending')
      ORDER BY pt.entry_time DESC
      LIMIT 1
    `)
    .get(symbol) as PaperTradeRow | undefined;
  return row ? rowToTrade(row) : undefined;
}

/** Return the currently-open paper trade for a symbol, if one exists. */
export function getOpenPaperTradeBySymbol(symbol: string): PaperTrade | undefined {
  const db = getDb();
  const row = db
    .prepare(`
      SELECT pt.*, s.currency
      FROM paper_trades pt
      LEFT JOIN symbols s ON pt.symbol = s.symbol
      WHERE pt.symbol = ? AND pt.status = 'open'
      ORDER BY pt.entry_time DESC
      LIMIT 1
    `)
    .get(symbol) as PaperTradeRow | undefined;
  return row ? rowToTrade(row) : undefined;
}

export interface GetPaperTradesOpts {
  status?:     TradeStatus;
  strategyId?: string;
}

export function getPaperTrades(opts: GetPaperTradesOpts = {}): PaperTrade[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (opts.status) {
    conditions.push('pt.status = @status');
    params.status = opts.status;
  }
  if (opts.strategyId) {
    conditions.push('pt.strategy_id = @strategyId');
    params.strategyId = opts.strategyId;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows  = db
    .prepare(`
      SELECT pt.*, s.currency
      FROM paper_trades pt
      LEFT JOIN symbols s ON pt.symbol = s.symbol
      ${where}
      ORDER BY pt.entry_time DESC
    `)
    .all(params) as PaperTradeRow[];

  return rows.map(rowToTrade);
}
