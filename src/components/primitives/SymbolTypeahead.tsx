'use client';

import { useCallback, useRef, useState } from 'react';

export interface TypeaheadSuggestion {
  symbol: string;
  name:   string;
  inDb?:  boolean;
}

interface Props {
  value:       string;
  onChange:    (value: string) => void;
  /** Called when the user picks a suggestion (click or Enter on a highlighted row). */
  onPick?:     (symbol: string) => void;
  placeholder?: string;
  width?:       number;
  autoFocus?:   boolean;
}

/**
 * Symbol input with /api/search typeahead: local DB symbols first (instant),
 * provider results merged after, "no data" tag on symbols not yet ingested.
 * Arrow keys move the highlight, Enter picks, Escape closes.
 */
export default function SymbolTypeahead({
  value,
  onChange,
  onPick,
  placeholder = 'SYMBOL',
  width = 120,
  autoFocus,
}: Props) {
  const [suggestions, setSuggestions] = useState<TypeaheadSuggestion[]>([]);
  const [cursor, setCursor]           = useState(-1);
  const [open, setOpen]               = useState(false);
  const [searching, setSearching]     = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef    = useRef<HTMLInputElement>(null);

  const fetchSuggestions = useCallback((q: string) => {
    if (q.length < 1) { setSuggestions([]); setOpen(false); setSearching(false); return; }
    setSearching(true);
    setOpen(true);
    fetch(`/api/search?q=${encodeURIComponent(q)}&limit=8`)
      .then((r) => r.json())
      .then((d: { results?: TypeaheadSuggestion[] }) => {
        const results = d.results ?? [];
        setSuggestions(results);
        setOpen(results.length > 0);
        setCursor(-1);
      })
      .catch(() => { setSuggestions([]); setOpen(false); })
      .finally(() => setSearching(false));
  }, []);

  function handleChange(raw: string) {
    const upper = raw.toUpperCase();
    onChange(upper);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(upper), 200);
  }

  function pick(symbol: string) {
    onChange(symbol);
    setOpen(false);
    setSuggestions([]);
    inputRef.current?.focus();
    onPick?.(symbol);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, -1));
    } else if (e.key === 'Enter' && cursor >= 0) {
      e.preventDefault();
      const picked = suggestions[cursor];
      if (picked) pick(picked.symbol);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const dropdownStyle: React.CSSProperties = {
    position:   'absolute',
    top:        '100%',
    left:       0,
    zIndex:     200,
    background: 'var(--bg-panel)',
    border:     '1px solid var(--border)',
    minWidth:   260,
    maxHeight:  220,
    overflowY:  'auto',
  };

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
        placeholder={placeholder}
        autoComplete="off"
        autoFocus={autoFocus}
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-xs)',
          padding: '3px 8px',
          width,
        }}
      />
      {open && searching && suggestions.length === 0 && (
        <div style={{ ...dropdownStyle, padding: '4px 10px', color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', fontFamily: 'var(--font-mono)' }}>
          searching...
        </div>
      )}
      {open && suggestions.length > 0 && (
        <div style={dropdownStyle}>
          {suggestions.map((s, i) => (
            <div
              key={s.symbol}
              onMouseDown={() => pick(s.symbol)}
              style={{
                padding:    '4px 10px',
                cursor:     'pointer',
                background: i === cursor ? 'var(--bg-panel-header)' : 'transparent',
                borderBottom: '1px solid var(--border)',
                display:    'flex',
                gap:        12,
                alignItems: 'baseline',
              }}
            >
              <span style={{ color: 'var(--color-accent)', fontWeight: 600, minWidth: 90, fontSize: 'var(--fs-xs)', fontFamily: 'var(--font-mono)' }}>
                {s.symbol}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {s.name}
              </span>
              {s.inDb === false && (
                <span
                  title="not ingested yet - run ingest before backtesting"
                  style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', fontFamily: 'var(--font-mono)' }}
                >
                  no data
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
