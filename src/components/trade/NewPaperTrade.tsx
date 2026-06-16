'use client';

import { useState } from 'react';
import type { PaperTrade } from '@/core/types';

interface Props {
  onOpened: (trade: PaperTrade) => void;
}

const inputStyle: React.CSSProperties = {
  background:   'var(--bg-panel)',
  border:       '1px solid var(--border)',
  color:        'var(--text-primary)',
  fontFamily:   'var(--font-mono)',
  fontSize:     'var(--fs-sm)',
  padding:      '3px 8px',
  width:        '100%',
};

const labelStyle: React.CSSProperties = {
  color:        'var(--text-muted)',
  fontSize:     'var(--fs-xs)',
  letterSpacing: '0.06em',
  display:      'block',
  marginBottom: 2,
};

const colStyle: React.CSSProperties = {
  display:       'flex',
  flexDirection: 'column',
  gap:           2,
  minWidth:      80,
};

export default function NewPaperTrade({ onOpened }: Props) {
  const [symbol,    setSymbol]    = useState('');
  const [side,      setSide]      = useState<'long' | 'short'>('long');
  const [orderType, setOrderType] = useState<'limit' | 'market'>('limit');
  const [qty,       setQty]       = useState('');
  const [entry,     setEntry]     = useState('');
  const [stop,      setStop]      = useState('');
  const [target,    setTarget]    = useState('');
  const [status,    setStatus]    = useState('');
  const [busy,      setBusy]      = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!symbol || !qty || !entry) {
      setStatus('symbol, qty, and entry price required');
      return;
    }

    const entryNum = parseFloat(entry);
    const qtyNum   = parseFloat(qty);
    const stopNum  = stop   ? parseFloat(stop)   : undefined;
    const targetNum = target ? parseFloat(target) : undefined;

    if (isNaN(entryNum) || isNaN(qtyNum)) {
      setStatus('invalid number');
      return;
    }

    setBusy(true);
    setStatus('opening...');
    try {
      const res = await fetch('/api/paper', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          action:      'open',
          orderType,
          strategyId:  'manual',
          symbol:      symbol.toUpperCase(),
          side,
          entryPrice:  entryNum,
          entryTime:   new Date().toISOString().slice(0, 10),
          qty:         qtyNum,
          stopPrice:   stopNum,
          targetPrice: targetNum,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { trade: PaperTrade; orderType: string };
      const verb = data.orderType === 'limit' ? `pending @ ${entryNum}` : 'opened';
      setStatus(`${verb}: ${side.toUpperCase()} ${symbol.toUpperCase()} x${qtyNum}`);
      setSymbol(''); setQty(''); setEntry(''); setStop(''); setTarget('');
      onOpened(data.trade);
    } catch (err) {
      setStatus(`error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display:        'flex',
        gap:            8,
        alignItems:     'flex-end',
        flexWrap:       'wrap',
        padding:        '8px 16px',
        background:     'var(--bg-panel-header)',
        borderBottom:   '1px solid var(--border)',
      }}
    >
      <div style={{ ...colStyle, minWidth: 90 }}>
        <label style={labelStyle}>SYMBOL</label>
        <input
          style={inputStyle}
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="AAPL"
        />
      </div>

      <div style={colStyle}>
        <label style={labelStyle}>SIDE</label>
        <select
          style={inputStyle}
          value={side}
          onChange={(e) => setSide(e.target.value as 'long' | 'short')}
        >
          <option value="long">LONG</option>
          <option value="short">SHORT</option>
        </select>
      </div>

      <div style={colStyle}>
        <label style={labelStyle}>ORDER</label>
        <select
          style={inputStyle}
          value={orderType}
          onChange={(e) => setOrderType(e.target.value as 'limit' | 'market')}
          title="LIMIT: pending until market hits entry price | MARKET: fill immediately"
        >
          <option value="limit">LIMIT</option>
          <option value="market">MARKET</option>
        </select>
      </div>

      <div style={colStyle}>
        <label style={labelStyle}>QTY</label>
        <input
          style={inputStyle}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="10"
          type="number"
          step="any"
          min="0"
        />
      </div>

      <div style={colStyle}>
        <label style={labelStyle}>ENTRY PRICE</label>
        <input
          style={inputStyle}
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          placeholder="150.00"
          type="number"
          step="any"
          min="0"
        />
      </div>

      <div style={colStyle}>
        <label style={labelStyle}>STOP PRICE</label>
        <input
          style={inputStyle}
          value={stop}
          onChange={(e) => setStop(e.target.value)}
          placeholder="optional"
          type="number"
          step="any"
          min="0"
        />
      </div>

      <div style={colStyle}>
        <label style={labelStyle}>TARGET PRICE</label>
        <input
          style={inputStyle}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="optional"
          type="number"
          step="any"
          min="0"
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <label style={{ ...labelStyle, visibility: 'hidden' }}>.</label>
        <button
          type="submit"
          disabled={busy}
          style={{
            background: 'var(--bg-panel)',
            border:     '1px solid var(--color-accent)',
            color:      'var(--color-accent)',
            fontFamily: 'var(--font-mono)',
            fontSize:   'var(--fs-sm)',
            padding:    '3px 16px',
            cursor:     'pointer',
            fontWeight: 600,
          }}
        >
          {busy ? '...' : 'OPEN TRADE'}
        </button>
      </div>

      {status && (
        <span style={{ color: status.startsWith('error') ? 'var(--color-down)' : 'var(--color-accent)', fontSize: 'var(--fs-xs)', alignSelf: 'center' }}>
          {status}
        </span>
      )}
    </form>
  );
}
