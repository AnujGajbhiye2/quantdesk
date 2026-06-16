'use client';

import SettingsPanel from '@/components/panels/SettingsPanel';

export default function SettingsPage() {
  return (
    <div
      style={{
        minHeight:   '100vh',
        background:  'var(--bg-base)',
        color:       'var(--text-primary)',
        fontFamily:  'var(--font-mono)',
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display:       'flex',
          alignItems:    'center',
          justifyContent: 'space-between',
          padding:       '8px 16px',
          background:    'var(--bg-panel)',
          borderBottom:  '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span
            style={{
              color:         'var(--color-accent)',
              fontWeight:    700,
              fontSize:      'var(--fs-sm)',
              letterSpacing: '0.12em',
            }}
          >
            QUANTDESK
          </span>
          <nav className="flex gap-3" style={{ fontSize: 'var(--fs-xs)' }}>
            <a href="/"         style={{ color: 'var(--text-muted)',    textDecoration: 'none' }}>DASH</a>
            <a href="/backtest" style={{ color: 'var(--text-muted)',    textDecoration: 'none' }}>BACKTEST</a>
            <a href="/compare"  style={{ color: 'var(--text-muted)',    textDecoration: 'none' }}>COMPARE</a>
            <a href="/paper"    style={{ color: 'var(--text-muted)',    textDecoration: 'none' }}>PAPER</a>
            <a href="/journal"  style={{ color: 'var(--text-muted)',    textDecoration: 'none' }}>JOURNAL</a>
            <a href="/settings" style={{ color: 'var(--color-accent)', textDecoration: 'none' }}>SETTINGS</a>
          </nav>
        </div>
      </div>

      {/* Content */}
      <SettingsPanel />
    </div>
  );
}
