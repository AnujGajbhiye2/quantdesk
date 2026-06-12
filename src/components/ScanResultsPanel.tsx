'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Panel from './Panel';
import Sparkline from './Sparkline';
import EmptyState from './EmptyState';
import { fmtMoney } from '@/core/format/currency';
import type { MarketRow } from '@/core/market/snapshot';

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
  rows:         MarketRow[];
  selected:     number;
  placeholders?: PlaceholderSymbol[];
  onIngestDone?: () => void;
  /** Header-click sorting handlers (state lives in Dashboard so j/k stays aligned). */
  sort?: { click: (key: ScanSortKey) => void; indicator: (key: ScanSortKey) => string };
}

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

/** A stored daily bar dated today is still forming while the market is open. */
function isLiveBar(row: MarketRow): boolean {
  return row.latestTime.slice(0, 10) === new Date().toISOString().slice(0, 10);
}

export default function ScanResultsPanel({ rows, selected, placeholders = [], onIngestDone, sort }: ScanResultsPanelProps) {
  const sortableTh = (key: ScanSortKey, label: string, align: 'left' | 'right') => (
    <th
      onClick={sort ? () => sort.click(key) : undefined}
      title={sort ? 'click to sort' : undefined}
      style={{
        textAlign: align,
        padding: '2px 6px',
        fontWeight: sort && sort.indicator(key) ? 700 : 400,
        cursor: sort ? 'pointer' : undefined,
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {label}{sort ? sort.indicator(key) : ''}
    </th>
  );
  const router = useRouter();
  const [ingesting, setIngesting] = useState<string | null>(null);
  const [ingestError, setIngestError] = useState<string | null>(null);

  async function handleIngest(sym: PlaceholderSymbol) {
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
      if (!res.ok) throw new Error(await res.text());
      onIngestDone?.();
    } catch (err) {
      setIngestError(err instanceof Error ? err.message : 'ingest failed');
    } finally {
      setIngesting(null);
    }
  }

  const totalCount = rows.length + placeholders.length;

  if (totalCount === 0) {
    return (
      <Panel title="TOP MOMENTUM / SCAN RESULTS" className="h-full">
        <EmptyState message="- no data -" hint="run: scan --strategy=rsi-reversion" />
      </Panel>
    );
  }

  return (
    <Panel
      title="TOP MOMENTUM / SCAN RESULTS"
      className="h-full"
      subtitle="Your tracked universe with latest prices. Click any row to backtest it. Click headers to sort."
      info="Your tracked universe: latest close, day change and volume per symbol. LIVE = today's bar still forming (signals only use closed bars). Click a row to backtest it; greyed rows are curated but not ingested yet - one click loads their history."
      headerRight={<span>{rows.length} ingested{placeholders.length > 0 ? ` + ${placeholders.length} available` : ''}</span>}
    >
      {ingestError && (
        <div style={{ padding: '2px 8px', fontSize: 'var(--fs-xs)', color: 'var(--color-down)' }}>
          {ingestError}
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
        <thead>
          <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
            {sortableTh('symbol', 'SYMBOL', 'left')}
            {sortableTh('name', 'NAME', 'left')}
            {sortableTh('last', 'LAST', 'right')}
            <th style={{ textAlign: 'left', padding: '2px 6px', fontWeight: 400 }}>AS OF</th>
            {sortableTh('chg', 'CHG%', 'right')}
            {sortableTh('vol', 'VOL', 'right')}
            <th style={{ textAlign: 'right', padding: '2px 6px', fontWeight: 400 }}>SPARK</th>
          </tr>
        </thead>
        <tbody>
          {/* Ingested rows - full data */}
          {rows.map((row, i) => {
            const isSelected = i === selected;
            const chgColor   = row.changePct >= 0 ? 'var(--color-up)' : 'var(--color-down)';
            return (
              <tr
                key={row.symbol}
                onClick={() => router.push(`/backtest?symbol=${row.symbol}`)}
                style={{
                  cursor: 'pointer',
                  background: isSelected ? 'var(--bg-panel-header)' : 'transparent',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <td style={{ padding: '3px 6px', color: 'var(--color-accent)', fontWeight: 600 }}>
                  {row.symbol}
                </td>
                <td
                  style={{
                    padding: '3px 6px',
                    color: 'var(--text-muted)',
                    maxWidth: '140px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.name}
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtMoney(row.last, row.currency)}
                </td>
                <td style={{ padding: '3px 6px', color: row.priceSource === 'quote' ? 'var(--color-accent)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {fmtAsOf(row)}
                  {isLiveBar(row) && (
                    <span
                      title="today's bar is still forming - signals use closed bars only"
                      style={{
                        marginLeft: 4,
                        color: 'var(--color-accent)',
                        fontSize: 'var(--fs-xs)',
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                      }}
                    >
                      LIVE
                    </span>
                  )}
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'right', color: chgColor }}>
                  {row.changePct >= 0 ? '+' : ''}{fmt(row.changePct)}%
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--text-muted)' }}>
                  {fmtVol(row.volume)}
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'right' }}>
                  <Sparkline data={row.spark} width={60} height={18} />
                </td>
              </tr>
            );
          })}

          {/* Placeholder rows - curated but not yet ingested */}
          {placeholders.map((sym) => {
            const busy = ingesting === sym.symbol;
            return (
              <tr
                key={sym.symbol}
                style={{
                  borderBottom: '1px solid var(--border)',
                  opacity: 0.45,
                }}
              >
                <td style={{ padding: '3px 6px', color: 'var(--text-muted)', fontWeight: 600 }}>
                  {sym.symbol}
                </td>
                <td
                  style={{
                    padding: '3px 6px',
                    color: 'var(--text-muted)',
                    maxWidth: '140px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {sym.name}
                </td>
                <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--text-muted)' }}>--</td>
                <td style={{ padding: '3px 6px', color: 'var(--text-muted)' }}>--</td>
                <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--text-muted)' }}>--</td>
                <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--text-muted)' }}>--</td>
                <td style={{ padding: '3px 6px', textAlign: 'right' }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); void handleIngest(sym); }}
                    disabled={busy}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--border)',
                      color: 'var(--color-accent)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--fs-xs)',
                      padding: '1px 6px',
                      cursor: busy ? 'wait' : 'pointer',
                      opacity: 1,
                    }}
                  >
                    {busy ? '...' : '+ ingest'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}
