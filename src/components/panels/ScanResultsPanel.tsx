'use client';

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { List, useListRef, type RowComponentProps } from 'react-window';
import { useRouter } from 'next/navigation';
import Sparkline from '@/components/primitives/Sparkline';
import { fmtMoney } from '@/core/format/currency';
import type { MarketRow } from '@/core/market/snapshot';
import { fetchErrorMessage } from '@/core/format/apiError';

export interface PlaceholderSymbol {
  symbol:     string;
  name:       string;
  assetClass: string;
  currency:   string;
  exchange?:  string;
  providerId: string;
}

export type ScanSortKey = 'symbol' | 'name' | 'last' | 'chg' | 'vol';

interface ScanResultsPanelProps {
  rows:          MarketRow[];
  selected:      number;
  placeholders?: PlaceholderSymbol[];
  onIngestDone?: () => void;
  sort?: { click: (key: ScanSortKey) => void; indicator: (key: ScanSortKey) => string };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number, dec = 2) {
  return isFinite(n) ? n.toFixed(dec) : '--';
}

function fmtVol(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000)     return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)         return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}

function fmtAsOf(row: MarketRow): string {
  if (row.priceSource === 'quote' && row.quoteTime) {
    return `Q ${row.quoteTime.slice(11, 16)}`;
  }
  return row.latestTime;
}

function isLiveBar(row: MarketRow): boolean {
  return row.latestTime.slice(0, 10) === new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Column layout - same widths for header row and virtualized rows
// ---------------------------------------------------------------------------

const ROW_HEIGHT = 26;

// px widths; name column gets flex: 1 to fill remaining space
const COL = {
  symbol: 80,
  last:   90,
  asof:   80,
  chg:    68,
  vol:    68,
  spark:  72,
};

const cellBase: React.CSSProperties = { padding: '0 6px', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', boxSizing: 'border-box' };

// ---------------------------------------------------------------------------
// Virtual row types
// ---------------------------------------------------------------------------

type ListRow =
  | { kind: 'data';        row: MarketRow;        idx: number }
  | { kind: 'placeholder'; sym: PlaceholderSymbol };

interface RowData {
  listRows:     ListRow[];
  selected:     number;
  ingesting:    string | null;
  handleIngest: (sym: PlaceholderSymbol) => void;
  router:       ReturnType<typeof useRouter>;
}

// ---------------------------------------------------------------------------
// Row renderer (react-window v2 passes index + style + rowProps)
// ---------------------------------------------------------------------------

function RowRenderer({
  index,
  style,
  listRows,
  selected,
  ingesting,
  handleIngest,
  router,
}: RowComponentProps<RowData>) {
  const item = listRows[index];
  const base: React.CSSProperties = {
    ...style,
    display:     'flex',
    alignItems:  'center',
    borderBottom: '1px solid var(--border)',
    boxSizing:   'border-box',
    fontSize:    'var(--fs-sm)',
  };

  if (item.kind === 'placeholder') {
    const { sym } = item;
    const busy = ingesting === sym.symbol;
    return (
      <div style={{ ...base, opacity: 0.45 }}>
        <span style={{ ...cellBase, width: COL.symbol, color: 'var(--text-muted)', fontWeight: 600 }}>{sym.symbol}</span>
        <span style={{ ...cellBase, flex: 1, color: 'var(--text-muted)' }}>{sym.name}</span>
        <span style={{ ...cellBase, width: COL.last,  justifyContent: 'flex-end', color: 'var(--text-muted)' }}>--</span>
        <span style={{ ...cellBase, width: COL.asof,  color: 'var(--text-muted)' }}>--</span>
        <span style={{ ...cellBase, width: COL.chg,   justifyContent: 'flex-end', color: 'var(--text-muted)' }}>--</span>
        <span style={{ ...cellBase, width: COL.vol,   justifyContent: 'flex-end', color: 'var(--text-muted)' }}>--</span>
        <span style={{ ...cellBase, width: COL.spark, justifyContent: 'flex-end' }}>
          <button
            onClick={(e) => { e.stopPropagation(); handleIngest(sym); }}
            disabled={busy}
            style={{
              background: 'transparent', border: '1px solid var(--border)',
              color: 'var(--color-accent)', fontFamily: 'var(--font-mono)',
              fontSize: 'var(--fs-xs)', padding: '1px 6px',
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            {busy ? '...' : '+ ingest'}
          </button>
        </span>
      </div>
    );
  }

  const { row, idx } = item;
  const isSelected = idx === selected;
  const chgColor   = row.changePct >= 0 ? 'var(--color-up)' : 'var(--color-down)';
  return (
    <div
      onClick={() => router.push(`/backtest?symbol=${row.symbol}`)}
      style={{ ...base, cursor: 'pointer', background: isSelected ? 'var(--bg-panel-header)' : 'transparent' }}
    >
      <span style={{ ...cellBase, width: COL.symbol, color: 'var(--color-accent)', fontWeight: 600 }}>{row.symbol}</span>
      <span style={{ ...cellBase, flex: 1, color: 'var(--text-muted)' }}>{row.name}</span>
      <span style={{ ...cellBase, width: COL.last, justifyContent: 'flex-end', fontVariantNumeric: 'tabular-nums' }}>
        {fmtMoney(row.last, row.currency)}
      </span>
      <span style={{ ...cellBase, width: COL.asof, color: row.priceSource === 'quote' ? 'var(--color-accent)' : 'var(--text-muted)', fontSize: 'var(--fs-xs)', gap: 4 }}>
        {fmtAsOf(row)}
        {isLiveBar(row) && (
          <span title="today's bar is still forming - signals use closed bars only" style={{ color: 'var(--color-accent)', fontWeight: 700, letterSpacing: '0.06em' }}>
            LIVE
          </span>
        )}
      </span>
      <span style={{ ...cellBase, width: COL.chg, justifyContent: 'flex-end', color: chgColor }}>
        {row.changePct >= 0 ? '+' : ''}{fmt(row.changePct)}%
      </span>
      <span style={{ ...cellBase, width: COL.vol, justifyContent: 'flex-end', color: 'var(--text-muted)' }}>
        {fmtVol(row.volume)}
      </span>
      <span style={{ ...cellBase, width: COL.spark, justifyContent: 'flex-end' }}>
        <Sparkline data={row.spark} width={60} height={18} />
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

function ScanResultsPanel({ rows, selected, placeholders = [], onIngestDone, sort }: ScanResultsPanelProps) {
  const router   = useRouter();
  const listRef  = useListRef(null);

  const [ingesting,   setIngesting]   = useState<string | null>(null);
  const [ingestError, setIngestError] = useState<string | null>(null);

  // Scroll selected row into view when selection changes
  useEffect(() => {
    if (selected >= 0 && selected < rows.length) {
      listRef.current?.scrollToRow({ index: selected, align: 'smart' });
    }
  }, [selected, rows.length]);

  const handleIngest = useCallback(async (sym: PlaceholderSymbol) => {
    setIngesting(sym.symbol);
    setIngestError(null);
    try {
      const res = await fetch('/api/ingest', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          mode:     'full',
          universe: [{
            symbol:     sym.symbol,
            name:       sym.name,
            assetClass: sym.assetClass,
            currency:   sym.currency,
            exchange:   sym.exchange,
            providerId: sym.providerId,
          }],
        }),
      });
      if (!res.ok) throw new Error(await fetchErrorMessage(res));
      onIngestDone?.();
    } catch (err) {
      setIngestError(err instanceof Error ? err.message : 'ingest failed');
    } finally {
      setIngesting(null);
    }
  }, [onIngestDone]);

  const listRows: ListRow[] = useMemo(() => [
    ...rows.map((row, idx) => ({ kind: 'data' as const, row, idx })),
    ...placeholders.map((sym) => ({ kind: 'placeholder' as const, sym })),
  ], [rows, placeholders]);

  const rowProps: RowData = { listRows, selected, ingesting, handleIngest, router };

  const totalCount = rows.length + placeholders.length;

  const th = (key: ScanSortKey, label: string, widthOrFlex: number | 'flex', align: 'left' | 'right') => {
    const isSortable = !!sort;
    const indicator  = sort ? sort.indicator(key) : '';
    const onClick    = isSortable ? () => sort!.click(key) : undefined;
    const style: React.CSSProperties = {
      ...cellBase,
      ...(widthOrFlex === 'flex' ? { flex: 1 } : { width: widthOrFlex }),
      justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
      fontWeight:     indicator ? 700 : 400,
      cursor:         isSortable ? 'pointer' : undefined,
      userSelect:     'none',
      color:          'var(--text-muted)',
    };
    return (
      <span key={key} onClick={onClick} style={style}>
        {label}{indicator}
      </span>
    );
  };

  return (
    <div
      className="flex flex-col overflow-hidden h-full"
      style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)' }}
    >
      {/* Panel header */}
      <div
        className="flex items-center justify-between px-3 py-1 shrink-0"
        style={{ background: 'var(--bg-panel-header)', borderBottom: '1px solid var(--border)', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', letterSpacing: '0.08em' }}
      >
        <span title="Your tracked universe with latest prices. Click any row to backtest it. Click headers to sort.">
          TOP MOMENTUM / SCAN RESULTS
        </span>
        <span>{rows.length} ingested{placeholders.length > 0 ? ` + ${placeholders.length} available` : ''}</span>
      </div>

      {ingestError && (
        <div className="shrink-0" style={{ padding: '2px 8px', fontSize: 'var(--fs-xs)', color: 'var(--color-down)' }}>
          {ingestError}
        </div>
      )}

      {totalCount === 0 ? (
        <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
          - no data - run: scan --strategy=rsi-reversion
        </div>
      ) : (
        <>
          {/* Column header row */}
          <div
            className="shrink-0 flex items-center"
            style={{ borderBottom: '1px solid var(--border)', height: ROW_HEIGHT, fontSize: 'var(--fs-sm)' }}
          >
            {th('symbol', 'SYMBOL', COL.symbol, 'left')}
            {th('name',   'NAME',   'flex',      'left')}
            {th('last',   'LAST',   COL.last,    'right')}
            <span style={{ ...cellBase, width: COL.asof, color: 'var(--text-muted)' }}>AS OF</span>
            {th('chg', 'CHG%', COL.chg, 'right')}
            {th('vol', 'VOL',  COL.vol, 'right')}
            <span style={{ ...cellBase, width: COL.spark, justifyContent: 'flex-end', color: 'var(--text-muted)' }}>SPARK</span>
          </div>

          {/* Virtualized body */}
          <div className="flex-1" style={{ overflow: 'hidden', minHeight: 0 }}>
            <List
              listRef={listRef}
              style={{ height: '100%', width: '100%' }}
              rowComponent={RowRenderer}
              rowCount={listRows.length}
              rowHeight={ROW_HEIGHT}
              rowProps={rowProps}
              overscanCount={5}
            />
          </div>
        </>
      )}

      {/* Disclaimer */}
      <div className="shrink-0 px-3 py-1" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
        Research tool - not advice. Click any row to backtest.
      </div>
    </div>
  );
}

export default memo(ScanResultsPanel);
