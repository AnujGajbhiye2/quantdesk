'use client';

import { Suspense, useEffect, useState, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import DublinClock from '@/components/primitives/DublinClock';
import AppHeader from '@/components/primitives/AppHeader';
import { fmtDate } from '@/core/format/date';
import InfoTip from '@/components/primitives/InfoTip';
import { gloss, type GlossaryKey } from '@/core/glossary';
import type { CompareRow } from '@/app/api/compare/route';
import { DataTable } from '@/components/table/DataTable';
import type { ColumnDef } from '@tanstack/react-table';
import ResearchTabs, { saveLastSymbol, getLastSymbol } from '@/components/primitives/ResearchTabs';

type GlossCol = { label: string; title: string; glossKey?: GlossaryKey };

const COL_META: Record<string, GlossCol> = {
  name:           { label: 'STRATEGY',  title: 'strategy name - click row to open in backtest' },
  totalReturnPct: { label: 'RETURN %',  title: 'total return over the tested window',            glossKey: 'totalReturn' },
  winRate:        { label: 'WIN RATE',  title: 'share of closed trades that made money',          glossKey: 'winRate' },
  sharpe:         { label: 'SHARPE',    title: 'risk-adjusted return, annualised, rf=0',          glossKey: 'sharpe' },
  maxDrawdownPct: { label: 'MAX DD',    title: 'worst peak-to-trough equity drop',                glossKey: 'maxDrawdown' },
  numTrades:      { label: 'TRADES',    title: 'closed trades - below ~15 the stats mean little', glossKey: 'numTrades' },
  profitFactor:   { label: 'P-FACTOR',  title: 'gross wins / gross losses; >1 = net winner',     glossKey: 'profitFactor' },
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function ComparePageInner() {
  const searchParams = useSearchParams();
  const router       = useRouter();

  const [symbol,  setSymbol]  = useState(searchParams.get('symbol') ?? '');
  const [rows,    setRows]    = useState<CompareRow[]>([]);
  const [range,   setRange]   = useState<{ from: string; to: string } | null>(null);
  const [benchmark, setBenchmark] = useState<{ symbol: string; totalReturnPct: number | null } | null>(null);
  const [status,  setStatus]  = useState('');
  const [busy,       setBusy]       = useState(false);
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
        benchmark?: { symbol: string; totalReturnPct: number | null };
        durationMs?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      setRows(data.rows ?? []);
      setRange(data.range ?? null);
      setBenchmark(data.benchmark ?? null);
      setStatus(`${(data.rows ?? []).length} strategies compared in ${data.durationMs}ms`);
      saveLastSymbol(s);
    } catch (err) {
      setStatus(`error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  // Auto-run when arriving with ?symbol= (also re-fires when the shared
  // research search box navigates here with a new one), else fall back to
  // the last symbol searched.
  const urlSymbolParam = searchParams.get('symbol');
  useEffect(() => {
    const urlSym = urlSymbolParam ?? getLastSymbol();
    if (urlSym) { setSymbol(urlSym); void runCompare(urlSym); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSymbolParam]);

  const columns = useMemo<ColumnDef<CompareRow, unknown>[]>(() => [
    {
      accessorKey: 'name',
      header: () => <span title={COL_META.name.title}>{COL_META.name.label}</span>,
      cell: ({ row }) => (
        <span>
          {row.original.name}
          {row.original.error && <span style={{ color: 'var(--color-down)', marginLeft: 8 }}>failed</span>}
        </span>
      ),
      meta: { accent: true },
    },
    {
      accessorKey: 'totalReturnPct',
      sortingFn: 'basic',
      header: () => <span title={COL_META.totalReturnPct.title}>{COL_META.totalReturnPct.label}{COL_META.totalReturnPct.glossKey && <InfoTip term={gloss(COL_META.totalReturnPct.glossKey).term} text={gloss(COL_META.totalReturnPct.glossKey).text} />}</span>,
      cell: ({ getValue }) => {
        const v = getValue() as number | null;
        const color = v == null || !isFinite(v) ? 'var(--text-muted)' : v >= 0 ? 'var(--color-up)' : 'var(--color-down)';
        return <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>{v == null || !isFinite(v) ? '--' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`}</span>;
      },
      meta: { numeric: true },
    },
    {
      accessorKey: 'winRate',
      sortingFn: 'basic',
      header: () => <span title={COL_META.winRate.title}>{COL_META.winRate.label}{COL_META.winRate.glossKey && <InfoTip term={gloss(COL_META.winRate.glossKey).term} text={gloss(COL_META.winRate.glossKey).text} />}</span>,
      cell: ({ getValue }) => {
        const v = getValue() as number | null;
        return v != null && isFinite(v) ? `${(v * 100).toFixed(0)}%` : '--';
      },
      meta: { numeric: true },
    },
    {
      accessorKey: 'sharpe',
      sortingFn: 'basic',
      header: () => <span title={COL_META.sharpe.title}>{COL_META.sharpe.label}{COL_META.sharpe.glossKey && <InfoTip term={gloss(COL_META.sharpe.glossKey).term} text={gloss(COL_META.sharpe.glossKey).text} />}</span>,
      cell: ({ getValue }) => {
        const v = getValue() as number | null;
        const color = v == null || !isFinite(v) ? 'var(--text-muted)' : v >= 0 ? 'var(--color-up)' : 'var(--color-down)';
        return <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>{v == null || !isFinite(v) ? '--' : v.toFixed(2)}</span>;
      },
      meta: { numeric: true },
    },
    {
      accessorKey: 'maxDrawdownPct',
      sortingFn: 'basic',
      header: () => <span title={COL_META.maxDrawdownPct.title}>{COL_META.maxDrawdownPct.label}{COL_META.maxDrawdownPct.glossKey && <InfoTip term={gloss(COL_META.maxDrawdownPct.glossKey).term} text={gloss(COL_META.maxDrawdownPct.glossKey).text} />}</span>,
      cell: ({ getValue }) => {
        const v = getValue() as number | null;
        return <span style={{ color: 'var(--color-down)', fontVariantNumeric: 'tabular-nums' }}>{v != null && isFinite(v) ? `-${v.toFixed(1)}%` : '--'}</span>;
      },
      meta: { numeric: true },
    },
    {
      accessorKey: 'numTrades',
      sortingFn: 'basic',
      header: () => <span title={COL_META.numTrades.title}>{COL_META.numTrades.label}{COL_META.numTrades.glossKey && <InfoTip term={gloss(COL_META.numTrades.glossKey).term} text={gloss(COL_META.numTrades.glossKey).text} />}</span>,
      cell: ({ getValue }) => {
        const v = getValue() as number;
        const muted = v < 15;
        return <span style={{ color: muted ? 'var(--text-muted)' : undefined, fontVariantNumeric: 'tabular-nums' }} title={muted ? 'fewer than 15 trades - treat stats as noise' : undefined}>{v}</span>;
      },
      meta: { numeric: true },
    },
    {
      accessorKey: 'profitFactor',
      sortingFn: 'basic',
      header: () => <span title={COL_META.profitFactor.title}>{COL_META.profitFactor.label}{COL_META.profitFactor.glossKey && <InfoTip term={gloss(COL_META.profitFactor.glossKey).term} text={gloss(COL_META.profitFactor.glossKey).text} />}</span>,
      cell: ({ getValue }) => {
        const v = getValue() as number | null;
        if (v == null || !isFinite(v)) return '--';
        const color = v >= 1 ? 'var(--color-up)' : 'var(--color-down)';
        return <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>{v >= 9999 ? 'inf' : v.toFixed(2)}</span>;
      },
      meta: { numeric: true },
    },
  ], []);

  return (
    <div className="flex flex-col h-full" style={{ minHeight: '100vh' }}>
      <AppHeader right={<DublinClock />} />
      <ResearchTabs symbol={symbol} />

      {/* Page-specific toolbar: re-run + status, not global nav */}
      <div
        className="flex items-center gap-3 px-4 py-1 flex-wrap shrink-0"
        style={{ background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)' }}
      >
        {symbol && <span style={{ color: 'var(--color-accent)', fontSize: 'var(--fs-xs)', fontWeight: 700 }}>{symbol}</span>}
        <button
          type="button"
          onClick={() => void runCompare()}
          disabled={busy || !symbol}
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
          {busy ? 'RUNNING...' : 'RE-RUN'}
        </button>
        {status && (
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {status}
          </span>
        )}
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
            Tested window: {fmtDate(range.from)} to {fmtDate(range.to)}.
          </span>
        )}
        {benchmark && benchmark.totalReturnPct != null && (
          <span style={{ marginLeft: 8 }} title="Buy-and-hold return of the S&P 500 (^GSPC) over the same tested window - a strategy beating this with less drawdown is doing something; one that doesn't isn't worth the complexity.">
            {benchmark.symbol} buy-and-hold over the same window:{' '}
            <span style={{
              color: benchmark.totalReturnPct >= 0 ? 'var(--color-up)' : 'var(--color-down)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {benchmark.totalReturnPct >= 0 ? '+' : ''}{benchmark.totalReturnPct.toFixed(1)}%
            </span>.
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
          {Object.entries(COL_META).filter(([, c]) => c.glossKey).map(([key, c]) => {
            const g = gloss(c.glossKey!);
            return (
              <div key={key}>
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
        {rows.length === 0 ? (
          <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-mono)' }}>
            {busy ? 'Running every strategy...' : 'Enter a symbol to compare all strategies on it.'}
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={rows}
            enableSorting
            defaultSort={[{ id: 'totalReturnPct', desc: true }]}
            rowStyle={(row) => ({ opacity: row.error ? 0.45 : 1 })}
            onRowClick={(row) => router.push(`/backtest?symbol=${symbol}&strategy=${row.strategyId}`)}
          />
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
