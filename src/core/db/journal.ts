import 'server-only';
import { getDb } from './client';

/**
 * Trade journal storage - the decision log from the TradingAgents structure.
 * WHY is snapshotted when a trade opens (signal reason, conviction, edge,
 * account state); OUTCOME is appended when it closes. Payloads are JSON and
 * display-only - they never feed back into trading logic.
 */

export interface JournalEntry {
  tradeId:  string;
  openedAt: string;
  why:      Record<string, unknown>;
  closedAt: string | null;
  outcome:  Record<string, unknown> | null;
}

interface Row {
  trade_id:  string;
  opened_at: string;
  why:       string;
  closed_at: string | null;
  outcome:   string | null;
}

function parse(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function insertJournalWhy(tradeId: string, why: Record<string, unknown>): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO journal (trade_id, opened_at, why) VALUES (?, ?, ?)
    ON CONFLICT (trade_id) DO NOTHING
  `).run(tradeId, new Date().toISOString(), JSON.stringify(why));
}

export function recordJournalOutcome(tradeId: string, outcome: Record<string, unknown>): void {
  const db = getDb();
  db.prepare(`
    UPDATE journal SET closed_at = ?, outcome = ? WHERE trade_id = ?
  `).run(new Date().toISOString(), JSON.stringify(outcome), tradeId);
}

export function getJournalEntries(limit = 200): JournalEntry[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT trade_id, opened_at, why, closed_at, outcome FROM journal ORDER BY opened_at DESC LIMIT ?')
    .all(limit) as Row[];
  return rows.map((r) => ({
    tradeId:  r.trade_id,
    openedAt: r.opened_at,
    why:      parse(r.why) ?? {},
    closedAt: r.closed_at,
    outcome:  parse(r.outcome),
  }));
}
