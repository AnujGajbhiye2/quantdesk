import 'server-only';
import { getDb } from './client';

/**
 * Alert dedupe log for the stop/target proximity monitor.
 * One row per (trade, level) remembers the last alert state so a price
 * hovering around a level does not spam Telegram every cron tick.
 */

export type AlertLevel = 'stop' | 'target';
export type AlertState = 'near' | 'hit';

export function getAlertState(tradeId: string, level: AlertLevel): AlertState | null {
  const db = getDb();
  const row = db
    .prepare('SELECT state FROM alert_log WHERE trade_id = ? AND level = ?')
    .get(tradeId, level) as { state: AlertState } | undefined;
  return row?.state ?? null;
}

export function setAlertState(tradeId: string, level: AlertLevel, state: AlertState): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO alert_log (trade_id, level, state, sent_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (trade_id, level) DO UPDATE SET state = excluded.state, sent_at = excluded.sent_at
  `).run(tradeId, level, state, new Date().toISOString());
}

/** Re-arm a level (price retreated) or clean up after a trade closes. */
export function clearAlertState(tradeId: string, level?: AlertLevel): void {
  const db = getDb();
  if (level) {
    db.prepare('DELETE FROM alert_log WHERE trade_id = ? AND level = ?').run(tradeId, level);
  } else {
    db.prepare('DELETE FROM alert_log WHERE trade_id = ?').run(tradeId);
  }
}
