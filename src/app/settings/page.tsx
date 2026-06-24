'use client';

import SettingsPanel from '@/components/panels/SettingsPanel';
import AppNav from '@/components/primitives/AppNav';

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
          <AppNav />
        </div>
      </div>

      {/* Content */}
      <SettingsPanel />
    </div>
  );
}
