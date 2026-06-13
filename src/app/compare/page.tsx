'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import DublinClock from '@/components/primitives/DublinClock';
import SymbolTypeahead from '@/components/primitives/SymbolTypeahead';
import InfoTip from '@/components/primitives/InfoTip';
import { gloss, type GlossaryKey } from '@/core/glossary';
import type { CompareRow } from '@/app/api/compare/route';

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

type SortKey =
  | 'name'
  | 'totalReturnPct'
  | 'winRate'
  | 'sharpe'
  | 'maxDrawdownPct'
  | 'numTrades'
  | 'profitFactor';

const COLUMNS: Array<{ key: SortKey; label: string; title: string; glossKey?: GlossaryKey }> = [
  { key: 'name',           label: 'STRATEGY',  title: 'strategy name - click row to open in backtest' },
  { key: 'totalReturnPct', label: 'RETURN %',  title: 'total return over the tested window', glossKey: 'totalReturn' },
  { key: 'winRate',        label: 'WIN RATE',  title: 'share of closed trades that made money', glossKey: 'winRate' },
  { key: 'sharpe',         label: 'SHARPE',    title: 'risk-adjusted return, annualised, rf=0', glossKey: 'sharpe' },
  { key: 'maxDrawdownPct', label: 'MAX DD',    title: 'worst peak-to-trough equity drop', glossKey: 'maxDrawdown' },
  { key: 'numTrades',      label: 'TRADES',    title: 'closed trades - below ~15 the stats mean little', glossKey: 'numTrades' },
  { key: 'profitFactor',   label: 'P-FACTOR',  title: 'gross wins / gross losses; >1 = net winner', glossKey: 'profitFactor' },
];

function sortRows(rows: CompareRow[], key: SortKey, dir: 1 | -1): CompareRow[] {
  return [...rows].sort((a, b) => {
    if (key === 'name') return dir * a.name.localeCompare(b.name);
    const av = a[key];
    const bv = b[key];
    // Errored rows (null/NaN metrics) always sink to the bottom
    const aBad = av == null || !isFinite(av as number);
    const bBad = bv == null || !isFinite(bv as number);
    if (aBad && bBad) return 0;
    if (aBad) return 1;
    if (bBad) return -1;
    return dir * ((av as number) - (bv as number));
  });
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function pct(v: number | null, digits = 1): string {
  if (v == null || !isFinite(v)) return '--';
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

function num(v: number | null, digits = 2): string {
  if (v == null || !isFinite(v)) return '--';
  return v.toFixed(digits);
}

function signColor(v: number | null): string {
  if (v == null || !isFinite(v)) return 'var(--text-muted)';
  return v >= 0 ? 'var(--color-up)' : 'var(--color-down)';
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function ComparePageInner() {
  const searchParams = useSearchParams();
  const router       = useRouter();

  const [symbol,  setSymbol]  = useState(searchParams.get('symbol') ?? '');
  const [rows,    setRows]    = useState<CompareRow[]>([]);
  const [range,   setRange]   = useState<{ from: string; to: string } | null>(null);
  const [status,  setStatus]  = useState('');
  const [busy,    setBusy]    = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('totalReturnPct');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [legendOpen, setLegendOpen] = useState(false);

  async function runCompare(sym?: string) {
    const s = (sym ?? symbol).trim().toUpperCase();
    if (!s) { setStatus('enter a symbol'); return; }
    setBusy(true);
    setStatus(`running every strategy on ${s}...`);
    setRows([]);
    setRange(null);
    try {
      const res  = await fetch('/api/compare', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ symbol: s }),
      });
      const data = (await res.json()) as {
        rows?: CompareRow[];
        range?: { from: string; to: string };
        durationMs?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      setRows(data.rows ?? []);
      setRange(data.range ?? null);
      setStatus(`${(data.rows ?? []).length} strategies compared in ${data.durationMs}ms`);
    } catch (err) {
      setStatus(`error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  // Auto-run when arriving with ?symbol=
  useEffect(() => {
    const urlSym = searchParams.get('symbol');
    if (urlSym) void runCompare(urlSym);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clickHeader(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      // Numbers default to descending (best first); names ascending
      setSortDir(key === 'name' ? 1 : -1);
    }
  }

  const sorted = sortRows(rows, sortKey, sortDir);

  return (
    <div className="flex flex-col h-full" style={{ minHeight: '100vh' }}>
      {/* Status bar */}
      <div
        className="flex items-center justify-between px-4 py-2 shrink-0 gap-4"
        style={{ background: 'var(--bg-panel-header)', borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-4 shrink-0">
          <span style={{ color: 'var(--color-accent)', fontWeight: 700, letterSpacing: '0.1em', fontSize: 'var(--fs-sm)' }}>
            QUANTDESK
          </span>
          <nav className="flex gap-3" style={{ fontSize: 'var(--fs-xs)' }}>
            <a href="/" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>DASH</a>
            <a href="/backtest" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>BACKTEST</a>
            <a href="/compare" style={{ color: 'var(--color-accent)', textDecoration: 'none' }}>COMPARE</a>
            <a href="/paper" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>PAPER</a>
            <a href="/journal" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>JOURNAL</a>
          </nav>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); void runCompare(); }}
          className="flex items-center gap-3 flex-1"
          style={{ minWidth: 0 }}
        >
          <SymbolTypeahead
            value={symbol}
            onChange={setSymbol}
            onPick={(sym) => void runCompare(sym)}
            autoFocus
          />
          <button
            type="submit"
            disabled={busy}
            style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--color-accent)',
              color: 'var(--color-accent)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--fs-xs)',
              padding: '3px 12px',
              cursor: busy ? 'wait' : 'pointer',
              fontWeight: 700,
            }}
          >
            {busy ? 'RUNNING...' : 'COMPARE'}
          </button>
          {status && (
            <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {status}
            </span>
          )}
        </form>

        <DublinClock />
      </div>

      {/* Explainer */}
      <div
        className="px-4 py-1 shrink-0"
        style={{
          background: 'var(--bg-panel-header)',
          borderBottom: '1px solid var(--border)',
          color: 'var(--text-muted)',
          fontSize: 'var(--fs-xs)',
        }}
      >
        Every registered strategy backtested on one symbol with identical costs, fills and the max-hold cap - sort any column, click a row to inspect that strategy in the backtest view.
        {range && (
          <span style={{ marginLeft: 8 }}>
            Tested window: {range.from.slice(0, 10)} to {range.to.slice(0, 10)}.
          </span>
        )}
        <button
          onClick={() => setLegendOpen((o) => !o)}
          style={{
            marginLeft: 12,
            background: 'none',
            border: '1px solid var(--border)',
            color: 'var(--color-accent)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-xs)',
            padding: '0 8px',
            cursor: 'pointer',
          }}
        >
          {legendOpen ? 'hide' : 'what do these columns mean?'}
        </button>
      </div>

      {/* Column glossary - plain language, opened on demand */}
      {legendOpen && (
        <div
          className="px-4 py-2 shrink-0"
          style={{
            background: 'var(--bg-panel)',
            borderBottom: '1px solid var(--border)',
            fontSize: 'var(--fs-xs)',
            fontFamily: 'var(--font-mono)',
            color: 'var(--text-primary)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: '8px 24px',
          }}
        >
          {COLUMNS.filter((c) => c.glossKey).map((c) => {
            const g = gloss(c.glossKey!);
            return (
              <div key={c.key}>
                <span style={{ color: 'var(--color-accent)', fontWeight: 700 }}>{c.label}</span>
                <span style={{ color: 'var(--text-muted)' }}> - {g.term}</span>
                <div style={{ color: 'var(--text-muted)', whiteSpace: 'pre-line', marginTop: 2 }}>{g.text}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Results table */}
      <div className="flex-1 overflow-auto" style={{ background: 'var(--bg-panel)' }}>
        {sorted.length === 0 ? (
          <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-mono)' }}>
            {busy ? 'Running every strategy...' : 'Enter a symbol to compare all strategies on it.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-mono)' }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--bg-panel-header)' }}>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => clickHeader(col.key)}
                    title={`${col.title} - click to sort`}
                    style={{
                      textAlign: col.key === 'name' ? 'left' : 'right',
                      padding: '4px 10px',
                      fontWeight: sortKey === col.key ? 700 : 400,
                      color: sortKey === col.key ? 'var(--color-accent)' : 'var(--text-muted)',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      userSelect: 'none',
                    }}
                  >
                    {col.label}{sortKey === col.key ? (sortDir === -1 ? ' v' : ' ^') : ''}
                    {col.glossKey && (
                      <InfoTip term={gloss(col.glossKey).term} text={gloss(col.glossKey).text} />
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr
                  key={row.strategyId}
                  onClick={() => router.push(`/backtest?symbol=${symbol}&strategy=${row.strategyId}`)}
                  title={row.error ? `failed: ${row.error}` : `open ${row.name} on ${symbol} in backtest`}
                  style={{
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                    opacity: row.error ? 0.45 : 1,
                  }}
                >
                  <td style={{ padding: '4px 10px', color: 'var(--color-accent)', fontWeight: 600 }}>
                    {row.name}
                    {row.error && <span style={{ color: 'var(--color-down)', marginLeft: 8 }}>failed</span>}
                  </td>
                  <td style={{ padding: '4px 10px', textAlign: 'right', color: signColor(row.totalReturnPct), fontVariantNumeric: 'tabular-nums' }}>
                    {pct(row.totalReturnPct)}
                  </td>
                  <td style={{ padding: '4px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {row.winRate != null && isFinite(row.winRate) ? `${(row.winRate * 100).toFixed(0)}%` : '--'}
                  </td>
                  <td style={{ padding: '4px 10px', textAlign: 'right', color: signColor(row.sharpe), fontVariantNumeric: 'tabular-nums' }}>
                    {num(row.sharpe)}
                  </td>
                  <td style={{ padding: '4px 10px', textAlign: 'right', color: 'var(--color-down)', fontVariantNumeric: 'tabular-nums' }}>
                    {row.maxDrawdownPct != null && isFinite(row.maxDrawdownPct) ? `-${row.maxDrawdownPct.toFixed(1)}%` : '--'}
                  </td>
                  <td style={{ padding: '4px 10px', textAlign: 'right', color: row.numTrades < 15 ? 'var(--text-muted)' : undefined, fontVariantNumeric: 'tabular-nums' }}
                      title={row.numTrades < 15 ? 'fewer than 15 trades - treat stats as noise' : undefined}>
                    {row.numTrades}
                  </td>
                  <td style={{ padding: '4px 10px', textAlign: 'right', color: signColor(row.profitFactor != null ? row.profitFactor - 1 : null), fontVariantNumeric: 'tabular-nums' }}>
                    {row.profitFactor != null && isFinite(row.profitFactor)
                      ? (row.profitFactor >= 9999 ? 'inf' : row.profitFactor.toFixed(2))
                      : '--'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Disclaimer */}
      <div
        className="px-4 py-1 shrink-0 text-center"
        style={{
          background: 'var(--bg-base)',
          borderTop: '1px solid var(--border)',
          color: 'var(--text-muted)',
          fontSize: 'var(--fs-xs)',
          letterSpacing: '0.04em',
        }}
      >
        Research tool. Not financial advice. Results hypothetical.
      </div>
    </div>
  );
}

export default function ComparePage() {
  return (
    <Suspense>
      <ComparePageInner />
    </Suspense>
  );
}
