'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { SymbolMeta } from '@/core/types';
import { fetchErrorMessage } from '@/core/format/apiError';

interface LocalSymbol {
  symbol: string;
  name: string;
  assetClass?: SymbolMeta['assetClass'];
  currency?: string;
  exchange?: string;
  providerId?: string;
  inDb?: boolean;
}

interface Props {
  allSymbols: LocalSymbol[];
  onClose:    () => void;
}

type SearchResult = Pick<SymbolMeta, 'symbol' | 'name' | 'assetClass' | 'providerId'>;

interface DisplayItem {
  symbol:   string;
  name:     string;
  inDb:     boolean;
  assetClass?: SymbolMeta['assetClass'];
  currency?: string;
  exchange?: string;
  providerId?: string;
}

export default function GoToSymbolOverlay({ allSymbols, onClose }: Props) {
  const [query,    setQuery]    = useState('');
  const [cursor,   setCursor]   = useState(0);
  const [remote,   setRemote]   = useState<SearchResult[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [status,   setStatus]   = useState('');
  const router                  = useRouter();
  const inputRef                = useRef<HTMLInputElement>(null);
  const debounceRef             = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Local filter
  const localMatches = query.length === 0
    ? allSymbols.slice(0, 12)
    : allSymbols.filter((s) =>
        s.symbol.toLowerCase().includes(query.toLowerCase()) ||
        s.name.toLowerCase().includes(query.toLowerCase()),
      ).slice(0, 12);

  // Merge: local first (inDb=true), then remote results not already local
  const localSymSet = new Set(allSymbols.map((s) => s.symbol.toLowerCase()));
  const remoteOnly  = remote.filter((r) => !localSymSet.has(r.symbol.toLowerCase()));

  const items: DisplayItem[] = [
    ...localMatches.map((s) => ({
      symbol:     s.symbol,
      name:       s.name,
      inDb:       s.inDb ?? true,
      assetClass: s.assetClass,
      currency:   s.currency,
      exchange:   s.exchange,
      providerId: s.providerId,
    })),
    ...remoteOnly.slice(0, Math.max(0, 12 - localMatches.length)).map((r) => ({
      symbol:     r.symbol,
      name:       r.name,
      inDb:       false,
      providerId: r.providerId,
    })),
  ];

  // Debounced remote search
  const doRemoteSearch = useCallback((q: string) => {
    if (q.length < 2) { setRemote([]); return; }
    setLoading(true);
    fetch(`/api/search?q=${encodeURIComponent(q)}&limit=12`)
      .then((r) => r.json())
      .then((d: { results?: SearchResult[] }) => setRemote(d.results ?? []))
      .catch(() => setRemote([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doRemoteSearch(query), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, doRemoteSearch]);

  async function go(item: DisplayItem) {
    if (item.inDb) {
      router.push(`/backtest?symbol=${item.symbol}`);
      onClose();
      return;
    }
    // Not in DB - ingest first, then navigate
    setStatus(`ingesting ${item.symbol}...`);
    try {
      const res = await fetch('/api/ingest', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          mode:     'full',
          universe: [{
            symbol:     item.symbol,
            name:       item.name,
            assetClass: item.assetClass ?? 'equity',
            currency:   item.currency ?? 'USD',
            exchange:   item.exchange,
            // Remote search results always carry providerId (SymbolMeta requires
            // it); the ingest API fails loudly on an unknown provider id.
            providerId: item.providerId,
          }],
        }),
      });
      if (!res.ok) throw new Error(await fetchErrorMessage(res));
      router.push(`/backtest?symbol=${item.symbol}`);
      onClose();
    } catch (err) {
      setStatus(`error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, items.length - 1));
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      if (items[cursor]) void go(items[cursor]);
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
          width: 460,
          maxHeight: 420,
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'var(--font-mono)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--color-accent)', fontSize: 'var(--fs-sm)' }}>go-to-symbol</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setCursor(0); setStatus(''); }}
            onKeyDown={handleKey}
            placeholder="type symbol or name..."
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--fs-base)',
            }}
          />
          {loading && <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>searching...</span>}
        </div>

        {status && (
          <div style={{ padding: '4px 12px', fontSize: 'var(--fs-xs)', color: status.startsWith('error') ? 'var(--color-down)' : 'var(--color-accent)' }}>
            {status}
          </div>
        )}

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {items.length === 0 ? (
            <div style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>no matches</div>
          ) : (
            items.map((item, i) => (
              <div
                key={item.symbol}
                onClick={() => void go(item)}
                style={{
                  padding: '5px 12px',
                  cursor: 'pointer',
                  background: i === cursor ? 'var(--bg-panel-header)' : 'transparent',
                  display: 'flex',
                  gap: 12,
                  alignItems: 'baseline',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <span style={{ color: 'var(--color-accent)', fontWeight: 600, minWidth: 90, fontSize: 'var(--fs-sm)' }}>
                  {item.symbol}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {item.name}
                </span>
                {!item.inDb && (
                  <span style={{ color: 'var(--color-accent)', fontSize: 'var(--fs-xs)', flexShrink: 0 }}>+ ingest</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
