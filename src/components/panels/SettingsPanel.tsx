'use client';

/**
 * User master-controls panel.
 *
 * - Currency: sets app-wide display currency (persisted in account.currency via DB).
 * - Budget: sets the paper-trading starting balance.
 * - Reset paper account: clears trades/journal/signals/edge/alerts/account.
 *   Leaves market data (symbols, bars, caches) intact.
 * - Wipe everything: full DB clear. Requires re-ingest after.
 */

import { useCallback, useState } from 'react';
import { useSettings } from '@/components/providers/SettingsProvider';
import { DISPLAY_CURRENCIES } from '@/core/format/currencies';
import { curGlyph } from '@/core/format/currency';
import UserStatsPanel from '@/components/panels/UserStatsPanel';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 0',
  borderBottom: '1px solid var(--border)',
};

const LABEL: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: 'var(--fs-xs)',
  letterSpacing: '0.08em',
  minWidth: 160,
};

const INPUT: React.CSSProperties = {
  background:  'var(--bg-panel)',
  border:      '1px solid var(--border)',
  color:       'var(--text-primary)',
  fontFamily:  'var(--font-mono)',
  fontSize:    'var(--fs-sm)',
  padding:     '3px 8px',
  outline:     'none',
  width:       160,
};

const BTN = (variant: 'normal' | 'danger' | 'accent' = 'normal'): React.CSSProperties => ({
  background:  'var(--bg-panel)',
  border:      `1px solid ${variant === 'danger' ? 'var(--color-down)' : variant === 'accent' ? 'var(--color-accent)' : 'var(--border)'}`,
  color:       variant === 'danger' ? 'var(--color-down)' : variant === 'accent' ? 'var(--color-accent)' : 'var(--text-primary)',
  fontFamily:  'var(--font-mono)',
  fontSize:    'var(--fs-xs)',
  padding:     '3px 12px',
  cursor:      'pointer',
  letterSpacing: '0.04em',
});

const SECTION_TITLE: React.CSSProperties = {
  color:         'var(--text-muted)',
  fontSize:      'var(--fs-xs)',
  letterSpacing: '0.1em',
  marginBottom:  8,
  marginTop:     24,
};

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------

export default function SettingsPanel() {
  const { displayCurrency, account, setDisplayCurrency, reload } = useSettings();

  // Budget
  const [budgetInput, setBudgetInput] = useState('');
  const [budgetMsg,   setBudgetMsg]   = useState('');
  const [budgetBusy,  setBudgetBusy]  = useState(false);

  // Reset paper
  const [resetConfirm,  setResetConfirm]  = useState(false);
  const [resetBusy,     setResetBusy]     = useState(false);
  const [resetMsg,      setResetMsg]      = useState('');

  // Wipe all
  const [wipeInput,   setWipeInput]   = useState('');
  const [wipeBusy,    setWipeBusy]    = useState(false);
  const [wipeMsg,     setWipeMsg]     = useState('');

  // ---------- handlers ----------

  const handleCurrencyChange = useCallback(async (cur: string) => {
    await setDisplayCurrency(cur);
  }, [setDisplayCurrency]);

  const handleBudgetSet = useCallback(async () => {
    const amount = parseFloat(budgetInput);
    if (!isFinite(amount) || amount <= 0) {
      setBudgetMsg('enter a positive number');
      return;
    }
    setBudgetBusy(true);
    setBudgetMsg('');
    try {
      const res = await fetch('/api/settings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'budget-set', amount }),
      });
      const data = await res.json() as { account?: { startingBalance: number }; error?: string };
      if (!res.ok) { setBudgetMsg(data.error ?? 'error'); return; }
      setBudgetMsg(`budget set to ${curGlyph(displayCurrency)}${data.account?.startingBalance?.toFixed(2) ?? amount}`);
      setBudgetInput('');
      await reload();
    } catch (e) {
      setBudgetMsg(e instanceof Error ? e.message : 'error');
    } finally {
      setBudgetBusy(false);
    }
  }, [budgetInput, displayCurrency, reload]);

  const handleResetPaper = useCallback(async () => {
    if (!resetConfirm) { setResetConfirm(true); return; }
    setResetBusy(true);
    setResetMsg('');
    try {
      const res = await fetch('/api/settings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'reset-paper' }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setResetMsg(d.error ?? 'error');
      } else {
        setResetMsg('paper account cleared');
        await reload();
      }
    } catch (e) {
      setResetMsg(e instanceof Error ? e.message : 'error');
    } finally {
      setResetBusy(false);
      setResetConfirm(false);
    }
  }, [resetConfirm, reload]);

  const handleWipeAll = useCallback(async () => {
    if (wipeInput !== 'WIPE') {
      setWipeMsg('type WIPE to confirm');
      return;
    }
    setWipeBusy(true);
    setWipeMsg('');
    try {
      const res = await fetch('/api/settings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'reset-all' }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setWipeMsg(d.error ?? 'error');
      } else {
        setWipeMsg('all data wiped - re-ingest required');
        setWipeInput('');
        await reload();
      }
    } catch (e) {
      setWipeMsg(e instanceof Error ? e.message : 'error');
    } finally {
      setWipeBusy(false);
    }
  }, [wipeInput, reload]);

  // ---------- render ----------

  return (
    <div
      style={{
        maxWidth:   640,
        margin:     '0 auto',
        padding:    '24px 16px',
        fontFamily: 'var(--font-mono)',
        fontSize:   'var(--fs-sm)',
        color:      'var(--text-primary)',
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
          [ USER CONTROLS ]
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', marginTop: 4 }}>
          Research tool only - not financial advice. Results are hypothetical.
        </div>
      </div>

      {/* Currency */}
      <div style={SECTION_TITLE}>DISPLAY CURRENCY</div>
      <div style={ROW}>
        <span style={LABEL}>display as</span>
        <select
          value={displayCurrency}
          onChange={(e) => { void handleCurrencyChange(e.target.value); }}
          style={{
            ...INPUT,
            width: 100,
            cursor: 'pointer',
          }}
        >
          {DISPLAY_CURRENCIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
          {curGlyph(displayCurrency)} — static FX rates; not live
        </span>
      </div>

      {/* Budget */}
      <div style={SECTION_TITLE}>BUDGET</div>
      {account && (
        <div style={{ ...ROW, borderBottom: 'none', paddingBottom: 4 }}>
          <span style={LABEL}>current</span>
          <span style={{ color: 'var(--color-accent)' }}>
            {curGlyph(account.currency)}{account.startingBalance.toFixed(2)} {account.currency}
          </span>
        </div>
      )}
      <div style={ROW}>
        <span style={LABEL}>set starting balance</span>
        <input
          type="number"
          min={1}
          step={1000}
          placeholder="e.g. 10000"
          value={budgetInput}
          onChange={(e) => setBudgetInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleBudgetSet(); }}
          style={INPUT}
        />
        <button
          onClick={() => void handleBudgetSet()}
          disabled={budgetBusy}
          style={BTN('accent')}
        >
          {budgetBusy ? 'SAVING...' : 'SET'}
        </button>
        {budgetMsg && (
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>{budgetMsg}</span>
        )}
      </div>

      {/* Reset paper account */}
      <div style={SECTION_TITLE}>RESET</div>
      <div style={ROW}>
        <span style={{ ...LABEL, flexShrink: 0 }}>reset paper account</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
            Clears trades, journal, signals, strategy edge, alerts, account.
            Market data (symbols, bars, caches) is preserved.
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {resetConfirm ? (
              <>
                <button onClick={() => void handleResetPaper()} disabled={resetBusy} style={BTN('danger')}>
                  {resetBusy ? 'RESETTING...' : 'CONFIRM RESET'}
                </button>
                <button onClick={() => setResetConfirm(false)} style={BTN()}>CANCEL</button>
              </>
            ) : (
              <button onClick={() => void handleResetPaper()} style={BTN('danger')}>
                RESET PAPER ACCOUNT
              </button>
            )}
            {resetMsg && (
              <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>{resetMsg}</span>
            )}
          </div>
        </div>
      </div>

      {/* Wipe all */}
      <div style={{ ...ROW, borderBottom: 'none' }}>
        <span style={{ ...LABEL, flexShrink: 0 }}>wipe everything</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--color-down)' }}>
            Warning: removes all data including market history and caches.
            Re-ingest required after this operation.
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="type WIPE to unlock"
              value={wipeInput}
              onChange={(e) => { setWipeInput(e.target.value); setWipeMsg(''); }}
              style={{ ...INPUT, width: 180 }}
            />
            <button
              onClick={() => void handleWipeAll()}
              disabled={wipeBusy || wipeInput !== 'WIPE'}
              style={{
                ...BTN('danger'),
                opacity: wipeInput !== 'WIPE' ? 0.4 : 1,
                cursor:  wipeInput !== 'WIPE' ? 'not-allowed' : 'pointer',
              }}
            >
              {wipeBusy ? 'WIPING...' : 'WIPE ALL DATA'}
            </button>
            {wipeMsg && (
              <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>{wipeMsg}</span>
            )}
          </div>
        </div>
      </div>

      <UserStatsPanel />
    </div>
  );
}
