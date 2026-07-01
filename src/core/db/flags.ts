import 'server-only';
import { getDb } from './client';

/**
 * Key-value flag store backed by the app_flags SQLite table.
 *
 * Used by operational safety systems:
 *   - 'trading_halt'           : halt reason string when manual kill switch is active
 *   - 'telegram_update_offset' : last processed Telegram update_id + 1 (getUpdates cursor)
 *   - 'heartbeat_seq'          : incrementing counter, one per EOD heartbeat
 *
 * All operations are synchronous (libsql). Values are TEXT; callers
 * that need numbers parse them. Silently no-ops if the DB is unavailable.
 */

export function getFlag(key: string): string | null {
  const db = getDb();
  const row = db
    .prepare('SELECT value FROM app_flags WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setFlag(key: string, value: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO app_flags (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, new Date().toISOString());
}

export function deleteFlag(key: string): void {
  const db = getDb();
  db.prepare('DELETE FROM app_flags WHERE key = ?').run(key);
}
