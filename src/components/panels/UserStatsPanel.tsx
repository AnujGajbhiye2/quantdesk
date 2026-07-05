'use client';

import { useEffect, useState } from 'react';
import type { UserStats } from '@/core/db/users';

const ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 0',
  borderBottom: '1px solid var(--border)',
};

const SECTION_TITLE: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: 'var(--fs-xs)',
  letterSpacing: '0.1em',
  marginBottom: 8,
  marginTop: 24,
};

/** Admin-only signup analytics card - how many users have signed up, and recent accounts. */
export default function UserStatsPanel() {
  const [stats, setStats] = useState<UserStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/users')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed to load'))))
      .then((d: UserStats) => setStats(d))
      .catch((err) => setError(err instanceof Error ? err.message : 'failed to load'));
  }, []);

  return (
    <div>
      <div style={SECTION_TITLE}>USERS</div>
      {error && <div style={{ color: 'var(--color-down)', fontSize: 'var(--fs-xs)' }}>{error}</div>}
      {!stats && !error && (
        <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>loading...</div>
      )}
      {stats && (
        <>
          <div style={{ ...ROW, gap: 24 }}>
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>TOTAL</div>
              <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 600, color: 'var(--color-accent)' }}>{stats.total}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>LAST 7D</div>
              <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{stats.last7d}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>LAST 30D</div>
              <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{stats.last30d}</div>
            </div>
            <div>
              <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>BY PROVIDER</div>
              <div style={{ fontSize: 'var(--fs-sm)' }}>
                {Object.entries(stats.byProvider).map(([p, c]) => `${p}: ${c}`).join(' · ') || '--'}
              </div>
            </div>
          </div>
          <div style={{ ...ROW, borderBottom: 'none', flexDirection: 'column', alignItems: 'stretch' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', marginBottom: 6 }}>
              RECENT SIGNUPS
            </div>
            {stats.recent.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>none yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {stats.recent.map((u) => (
                  <div key={u.email} style={{ display: 'flex', gap: 12, fontSize: 'var(--fs-xs)' }}>
                    <span style={{ color: 'var(--text-primary)', minWidth: 220 }}>{u.name ?? u.email}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{u.provider}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{new Date(u.createdAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
