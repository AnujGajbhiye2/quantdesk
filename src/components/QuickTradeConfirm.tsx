'use client';

import { useEffect } from 'react';
import { fmtMoney } from '@/core/format/currency';
import { toUSD } from '@/core/format/fx';
import type { EnrichedTradeIdea } from '@/core/signals/gate';
import type { AccountSummary } from '@/core/paper/account';

interface Props {
  idea:       EnrichedTradeIdea;
  busy?:      boolean;
  /** Budget summary; null = no budget set (no affordability check). */
  account?:   AccountSummary | null;
  strategyName?: string;
  onConfirm:  () => void;
  onCancel:   () => void;
}

function row(label: string, value: React.ReactNode, color?: string) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, padding: '2px 0' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ color: color ?? 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

/**
 * Enter-Enter paper trade flow: first Enter on a focused idea row opens this
 * pre-filled confirm box; a second Enter opens the trade; Escape cancels.
 */
export default function QuickTradeConfirm({ idea, busy, account, strategyName, onConfirm, onCancel }: Props) {
  // Affordability: entry cost vs spendable cash (both USD; static fx for non-USD)
  const costUSD      = toUSD(idea.entryPrice * idea.qty, idea.currency);
  const unaffordable = account != null && (account.bankrupt || costUSD > account.cash);
  const blocked      = Boolean(busy) || unaffordable;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (!blocked) onConfirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    // Capture phase so the overlay wins over any list nav handlers below
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [blocked, onConfirm, onCancel]);

  const sideColor = idea.side === 'long' ? 'var(--color-up)' : 'var(--color-down)';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-mono)',
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--color-accent)',
          minWidth: 340,
          padding: '10px 14px',
          fontSize: 'var(--fs-sm)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            borderBottom: '1px solid var(--border)',
            paddingBottom: 6,
            marginBottom: 6,
          }}
        >
          <span style={{ color: 'var(--color-accent)', fontWeight: 700, letterSpacing: '0.06em' }}>
            OPEN PAPER TRADE
          </span>
          <span style={{ color: sideColor, fontWeight: 700 }}>
            {idea.side.toUpperCase()} {idea.symbol}
          </span>
        </div>

        {row('strategy', strategyName ?? idea.strategyId)}
        {row('entry',  fmtMoney(idea.entryPrice, idea.currency))}
        {row('stop',   fmtMoney(idea.stopPrice, idea.currency), 'var(--color-down)')}
        {row('target', fmtMoney(idea.targetPrice, idea.currency), 'var(--color-up)')}
        {row('qty',    idea.qty.toFixed(4))}
        {row('risk',   fmtMoney(idea.riskAmount, idea.currency), 'var(--color-down)')}
        {row('R:R',    isFinite(idea.rr) ? `${idea.rr.toFixed(1)}x` : '--')}
        {idea.conviction && (
          <div
            title={idea.conviction.components.map((c) => `${c.label}: ${c.detail}`).join('\n')}
            style={{ display: 'flex', justifyContent: 'space-between', gap: 24, padding: '2px 0' }}
          >
            <span style={{ color: 'var(--text-muted)' }}>conviction</span>
            <span
              style={{
                color: idea.conviction.band === 'STRONG' ? 'var(--color-up)'
                  : idea.conviction.band === 'WEAK' ? 'var(--color-down)' : 'var(--color-accent)',
                fontWeight: 700,
              }}
            >
              {idea.conviction.score} {idea.conviction.band}
            </span>
          </div>
        )}
        {account && row('cost',  `$${costUSD.toFixed(2)}`)}
        {account && row(
          'cash available',
          `$${account.cash.toFixed(2)}`,
          unaffordable ? 'var(--color-down)' : undefined,
        )}

        {unaffordable && (
          <div style={{ marginTop: 6, color: 'var(--color-down)', fontSize: 'var(--fs-xs)' }}>
            {account?.bankrupt
              ? 'BANKRUPT - reset the budget to trade again'
              : 'insufficient cash for this trade - it will be rejected'}
          </div>
        )}

        <div
          style={{
            marginTop: 8,
            paddingTop: 6,
            borderTop: '1px solid var(--border)',
            color: 'var(--text-muted)',
            fontSize: 'var(--fs-xs)',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>{busy ? 'opening...' : unaffordable ? 'confirm blocked' : '[Enter] confirm'}</span>
          <span>[Esc] cancel</span>
        </div>
        <div style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
          Paper trade only. Research tool - not financial advice.
        </div>
      </div>
    </div>
  );
}
