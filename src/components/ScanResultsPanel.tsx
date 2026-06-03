'use client';

import { useRouter } from 'next/navigation';
import Panel from './Panel';
import Sparkline from './Sparkline';
import EmptyState from './EmptyState';
import type { MarketRow } from '@/core/market/snapshot';

interface ScanResultsPanelProps {
  rows:     MarketRow[];
  selected: number;
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

export default function ScanResultsPanel({ rows, selected }: ScanResultsPanelProps) {
  const router = useRouter();

  if (rows.length === 0) {
    return (
      <Panel title="TOP MOMENTUM / SCAN RESULTS">
        <EmptyState message="— no data —" hint="run: scan --strategy=rsi-reversion" />
      </Panel>
    );
  }

  return (
    <Panel
      title="TOP MOMENTUM / SCAN RESULTS"
      headerRight={<span>{rows.length} symbols</span>}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
        <thead>
          <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: '2px 6px', fontWeight: 400 }}>SYMBOL</th>
            <th style={{ textAlign: 'left', padding: '2px 6px', fontWeight: 400 }}>NAME</th>
            <th style={{ textAlign: 'right', padding: '2px 6px', fontWeight: 400 }}>LAST</th>
            <th style={{ textAlign: 'right', padding: '2px 6px', fontWeight: 400 }}>CHG%</th>
            <th style={{ textAlign: 'right', padding: '2px 6px', fontWeight: 400 }}>VOL</th>
            <th style={{ textAlign: 'right', padding: '2px 6px', fontWeight: 400 }}>SPARK</th>
          </tr>
        </thead>
        <tbody>
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
                <td style={{ padding: '3px 6px', textAlign: 'right' }}>
                  {fmt(row.last)}
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
        </tbody>
      </table>
    </Panel>
  );
}
