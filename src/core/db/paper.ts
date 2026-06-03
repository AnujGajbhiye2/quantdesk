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
}

function rowToTrade(r: PaperTradeRow): PaperTrade {
  return {
    id:          r.id,
    strategyId:  r.strategy_id,
    symbol:      r.symbol,
    side:        r.side as 'long' | 'short',
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
  };
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

export function insertPaperTrade(trade: PaperTrade): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO paper_trades
      (id, strategy_id, symbol, side, qty, entry_time, entry_price,
       stop_price, target_price, status, costs, notes)
    VALUES
      (@id, @strategyId, @symbol, @side, @qty, @entryTime, @entryPrice,
       @stopPrice, @targetPrice, @status, @costs, @notes)
  `).run({
    id:          trade.id,
    strategyId:  trade.strategyId,
    symbol:      trade.symbol,
    side:        trade.side,
    qty:         trade.qty,
    entryTime:   trade.entryTime,
    entryPrice:  trade.entryPrice,
    stopPrice:   trade.stopPrice   ?? null,
    targetPrice: trade.targetPrice ?? null,
    status:      trade.status,
    costs:       trade.costs,
    notes:       trade.notes ?? null,
  });
}

/** Update exit fields and status when a trade is closed. */
export function updatePaperTrade(trade: PaperTrade): void {
  const db = getDb();
  db.prepare(`
    UPDATE paper_trades SET
      exit_time    = @exitTime,
      exit_price   = @exitPrice,
      status       = @status,
      pnl          = @pnl,
      pnl_pct      = @pnlPct,
      costs        = @costs,
      notes        = @notes
    WHERE id = @id
  `).run({
    id:        trade.id,
    exitTime:  trade.exitTime  ?? null,
    exitPrice: trade.exitPrice ?? null,
    status:    trade.status,
    pnl:       trade.pnl    ?? null,
    pnlPct:    trade.pnlPct ?? null,
    costs:     trade.costs,
    notes:     trade.notes  ?? null,
  });
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

export function getPaperTrade(id: string): PaperTrade | undefined {
  const db = getDb();
  const row = db
    .prepare(`SELECT * FROM paper_trades WHERE id = ?`)
    .get(id) as PaperTradeRow | undefined;
  return row ? rowToTrade(row) : undefined;
}

/** Return the currently-open paper trade for a symbol, if one exists. */
export function getOpenPaperTradeBySymbol(symbol: string): PaperTrade | undefined {
  const db = getDb();
  const row = db
    .prepare(`
      SELECT * FROM paper_trades
      WHERE symbol = ? AND status = 'open'
      ORDER BY entry_time DESC
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
    conditions.push('status = @status');
    params.status = opts.status;
  }
  if (opts.strategyId) {
    conditions.push('strategy_id = @strategyId');
    params.strategyId = opts.strategyId;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows  = db
    .prepare(`SELECT * FROM paper_trades ${where} ORDER BY entry_time DESC`)
    .all(params) as PaperTradeRow[];

  return rows.map(rowToTrade);
}
