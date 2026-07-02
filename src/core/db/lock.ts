import 'server-only';
import { getFlag, setFlag, deleteFlag } from './flags';

/**
 * Simple DB-backed lock, built on the existing app_flags key-value store.
 *
 * All crons run in-process via node-cron inside the single PM2 instance
 * (src/instrumentation.node.ts) with no overlap guard - a slow, network-bound
 * tick (ingest + scan across hundreds of symbols) can still be running when
 * the next scheduled tick fires, letting two ticks race on the same open
 * positions (SYSTEM_AUDIT_AND_ROADMAP.md finding #9). This lock closes that
 * window: acquire before a tick's work, release in a finally block.
 *
 * A stale-lock timeout (not a separate unlock-on-crash mechanism) recovers
 * from a process that died mid-tick without releasing: any lock older than
 * `staleMs` is treated as free.
 */

/** Try to acquire `key`. Returns true if acquired, false if already held (and not stale). */
export function acquireLock(key: string, staleMs = 10 * 60_000): boolean {
  const lockKey = `lock:${key}`;
  const existing = getFlag(lockKey);
  if (existing) {
    const heldSince = Number(existing);
    if (Number.isFinite(heldSince) && Date.now() - heldSince < staleMs) {
      return false; // still held, not stale
    }
  }
  setFlag(lockKey, String(Date.now()));
  return true;
}

/** Release `key`. Safe to call even if the lock was never held. */
export function releaseLock(key: string): void {
  deleteFlag(`lock:${key}`);
}
