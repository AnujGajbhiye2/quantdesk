'use client';

import { useState } from 'react';
import type { HaltState } from '@/core/paper/halt';

// ---------------------------------------------------------------------------
// HaltBanner - fixed top stripe when halted
// ---------------------------------------------------------------------------

export function HaltBanner({ halted }: { halted: boolean }) {
  if (!halted) return null;
  return (
    <div
      style={{
        background:    'var(--color-down)',
        color:         '#fff',
        textAlign:     'center',
        padding:       '6px 16px',
        fontSize:      'var(--fs-xs)',
        fontWeight:    700,
        letterSpacing: '0.12em',
        borderBottom:  '2px solid #a00',
        flexShrink:    0,
      }}
    >
      SYSTEM HALTED - NEW ENTRIES BLOCKED
    </div>
  );
}

// ---------------------------------------------------------------------------
// KillSwitch - the button + confirm state
// ---------------------------------------------------------------------------

interface KillSwitchProps {
  initialState: HaltState;
}

export function KillSwitch({ initialState }: KillSwitchProps) {
  const [halt, setHalt]           = useState<HaltState>(initialState);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy]           = useState(false);
  const [error, setError]         = useState<string | null>(null);

  async function callHalt(action: 'halt' | 'resume', reason?: string) {
    setBusy(true);
    setError(null);
    try {
      const res  = await fetch('/api/halt', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action, reason }),
      });
      const data = await res.json() as HaltState & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? 'request failed');
      setHalt(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  // --- Halted: show RESUME path ---
  if (halt.halted) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
          Halt active: <span style={{ color: 'var(--color-down)' }}>{halt.reason}</span>
        </div>
        {confirming ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-accent)' }}>
              Confirm: re-enable new entries?
            </span>
            <button
              disabled={busy}
              onClick={() => void callHalt('resume')}
              style={btnStyle('var(--color-up)')}
            >
              {busy ? 'RESUMING...' : 'YES - RESUME'}
            </button>
            <button
              disabled={busy}
              onClick={() => setConfirming(false)}
              style={btnStyle('var(--text-muted)')}
            >
              CANCEL
            </button>
          </div>
        ) : (
          <button
            disabled={busy}
            onClick={() => setConfirming(true)}
            style={btnStyle('var(--color-up)')}
          >
            RESUME NEW ENTRIES
          </button>
        )}
        {error && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-down)' }}>{error}</span>}
      </div>
    );
  }

  // --- Active: show HALT path ---
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
        New entries: <span style={{ color: 'var(--color-up)', fontWeight: 600 }}>ACTIVE</span>
      </div>
      {confirming ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-down)' }}>
            Block all new entries until resumed?
          </span>
          <button
            disabled={busy}
            onClick={() => void callHalt('halt', 'manual halt via session dashboard')}
            style={btnStyle('var(--color-down)')}
          >
            {busy ? 'HALTING...' : 'YES - HALT'}
          </button>
          <button
            disabled={busy}
            onClick={() => setConfirming(false)}
            style={btnStyle('var(--text-muted)')}
          >
            CANCEL
          </button>
        </div>
      ) : (
        <button
          disabled={busy}
          onClick={() => setConfirming(true)}
          style={btnStyle('var(--color-down)')}
        >
          HALT NEW ENTRIES
        </button>
      )}
      {error && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-down)' }}>{error}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function btnStyle(borderColor: string): React.CSSProperties {
  return {
    background:  'var(--bg-panel)',
    border:      `1px solid ${borderColor}`,
    color:       borderColor,
    fontFamily:  'var(--font-mono)',
    fontSize:    'var(--fs-xs)',
    padding:     '3px 10px',
    cursor:      'pointer',
    letterSpacing: '0.08em',
    fontWeight:  600,
  };
}
