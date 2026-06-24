'use client';

import { useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DecisionCell {
  action: string;
  fired:  boolean;
  reason: string | null;
}

export interface DecisionLogTableProps {
  symbols:    string[];
  /** Serializable map: symbol -> strategyId -> decision */
  decisions:  Record<string, Record<string, DecisionCell>>;
  strategies: { id: string; name: string }[];
}

// ---------------------------------------------------------------------------
// Style constants (match session/page.tsx table style)
// ---------------------------------------------------------------------------

const th: React.CSSProperties = {
  color:         'var(--text-muted)',
  fontSize:      'var(--fs-xs)',
  fontWeight:    400,
  letterSpacing: '0.08em',
  textAlign:     'left',
  padding:       '3px 8px',
  whiteSpace:    'nowrap',
};

const td: React.CSSProperties = {
  fontSize:           'var(--fs-xs)',
  padding:            '4px 8px',
  borderTop:          '1px solid var(--border)',
  whiteSpace:         'nowrap',
  color:              'var(--text-primary)',
  fontVariantNumeric: 'tabular-nums',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;

export function DecisionLogTable({ symbols, decisions, strategies }: DecisionLogTableProps) {
  const [page, setPage] = useState(0);

  const totalPages = Math.max(1, Math.ceil(symbols.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages - 1);
  const pageStart  = safePage * PAGE_SIZE;
  const pageSyms   = symbols.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <div>
      {/* Pagination controls */}
      <div
        className="flex items-center gap-3"
        style={{ padding: '4px 8px 6px', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}
      >
        <span>{symbols.length} symbols</span>
        <span style={{ color: 'var(--border)' }}>|</span>
        <span>
          {pageStart + 1}-{Math.min(pageStart + PAGE_SIZE, symbols.length)} of {symbols.length}
        </span>
        <span style={{ color: 'var(--border)' }}>|</span>
        <button
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={safePage === 0}
          style={{
            background: 'none',
            border:     '1px solid var(--border)',
            color:      safePage === 0 ? 'var(--text-muted)' : 'var(--color-accent)',
            padding:    '1px 8px',
            fontSize:   'var(--fs-xs)',
            cursor:     safePage === 0 ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          PREV
        </button>
        <span style={{ color: 'var(--text-primary)' }}>
          {safePage + 1} / {totalPages}
        </span>
        <button
          onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          disabled={safePage >= totalPages - 1}
          style={{
            background: 'none',
            border:     '1px solid var(--border)',
            color:      safePage >= totalPages - 1 ? 'var(--text-muted)' : 'var(--color-accent)',
            padding:    '1px 8px',
            fontSize:   'var(--fs-xs)',
            cursor:     safePage >= totalPages - 1 ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          NEXT
        </button>
      </div>

      {/* Matrix table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={th}>SYMBOL</th>
              {strategies.map((s) => (
                <th key={s.id} style={th} colSpan={2}>{s.name.toUpperCase()}</th>
              ))}
            </tr>
            <tr>
              <th style={{ ...th, borderBottom: '1px solid var(--border)' }}></th>
              {strategies.flatMap((s) => [
                <th key={`${s.id}-action`} style={{ ...th, borderBottom: '1px solid var(--border)' }}>DECISION</th>,
                <th key={`${s.id}-reason`} style={{ ...th, borderBottom: '1px solid var(--border)', minWidth: 240 }}>REASON</th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {pageSyms.map((symbol) => {
              const stratMap = decisions[symbol] ?? {};
              return (
                <tr key={symbol}>
                  <td style={{ ...td, color: 'var(--color-accent)', fontWeight: 600 }}>{symbol}</td>
                  {strategies.flatMap((s) => {
                    const d = stratMap[s.id];
                    if (!d) {
                      return [
                        <td key={`${s.id}-action`} style={{ ...td, color: 'var(--text-muted)' }}>-</td>,
                        <td key={`${s.id}-reason`} style={{ ...td, color: 'var(--text-muted)' }}>not evaluated</td>,
                      ];
                    }
                    const actionColor = d.fired
                      ? 'var(--color-up)'
                      : d.action === 'hold'
                        ? 'var(--text-muted)'
                        : 'var(--text-primary)';
                    const actionLabel = d.fired
                      ? d.action.replace('_', ' ').toUpperCase()
                      : 'HOLD';
                    return [
                      <td key={`${s.id}-action`} style={{ ...td, color: actionColor, fontWeight: d.fired ? 700 : 400 }}>
                        {actionLabel}
                      </td>,
                      <td
                        key={`${s.id}-reason`}
                        style={{ ...td, color: d.fired ? 'var(--text-primary)' : 'var(--text-muted)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}
                        title={d.reason ?? ''}
                      >
                        {d.reason ?? '--'}
                      </td>,
                    ];
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
