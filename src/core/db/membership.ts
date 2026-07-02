import 'server-only';
import { getDb } from './client';

export interface MembershipChange {
  effectiveDate: string; // 'YYYY-MM-DD'
  symbol:        string;
  action:        'added' | 'removed';
}

/** Insert membership change rows for an index, replacing any prior rows for that index. */
export function replaceMembershipChanges(indexName: string, changes: MembershipChange[]): void {
  const db = getDb();
  db.prepare(`DELETE FROM index_membership_changes WHERE index_name = ?`).run([indexName]);
  const stmt = db.prepare(`
    INSERT INTO index_membership_changes (index_name, effective_date, symbol, action, source)
    VALUES (?, ?, ?, ?, 'wikipedia')
    ON CONFLICT(index_name, effective_date, symbol, action) DO NOTHING
  `);
  for (const c of changes) {
    stmt.run([indexName, c.effectiveDate, c.symbol, c.action]);
  }
}

/** Return all stored membership changes for an index, sorted by date ascending. */
export function getMembershipChanges(indexName: string): MembershipChange[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT effective_date, symbol, action FROM index_membership_changes
       WHERE index_name = ? ORDER BY effective_date ASC`,
    )
    .all(indexName) as Array<{ effective_date: string; symbol: string; action: 'added' | 'removed' }>;
  return rows.map((r) => ({ effectiveDate: r.effective_date, symbol: r.symbol, action: r.action }));
}
