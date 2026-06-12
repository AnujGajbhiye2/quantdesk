'use client';

import { useState } from 'react';
import InfoTip from './InfoTip';
import type { AccountSummary } from '@/core/paper/account';

interface Props {
  account:     AccountSummary | null;
  onSetBudget: (amount: number) => void;
  busy?:       boolean;
}

function usd(v: number): string {
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

function pnlColor(v: number): string {
  return v >= 0 ? 'var(--color-up)' : 'var(--color-down)';
}

const INFO =
  'Your paper trading budget. Opening a trade reserves its entry cost from cash; ' +
  'closed P&L settles back in; the balance funds the next trades. Equity at or below $0 = ' +
  'BANKRUPT = this configuration does not work. Non-USD trades convert at static ' +
  'approximate FX rates (set FX_INR_USD etc. in .env.local).';

/**
 * One-line account strip: budget, spendable cash, capital in open trades,
 * mark-to-market equity. Bankrupt state gets a loud red banner and the
 * broker blocks every new trade until the budget is reset.
 */
export default function AccountStrip({ account, onSetBudget, busy }: Props) {
  const [editing, setEditing] = useState(false);
  const [input, setInput]     = useState('1000');

  function submit() {
    const amount = Number(input);
    if (Number.isFinite(amount) && amount > 0) {
      onSetBudget(amount);
      setEditing(false);
    }
  }

  const form = editing ? (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <input
        autoFocus
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') setEditing(false);
        }}
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-xs)',
          padding: '1px 6px',
          width: 80,
        }}
      />
      <button onClick={submit} disabled={busy} style={btnStyle}>OK</button>
      <button onClick={() => setEditing(false)} style={btnStyle}>x</button>
    </span>
  ) : (
    <button onClick={() => setEditing(true)} style={btnStyle} title="set or reset the paper trading budget">
      {account ? 'RESET BUDGET' : 'SET BUDGET'}
    </button>
  );

  return (
    <div style={{ fontFamily: 'var(--font-mono)' }}>
      {account?.bankrupt && (
        <div
          style={{
            background: 'var(--color-down)',
            color: '#0a0e14',
            fontWeight: 700,
            fontSize: 'var(--fs-sm)',
            padding: '4px 12px',
            letterSpacing: '0.06em',
          }}
        >
          BANKRUPT - equity {usd(account.equity)}. The system failed with this budget. Reset the budget to try again.
        </div>
      )}
      <div
        className="flex items-center gap-4 px-4 py-1"
        style={{
          background: 'var(--bg-panel-header)',
          borderBottom: '1px solid var(--border)',
          fontSize: 'var(--fs-xs)',
        }}
      >
        <span style={{ color: 'var(--color-accent)', fontWeight: 700, letterSpacing: '0.06em' }}>
          ACCOUNT
          <span style={{ marginLeft: 4 }}>
            <InfoTip term="ACCOUNT" text={INFO} />
          </span>
        </span>

        {account ? (
          <>
            <span style={{ color: 'var(--text-muted)' }}>
              BUDGET <span style={{ color: 'var(--text-primary)' }}>{usd(account.startingBalance)}</span>
            </span>
            <span style={{ color: 'var(--text-muted)' }} title="spendable cash - new trades are rejected beyond this">
              CASH <span style={{ color: account.cash < 0 ? 'var(--color-down)' : 'var(--text-primary)' }}>{usd(account.cash)}</span>
            </span>
            <span style={{ color: 'var(--text-muted)' }} title={`entry cost locked in ${account.openTrades} open trade(s)`}>
              IN TRADES <span style={{ color: 'var(--text-primary)' }}>{usd(account.cashUsed)}</span>
            </span>
            <span style={{ color: 'var(--text-muted)' }} title="budget + realized + unrealized P&L, marked to latest close">
              EQUITY{' '}
              <span style={{ color: pnlColor(account.equity - account.startingBalance), fontWeight: 700 }}>
                {usd(account.equity)} ({account.equity >= account.startingBalance ? '+' : ''}
                {(((account.equity - account.startingBalance) / account.startingBalance) * 100).toFixed(1)}%)
              </span>
            </span>
            <span style={{ color: 'var(--text-muted)' }}>
              {account.closedTrades} closed · {account.openTrades} open
            </span>
          </>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>
            no budget set - trades size against a notional $10,000; set a budget to trade with real constraints
          </span>
        )}

        <span style={{ marginLeft: 'auto' }}>{form}</span>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  color: 'var(--color-accent)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-xs)',
  padding: '1px 8px',
  cursor: 'pointer',
};
