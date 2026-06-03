'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  allSymbols: { symbol: string; name: string }[];
  onClose:    () => void;
}

export default function GoToSymbolOverlay({ allSymbols, onClose }: Props) {
  const [query, setQuery]       = useState('');
  const [cursor, setCursor]     = useState(0);
  const router                  = useRouter();
  const inputRef                = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = allSymbols
    .filter((s) =>
      s.symbol.toLowerCase().includes(query.toLowerCase()) ||
      s.name.toLowerCase().includes(query.toLowerCase()),
    )
    .slice(0, 12);

  function go(sym: string) {
    router.push(`/backtest?symbol=${sym}`);
    onClose();
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      if (filtered[cursor]) go(filtered[cursor].symbol);
    } else if (e.key === 'Escape') {
      onClose();
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '15vh',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          width: 400,
          maxHeight: 400,
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'var(--font-mono)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--color-accent)' }}>go-to-symbol</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
            onKeyDown={handleKey}
            placeholder="type symbol or name..."
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
            }}
          />
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: '12px' }}>no matches</div>
          ) : (
            filtered.map((s, i) => (
              <div
                key={s.symbol}
                onClick={() => go(s.symbol)}
                style={{
                  padding: '5px 12px',
                  cursor: 'pointer',
                  background: i === cursor ? 'var(--bg-panel-header)' : 'transparent',
                  display: 'flex',
                  gap: 12,
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <span style={{ color: 'var(--color-accent)', fontWeight: 600, minWidth: 80 }}>{s.symbol}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
