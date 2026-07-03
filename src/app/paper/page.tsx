'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import DublinClock from '@/components/primitives/DublinClock';
import AppHeader from '@/components/primitives/AppHeader';
import NewPaperTrade from '@/components/trade/NewPaperTrade';
import AccountStrip from '@/components/panels/AccountStrip';
import AutoTradePanel from '@/components/panels/AutoTradePanel';
import type { AccountSummary, EquityHistory } from '@/core/paper/account';
import PnlCalendar from '@/components/charts/PnlCalendar';
import { fmtMoney, curGlyph } from '@/core/format/currency';
import type { TradeBook } from '@/core/paper/tradebook';
import type { PaperTradeWithHold } from '@/core/paper/hold';
import type { PaperTrade } from '@/core/types';
import { useSettings } from '@/components/providers/SettingsProvider';
import type { PendingFillResult } from '@/core/paper/broker';
import { DataTable } from '@/components/table/DataTable';
import type { ColumnDef } from '@tanstack/react-table';
import { fmtDate } from '@/core/format/date';
import EquityCurveChart from '@/components/charts/EquityCurveChart';
import type { PerfMetrics } from '@/core/paper/perf';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MarkEntry {
  unrealizedPnl:    number;
  unrealizedPnlPct: number;
  markPrice:        number;
}

function strategiesFromNotes(notes: string | undefined | null, strategyId: string): string[] {
  if (!notes) return [strategyId];
  const m = notes.match(/daily:[^:]+:([^\s]+)/);
  if (!m) return [strategyId];
  const ids = m[1].split(',').filter(Boolean);
  return ids.length > 0 ? ids : [strategyId];
}

function pct(v: number, sign = true) {
  const s = sign && v >= 0 ? '+' : '';
  return `${s}${v.toFixed(2)}%`;
}

/**
 * Format a P&L value with sign prefix.
 * Pass `currency` to include the glyph; omit for bare numbers.
 */
function fmtPnl(v: number | undefined, currency = '') {
  if (v == null || !isFinite(v)) return '--';
  const glyph = currency ? fmtMoney(Math.abs(v), currency) : Math.abs(v).toFixed(2);
  return `${v >= 0 ? '+' : '-'}${glyph}`;
}

function pnlStyle(v: number | null | undefined): React.CSSProperties {
  if (v == null) return { color: 'var(--text-muted)' };
  return { color: v >= 0 ? 'var(--color-up)' : 'var(--color-down)', fontVariantNumeric: 'tabular-nums' };
}

function fmtNum(n: number | undefined, dec = 2) {
  if (n == null || !isFinite(n)) return '--';
  return n.toFixed(dec);
}

/** Hold cell: open trades show the historical-median estimate; closed show actual days. */
function holdCell(t: PaperTradeWithHold): { text: string; title: string } {
  if (t.status === 'open') {
    if (!t.estHold) return { text: '--', title: 'no edge data yet for this strategy' };
    const f = (s: string) =>
      new Date(`${s}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    const { medianHoldBars, earliest, latest, source, sampleSize } = t.estHold;
    return {
      text:  `~${medianHoldBars}d (${f(earliest)} - ${f(latest)})`,
      title: `historical median winner hold, ${source === 'symbol' ? 'this symbol' : 'whole universe'}, ${sampleSize} trades - not a forecast`,
    };
  }
  if (t.exitTime) {
    const days = Math.round(
      (new Date(t.exitTime).getTime() - new Date(t.entryTime).getTime()) / 86_400_000,
    );
    return { text: `${days}d`, title: 'actual calendar days held' };
  }
  return { text: '--', title: '' };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function OverallStats({
  book,
  displayCur,
  fromUSD,
}: {
  book:       TradeBook;
  displayCur: string;
  fromUSD:    (usdAmount: number) => number;
}) {
  // Build per-currency breakdown tooltip for TOTAL P&L
  const pnlBreakdown = Object.entries(book.totalPnlByCurrency ?? {})
    .map(([cur, v]) => `${cur} ${v >= 0 ? '+' : ''}${v.toFixed(2)}`)
    .join(' | ') || 'no closed trades';

  // Convert USD aggregates to displayCur for presentation
  const totalPnlDisp = fromUSD(book.totalPnl);
  const openMtmDisp  = fromUSD(book.openUnrealizedPnl);
  const exposureDisp = fromUSD(book.openExposure);

  // best/worst pnl is native currency - show with glyph directly (no USD pivot on client)
  const bestVal  = book.bestTrade  ? fmtPnl(book.bestTrade.pnl,  book.bestTrade.currency  ?? displayCur) : '--';
  const worstVal = book.worstTrade ? fmtPnl(book.worstTrade.pnl, book.worstTrade.currency ?? displayCur) : '--';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        gap: 1,
        background: 'var(--border)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      {[
        { label: 'TOTAL TRADES', value: String(book.totalTrades) },
        { label: 'OPEN',         value: String(book.open) },
        { label: 'PENDING',      value: String(book.pending ?? 0) },
        { label: 'CLOSED',       value: String(book.closed) },
        { label: 'WIN RATE',     value: `${(book.winRate * 100).toFixed(1)}%` },
        {
          label: `TOTAL P&L (${displayCur})`,
          value: fmtPnl(totalPnlDisp, displayCur),
          color: totalPnlDisp >= 0 ? 'var(--color-up)' : 'var(--color-down)',
          title: `native: ${pnlBreakdown}`,
        },
        {
          label: `OPEN MTM (${displayCur})`,
          value: book.openUnrealizedPnl !== 0 ? `~${fmtPnl(openMtmDisp, displayCur)}` : '--',
          color: openMtmDisp >= 0 ? 'var(--color-up)' : 'var(--color-down)',
        },
        { label: 'AVG P&L%',   value: pct(book.avgPnlPct), color: book.avgPnlPct >= 0 ? 'var(--color-up)' : 'var(--color-down)' },
        {
          label: `EXPOSURE (${displayCur})`,
          value: fmtPnl(exposureDisp, displayCur),
        },
        { label: 'BEST TRADE',  value: bestVal,  color: 'var(--color-up)' },
        { label: 'WORST TRADE', value: worstVal, color: 'var(--color-down)' },
      ].map(({ label, value, color, title }) => (
        <div key={label} style={{ background: 'var(--bg-panel)', padding: '8px 12px' }} title={title}>
          <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', letterSpacing: '0.08em', marginBottom: 2 }}>{label}</div>
          <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 600, color: color ?? 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}

interface StratRow {
  id: string;
  trades: number;
  winRate: number;
  pnlDisp: number;
  mtmDisp: number;
  avgPnlPct: number;
  openUnrealizedPnl: number;
  displayCur: string;
}

function ByStrategyTable({
  book,
  displayCur,
  fromUSD,
}: {
  book:       TradeBook;
  displayCur: string;
  fromUSD:    (usdAmount: number) => number;
}) {
  const rows = useMemo<StratRow[]>(() =>
    Object.entries(book.byStrategy)
      .sort((a, b) => b[1].winRate - a[1].winRate)
      .map(([id, stats]) => ({
        id,
        trades:            stats.trades,
        winRate:           stats.winRate,
        pnlDisp:           fromUSD(stats.totalPnl),
        mtmDisp:           fromUSD(stats.openUnrealizedPnl),
        avgPnlPct:         stats.avgPnlPct,
        openUnrealizedPnl: stats.openUnrealizedPnl,
        displayCur,
      })),
  [book, fromUSD, displayCur]);

  const columns = useMemo<ColumnDef<StratRow, unknown>[]>(() => [
    { accessorKey: 'id',       header: 'STRATEGY',                          meta: { accent: true } },
    { accessorKey: 'trades',   header: 'TRADES',                             meta: { numeric: true } },
    {
      accessorKey: 'winRate',
      header: 'WIN RATE',
      cell: ({ getValue }) => <span style={{ fontWeight: 600 }}>{((getValue() as number) * 100).toFixed(1)}%</span>,
      meta: { numeric: true },
    },
    {
      accessorKey: 'pnlDisp',
      header: `P&L CLOSED (${displayCur})`,
      cell: ({ row }) => <span style={{ ...pnlStyle(row.original.pnlDisp), fontVariantNumeric: 'tabular-nums' }}>{fmtPnl(row.original.pnlDisp, row.original.displayCur)}</span>,
      meta: { numeric: true },
    },
    {
      accessorKey: 'mtmDisp',
      header: `MTM OPEN (${displayCur})`,
      cell: ({ row }) => {
        if (row.original.openUnrealizedPnl === 0) return '--';
        return <span style={{ ...pnlStyle(row.original.mtmDisp), fontVariantNumeric: 'tabular-nums' }}>{`~${fmtPnl(row.original.mtmDisp, row.original.displayCur)}`}</span>;
      },
      meta: { numeric: true },
    },
    {
      accessorKey: 'avgPnlPct',
      header: 'AVG P&L%',
      cell: ({ getValue }) => {
        const v = getValue() as number;
        return <span style={{ ...pnlStyle(v) }}>{pct(v)}</span>;
      },
      meta: { numeric: true },
    },
  ], [displayCur]);

  if (rows.length === 0) {
    return <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', padding: 8 }}>no strategy data</p>;
  }

  return <DataTable columns={columns} data={rows} enableSorting />;
}

function TradesTable({
  trades,
  marks,
  displayCur,
  fxRates,
  onClose,
  onCancel,
}: {
  trades:     PaperTradeWithHold[];
  marks:      Map<string, MarkEntry>;
  displayCur: string;
  fxRates:    Record<string, number>;
  onClose:    (id: string) => void;
  onCancel:   (id: string) => void;
}) {
  const dispGlyph = curGlyph(displayCur) || displayCur;

  function cvt(amount: number, nativeCur: string): number {
    const nativeUsdRate = fxRates[nativeCur] ?? 1;
    const dispUsdRate   = fxRates[displayCur] ?? 1;
    return (amount * nativeUsdRate) / dispUsdRate;
  }

  function fmtCvt(amount: number | undefined | null, nativeCur: string): { text: string; title: string } {
    if (amount == null || !isFinite(amount)) return { text: '--', title: '' };
    const converted = cvt(amount, nativeCur);
    const isDiff = nativeCur !== displayCur;
    return { text: fmtMoney(converted, displayCur), title: isDiff ? `${fmtMoney(amount, nativeCur)} (native)` : '' };
  }

  const columns = useMemo<ColumnDef<PaperTradeWithHold, unknown>[]>(() => [
    {
      accessorKey: 'entryTime',
      header: 'DATE',
      cell: ({ getValue }) => <span style={{ color: 'var(--text-muted)' }}>{fmtDate(getValue() as string)}</span>,
    },
    { accessorKey: 'symbol', header: 'SYMBOL', meta: { accent: true } },
    {
      id: 'strategy',
      accessorFn: (r) => r.strategyId,
      header: 'STRATEGY',
      cell: ({ row }) => {
        const t = row.original;
        const strats = strategiesFromNotes(t.notes, t.strategyId);
        if (strats.length <= 1) {
          return <span style={{ color: 'var(--text-muted)' }}>{strats[0]}</span>;
        }
        return (
          <span title={strats.join(' · ')} style={{ color: 'var(--text-muted)' }}>
            {strats[0]}
            <span style={{ color: 'var(--color-accent)', fontSize: 'var(--fs-xs)', marginLeft: 4 }}>
              +{strats.length - 1}
            </span>
          </span>
        );
      },
    },
    {
      accessorKey: 'side',
      header: 'SIDE',
      cell: ({ getValue }) => {
        const side = getValue() as string;
        return <span style={{ color: side === 'long' ? 'var(--color-up)' : 'var(--color-down)', fontWeight: 600 }}>{side.toUpperCase()}</span>;
      },
      meta: { align: 'center' },
    },
    {
      id: 'entry',
      header: `ENTRY (${dispGlyph})`,
      cell: ({ row: { original: t } }) => {
        const cur = t.currency ?? 'USD'; const ef = fmtCvt(t.entryPrice, cur);
        return t.status === 'pending'
          ? <span style={{ color: '#e6a817', fontVariantNumeric: 'tabular-nums' }} title={ef.title}>LIMIT {ef.text}</span>
          : <span style={{ fontVariantNumeric: 'tabular-nums' }} title={ef.title}>{ef.text}</span>;
      },
      meta: { numeric: true },
    },
    {
      id: 'cur',
      header: `CUR (${dispGlyph})`,
      cell: ({ row: { original: t } }) => {
        if (t.status === 'pending') return '--';
        const mark = t.status === 'open' ? marks.get(t.id) : undefined;
        const cf = mark != null ? fmtCvt(mark.markPrice, t.currency ?? 'USD') : { text: '--', title: '' };
        const color = mark != null ? (pnlStyle(mark.unrealizedPnl).color ?? undefined) : 'var(--text-muted)';
        return <span style={{ color, fontVariantNumeric: 'tabular-nums' }} title={cf.title}>{cf.text}</span>;
      },
      meta: { numeric: true },
    },
    {
      id: 'stop',
      header: `STOP (${dispGlyph})`,
      cell: ({ row: { original: t } }) => {
        const sf = t.stopPrice != null ? fmtCvt(t.stopPrice, t.currency ?? 'USD') : { text: '--', title: '' };
        return <span style={{ color: 'var(--color-down)', fontVariantNumeric: 'tabular-nums' }} title={sf.title}>{sf.text}</span>;
      },
      meta: { numeric: true },
    },
    {
      id: 'target',
      header: `TARGET (${dispGlyph})`,
      cell: ({ row: { original: t } }) => {
        const tf = t.targetPrice != null ? fmtCvt(t.targetPrice, t.currency ?? 'USD') : { text: '--', title: '' };
        return <span style={{ color: 'var(--color-up)', fontVariantNumeric: 'tabular-nums' }} title={tf.title}>{tf.text}</span>;
      },
      meta: { numeric: true },
    },
    {
      accessorKey: 'qty',
      header: 'QTY',
      cell: ({ getValue }) => <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(getValue() as number, 4)}</span>,
      meta: { numeric: true },
    },
    {
      id: 'exit',
      header: `EXIT (${dispGlyph})`,
      cell: ({ row: { original: t } }) => {
        const ef = t.exitPrice != null ? fmtCvt(t.exitPrice, t.currency ?? 'USD') : { text: '--', title: '' };
        return <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }} title={ef.title}>{ef.text}</span>;
      },
      meta: { numeric: true },
    },
    {
      id: 'pnl',
      header: `P&L (${dispGlyph})`,
      cell: ({ row: { original: t } }) => {
        if (t.status === 'pending') return '--';
        const cur   = t.currency ?? 'USD';
        const mark  = t.status === 'open' ? marks.get(t.id) : undefined;
        const isMtm = mark != null;
        const rawPnl = isMtm ? mark.unrealizedPnl : t.pnl;
        if (rawPnl == null) return '--';
        const pnlConverted = cvt(rawPnl, cur);
        return (
          <span style={{ ...pnlStyle(pnlConverted), fontVariantNumeric: 'tabular-nums' }}
                title={rawPnl != null && cur !== displayCur ? `${fmtPnl(rawPnl, cur)} (native)` : undefined}>
            {isMtm ? '~' : ''}{fmtPnl(pnlConverted, displayCur)}
          </span>
        );
      },
      meta: { numeric: true },
    },
    {
      id: 'pnlPct',
      header: 'P&L%',
      cell: ({ row: { original: t } }) => {
        if (t.status === 'pending') return '--';
        const mark = t.status === 'open' ? marks.get(t.id) : undefined;
        const isMtm = mark != null;
        const displayPnlPct = isMtm ? mark.unrealizedPnlPct : t.pnlPct;
        if (displayPnlPct == null) return '--';
        return <span style={{ ...pnlStyle(displayPnlPct) }}>{isMtm ? '~' : ''}{pct(displayPnlPct)}</span>;
      },
      meta: { numeric: true },
    },
    {
      id: 'hold',
      header: 'EST HOLD',
      cell: ({ row: { original: t } }) => {
        if (t.status === 'pending') return '--';
        const hold = holdCell(t);
        return <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }} title={hold.title}>{hold.text}</span>;
      },
    },
    {
      accessorKey: 'status',
      header: 'STATUS',
      cell: ({ getValue }) => {
        const s = getValue() as string;
        const color = s === 'open' ? 'var(--color-accent)' : s === 'pending' ? '#e6a817' : 'var(--text-muted)';
        return <span style={{ color }}>{s.toUpperCase()}</span>;
      },
      meta: { align: 'center' },
    },
    {
      id: 'action',
      header: 'ACTION',
      cell: ({ row: { original: t } }) => {
        if (t.status === 'open') {
          return (
            <button onClick={() => onClose(t.id)}
              style={{ background: 'var(--bg-panel)', border: '1px solid var(--color-down)', color: 'var(--color-down)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', padding: '1px 6px', cursor: 'pointer' }}>
              CLOSE
            </button>
          );
        }
        if (t.status === 'pending') {
          return (
            <button onClick={() => onCancel(t.id)}
              style={{ background: 'var(--bg-panel)', border: '1px solid #e6a817', color: '#e6a817', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', padding: '1px 6px', cursor: 'pointer' }}>
              CANCEL
            </button>
          );
        }
        return null;
      },
      meta: { align: 'center' },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [displayCur, marks, fxRates, onClose, onCancel, dispGlyph]);

  if (trades.length === 0) {
    return <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', padding: 8 }}>no trades yet</p>;
  }

  return <DataTable columns={columns} data={[...trades].reverse()} enableSorting />;
}

// ---------------------------------------------------------------------------
// Pending orders table
// ---------------------------------------------------------------------------

function PendingOrdersTable({
  orders,
  fillDiagnostics,
  displayCur,
  fxRates,
  onCancel,
}: {
  orders:          PaperTradeWithHold[];
  fillDiagnostics: Map<string, PendingFillResult>;
  displayCur:      string;
  fxRates:         Record<string, number>;
  onCancel:        (id: string) => void;
}) {
  void fxRates; void displayCur; // reserved for future currency conversion on this table
  const columns = useMemo<ColumnDef<PaperTradeWithHold, unknown>[]>(() => [
    { accessorKey: 'symbol', header: 'SYMBOL', meta: { accent: true } },
    {
      accessorKey: 'side',
      header: 'SIDE',
      cell: ({ getValue }) => {
        const side = getValue() as string;
        return <span style={{ color: side === 'long' ? 'var(--color-up)' : 'var(--color-down)', fontWeight: 700 }}>{side.toUpperCase()}</span>;
      },
      meta: { align: 'center' },
    },
    {
      id: 'limit',
      header: 'LIMIT',
      cell: ({ row: { original: o } }) => (
        <span style={{ color: '#e6a817', fontVariantNumeric: 'tabular-nums' }}>
          {fmtMoney(o.entryPrice, o.currency ?? 'USD')}
        </span>
      ),
      meta: { numeric: true },
    },
    {
      id: 'current',
      header: 'CURRENT',
      cell: ({ row: { original: o } }) => {
        const diag = fillDiagnostics.get(o.id);
        if (diag?.quotePrice == null) return <span style={{ color: 'var(--text-muted)' }}>--</span>;
        return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(diag.quotePrice, o.currency ?? 'USD')}</span>;
      },
      meta: { numeric: true },
    },
    {
      id: 'distance',
      header: 'DISTANCE',
      cell: ({ row: { original: o } }) => {
        const diag = fillDiagnostics.get(o.id);
        if (diag?.quotePrice == null) return <span style={{ color: 'var(--text-muted)' }}>--</span>;
        const raw    = (diag.quotePrice - o.entryPrice) / o.entryPrice * 100;
        const distPct = o.side === 'long' ? raw : -raw;
        const color   = distPct <= 0 ? 'var(--color-up)' : 'var(--color-down)';
        return <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>{distPct >= 0 ? '+' : ''}{distPct.toFixed(2)}%</span>;
      },
      meta: { numeric: true },
    },
    {
      id: 'stop',
      header: 'STOP',
      cell: ({ row: { original: o } }) => (
        <span style={{ color: o.stopPrice != null ? 'var(--color-down)' : 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {o.stopPrice != null ? fmtMoney(o.stopPrice, o.currency ?? 'USD') : '--'}
        </span>
      ),
      meta: { numeric: true },
    },
    {
      id: 'target',
      header: 'TARGET',
      cell: ({ row: { original: o } }) => (
        <span style={{ color: o.targetPrice != null ? 'var(--color-up)' : 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {o.targetPrice != null ? fmtMoney(o.targetPrice, o.currency ?? 'USD') : '--'}
        </span>
      ),
      meta: { numeric: true },
    },
    {
      accessorKey: 'qty',
      header: 'QTY',
      cell: ({ getValue }) => <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(getValue() as number, 4)}</span>,
      meta: { numeric: true },
    },
    {
      accessorKey: 'entryTime',
      header: 'REQUESTED',
      cell: ({ getValue }) => <span style={{ color: 'var(--text-muted)' }}>{fmtDate(getValue() as string)}</span>,
    },
    {
      id: 'fillCheck',
      header: 'FILL CHECK',
      cell: ({ row: { original: o } }) => {
        const diag = fillDiagnostics.get(o.id);
        if (!diag) return <span style={{ color: 'var(--text-muted)' }}>--</span>;
        const col = diag.action === 'filled'       ? 'var(--color-up)'
                  : diag.action === 'fill-blocked' ? 'var(--color-down)'
                  : diag.crossed                   ? '#e6a817'
                  : 'var(--text-muted)';
        const text = diag.action === 'filled'       ? `FILLED @ ${fmtMoney(diag.fillPrice ?? o.entryPrice, o.currency ?? 'USD')}`
                   : diag.action === 'fill-blocked' ? 'BLOCKED (budget/risk)'
                   : diag.reason ?? 'checking...';
        return (
          <span style={{ color: col, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', maxWidth: 260 }}
                title={diag.reason ?? ''}>
            {text}
          </span>
        );
      },
    },
    {
      id: 'action',
      header: 'ACTION',
      cell: ({ row: { original: o } }) => (
        <button onClick={() => onCancel(o.id)}
          style={{ background: 'var(--bg-panel)', border: '1px solid var(--color-down)', color: 'var(--color-down)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', padding: '1px 6px', cursor: 'pointer' }}>
          CANCEL
        </button>
      ),
      meta: { align: 'center' },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [fillDiagnostics, onCancel]);

  return <DataTable columns={columns} data={orders} dense />;
}

// ---------------------------------------------------------------------------
// Page (client component - needs state for new trade form + close action)
// ---------------------------------------------------------------------------

export default function PaperPage() {
  const [trades,       setTrades]       = useState<PaperTradeWithHold[]>([]);
  const [performance,  setPerformance]  = useState<PerfMetrics | null>(null);
  const [marks,        setMarks]        = useState<Map<string, MarkEntry>>(new Map());
  const [book,         setBook]         = useState<TradeBook | null>(null);
  const [account,      setAccount]      = useState<AccountSummary | null>(null);
  const [equityHistory, setEquityHistory] = useState<EquityHistory | null>(null);
  const [sweeping,     setSweeping]     = useState(false);
  const [sweepMsg,     setSweepMsg]     = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed' | 'pending'>('all');
  const [refreshing,     setRefreshing]     = useState(false);
  const [lastRefresh,    setLastRefresh]    = useState('');
  const [checkingFills,  setCheckingFills]  = useState(false);
  // keyed by trade.id - populated after CHECK FILLS or REFRESH PRICES
  const [fillDiagnostics, setFillDiagnostics] = useState<Map<string, PendingFillResult>>(new Map());
  const { displayCurrency: displayCur, rates: fxRates, setDisplayCurrency: setDisplayCur } = useSettings();

  // Load data on mount (and after mutations)
  // FX rates come from SettingsProvider (already fetched app-wide); skip /api/fx here.
  const loadData = useCallback(async () => {
    const [tRes, bRes, mRes, aRes, pRes, hRes] = await Promise.all([
      fetch('/api/paper', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list' }) }),
      fetch('/api/paper', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'tradebook' }) }),
      fetch('/api/paper', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mark', useQuotes: false }) }),
      fetch('/api/paper', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'account' }) }),
      fetch('/api/paper', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'performance' }) }),
      fetch('/api/paper', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'equity-history' }) }),
    ]);
    if (aRes.ok) {
      const { account: acct } = await aRes.json() as { account: AccountSummary | null };
      setAccount(acct);
    }
    if (pRes.ok) {
      const { performance: perf } = await pRes.json() as { performance: PerfMetrics };
      setPerformance(perf);
    }
    if (hRes.ok) {
      const { history } = await hRes.json() as { history: EquityHistory | null };
      setEquityHistory(history);
    }
    if (tRes.ok) {
      const { trades: t } = await tRes.json() as { trades: PaperTrade[] };
      setTrades(t);
    }
    if (bRes.ok) {
      const { book: b } = await bRes.json() as { book: TradeBook };
      setBook(b);
    }
    if (mRes.ok) {
      const { marks: markResults } = await mRes.json() as {
        marks: { trade: { id: string }; unrealizedPnl: number; unrealizedPnlPct: number; markPrice: number }[];
      };
      setMarks(new Map(markResults.map((m) => [m.trade.id, { unrealizedPnl: m.unrealizedPnl, unrealizedPnlPct: m.unrealizedPnlPct, markPrice: m.markPrice }])));
    }
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('paper:statusFilter');
    if (saved === 'open' || saved === 'closed' || saved === 'pending') setStatusFilter(saved);
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const handleOpened = useCallback((_trade: PaperTrade) => {
    void loadData();
  }, [loadData]);

  const handleClose = useCallback(async (id: string) => {
    // Close at latest stored close for this symbol
    const trade = trades.find((t) => t.id === id);
    if (!trade) return;
    // Prefer latest quote, then fall back to latest stored close.
    let exitPrice = trade.entryPrice;
    try {
      const qRes = await fetch(`/api/quotes?symbols=${encodeURIComponent(trade.symbol)}`);
      if (qRes.ok) {
        const { quotes } = await qRes.json() as { quotes?: { price: number }[] };
        if (quotes?.[0]?.price != null) exitPrice = quotes[0].price;
      }
      const bRes = exitPrice === trade.entryPrice
        ? await fetch(`/api/bars?symbol=${encodeURIComponent(trade.symbol)}`)
        : null;
      if (bRes?.ok) {
        const { bars } = await bRes.json() as { bars: { close: number }[] };
        if (bars && bars.length > 0) exitPrice = bars[bars.length - 1].close;
      }
    } catch { /* use entry price as fallback */ }

    await fetch('/api/paper', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        action:    'close',
        id,
        exitPrice,
        exitTime:  new Date().toISOString().slice(0, 10),
      }),
    });
    void loadData();
  }, [trades, loadData]);

  const handleSweep = useCallback(async () => {
    setSweeping(true);
    setSweepMsg('sweeping...');
    try {
      const res = await fetch('/api/paper', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'sweep' }),
      });
      const data = await res.json() as { closed: number; stopped: number; targeted: number; expired: number };
      setSweepMsg(`sweep: ${data.closed} closed (${data.stopped} stopped, ${data.targeted} targeted, ${data.expired ?? 0} expired)`);
      void loadData();
    } catch (err) {
      setSweepMsg(`sweep error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSweeping(false);
    }
  }, [loadData]);

  const handleRefreshPrices = useCallback(async () => {
    setRefreshing(true);
    try {
      // Also check pending fills against live quotes - any that fill will send Telegram
      await fetch('/api/paper', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'fill-pending' }) });

      const [mRes, bRes] = await Promise.all([
        fetch('/api/paper', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mark', useQuotes: true }) }),
        fetch('/api/paper', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'tradebook' }) }),
      ]);
      if (mRes.ok) {
        const { marks: markResults } = await mRes.json() as {
          marks: { trade: { id: string }; unrealizedPnl: number; unrealizedPnlPct: number; markPrice: number }[];
        };
        setMarks(new Map(markResults.map((m) => [m.trade.id, { unrealizedPnl: m.unrealizedPnl, unrealizedPnlPct: m.unrealizedPnlPct, markPrice: m.markPrice }])));
        const now = new Date();
        setLastRefresh(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`);
      }
      if (bRes.ok) {
        const { book: b } = await bRes.json() as { book: TradeBook };
        setBook(b);
      }
      // Reload trades list in case any pending -> open transitions happened
      void loadData();
    } finally {
      setRefreshing(false);
    }
  }, [loadData]);

  const handleCancel = useCallback(async (id: string) => {
    await fetch('/api/paper', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'cancel-pending', id }),
    });
    void loadData();
  }, [loadData]);

  /**
   * Check all resting limit orders against live quotes.
   * Captures per-order diagnostics (current price vs limit, crossed?, reason)
   * then reloads - any filled order moves from pending to open.
   */
  const handleCheckFills = useCallback(async () => {
    setCheckingFills(true);
    try {
      const res = await fetch('/api/paper', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'fill-pending' }),
      });
      if (res.ok) {
        const data = await res.json() as { fillResults: PendingFillResult[]; filled: number };
        setFillDiagnostics(new Map(data.fillResults.map((r) => [r.trade.id, r])));
      }
      void loadData();
    } finally {
      setCheckingFills(false);
    }
  }, [loadData]);

  // Filtered view - no refetch needed, status lives on each trade object
  const visibleTrades = statusFilter === 'all'
    ? trades
    : trades.filter((t) => t.status === statusFilter);

  // Pending orders - ALWAYS derived from full trades list, bypasses statusFilter
  // This ensures resting limit orders are never hidden by the sticky filter.
  const pendingOrders = trades.filter((t) => t.status === 'pending');

  /**
   * Convert a USD-denominated amount (from tradebook) to the selected display currency.
   * Book aggregates (totalPnl, openUnrealizedPnl, openExposure) are all USD.
   */
  function fromUSD(usdAmount: number): number {
    const rate = fxRates[displayCur] ?? 1;
    return usdAmount / rate;
  }

  return (
    <div className="flex flex-col h-full" style={{ minHeight: '100vh' }}>
      <AppHeader
        right={
          <>
            {sweepMsg && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{sweepMsg}</span>}
            {lastRefresh && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>prices @ {lastRefresh}</span>}
            <button
              onClick={() => void handleRefreshPrices()}
              disabled={refreshing}
              style={{
                background:   'var(--bg-panel)',
                border:       '1px solid var(--border)',
                color:        refreshing ? 'var(--color-accent)' : 'var(--text-muted)',
                fontFamily:   'var(--font-mono)',
                fontSize:     'var(--fs-xs)',
                padding:      '2px 8px',
                cursor:       'pointer',
              }}
            >
              {refreshing ? 'REFRESHING...' : 'REFRESH PRICES'}
            </button>
            <button
              onClick={() => void handleSweep()}
              disabled={sweeping}
              style={{
                background:   'var(--bg-panel)',
                border:       '1px solid var(--border)',
                color:        sweeping ? 'var(--color-accent)' : 'var(--text-muted)',
                fontFamily:   'var(--font-mono)',
                fontSize:     'var(--fs-xs)',
                padding:      '2px 8px',
                cursor:       'pointer',
              }}
            >
              {sweeping ? 'SWEEPING...' : 'EOD SWEEP'}
            </button>
            <DublinClock />
          </>
        }
      />

      {/* Paper trading budget strip */}
      <AccountStrip
        account={account}
        onSetBudget={(amount) => {
          void fetch('/api/paper', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ action: 'account-set', startingBalance: amount }),
          }).then(() => loadData());
        }}
      />

      {/* Auto-trade status panel */}
      <AutoTradePanel />

      {/* New trade form */}
      <NewPaperTrade onOpened={handleOpened} />

      {/* Body */}
      <div className="flex-1 overflow-auto" style={{ background: 'var(--bg-base)' }}>
        {/* Overall stats */}
        {book && <OverallStats book={book} displayCur={displayCur} fromUSD={fromUSD} />}

        {/* By strategy */}
        {book && (
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', letterSpacing: '0.08em', marginBottom: 8 }}>
              [ PERFORMANCE BY STRATEGY ]
            </div>
            <ByStrategyTable book={book} displayCur={displayCur} fromUSD={fromUSD} />
          </div>
        )}

        {/* Account equity curve + daily P&L calendar. Curve prefers the real
            USD history (starting balance + cumulative realized per exit date);
            falls back to the notional $100-start per-trade curve when no
            budget has been set. */}
        {((equityHistory && equityHistory.points.length > 0) ||
          (performance && performance.equityCurve.length > 1)) && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: equityHistory ? '1fr 460px' : '1fr',
              gap: '1px',
              background: 'var(--border)',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <div style={{ padding: '12px 16px', height: 260, background: 'var(--bg-page)' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', letterSpacing: '0.08em', marginBottom: 8 }}>
                [ ACCOUNT EQUITY CURVE {equityHistory ? '(USD, realized)' : '(notional)'} ]
              </div>
              <div style={{ height: 210 }}>
                <EquityCurveChart
                  equityCurve={
                    equityHistory && equityHistory.points.length > 0
                      ? equityHistory.points
                      : performance!.equityCurve
                  }
                />
              </div>
            </div>
            {equityHistory && (
              <div style={{ height: 260, overflow: 'auto', background: 'var(--bg-page)' }}>
                <PnlCalendar dailyPnl={equityHistory.dailyPnl} months={3} />
              </div>
            )}
          </div>
        )}

        {/* Pending / Resting Orders - always visible, independent of statusFilter */}
        {pendingOrders.length > 0 && (
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ color: '#e6a817', fontSize: 'var(--fs-xs)', letterSpacing: '0.08em', fontWeight: 700 }}>
                [ PENDING / RESTING ORDERS ({pendingOrders.length}) ]
              </span>
              <button
                onClick={() => void handleCheckFills()}
                disabled={checkingFills}
                style={{
                  background:  'var(--bg-panel)',
                  border:      '1px solid #e6a817',
                  color:       checkingFills ? '#e6a817' : 'var(--text-muted)',
                  fontFamily:  'var(--font-mono)',
                  fontSize:    'var(--fs-xs)',
                  padding:     '2px 8px',
                  cursor:      'pointer',
                }}
              >
                {checkingFills ? 'CHECKING...' : 'CHECK FILLS'}
              </button>
            </div>
            <PendingOrdersTable
              orders={pendingOrders}
              fillDiagnostics={fillDiagnostics}
              displayCur={displayCur}
              fxRates={fxRates}
              onCancel={(id) => void handleCancel(id)}
            />
            <div style={{ marginTop: 6, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
              Resting limit orders - fill only when market price crosses the limit (not on gap-up/gap-down short of the limit).
              CHECK FILLS runs the live-quote fill check and shows per-order diagnostics.
            </div>
          </div>
        )}

        {/* Trades */}
        <div style={{ padding: '12px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', letterSpacing: '0.08em' }}>
              [ TRADES ({visibleTrades.length}{statusFilter !== 'all' ? ` ${statusFilter}` : ''}) ]
            </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {/* Display currency selector - persisted app-wide via SettingsProvider */}
              <select
                value={displayCur}
                onChange={(e) => { void setDisplayCur(e.target.value); }}
                title="Display currency - all prices and P&L shown in this currency (static FX rates). Change in SETTINGS to persist."
                style={{
                  background:  'var(--bg-panel)',
                  border:      '1px solid var(--color-accent)',
                  color:       'var(--color-accent)',
                  fontFamily:  'var(--font-mono)',
                  fontSize:    'var(--fs-xs)',
                  padding:     '1px 4px',
                  cursor:      'pointer',
                }}
              >
                {(['USD', 'EUR', 'GBP', 'INR', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN'] as const).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              {/* Status filter */}
              <select
                value={statusFilter}
                onChange={(e) => {
                  const v = e.target.value as 'all' | 'open' | 'closed' | 'pending';
                  setStatusFilter(v);
                  localStorage.setItem('paper:statusFilter', v);
                }}
                style={{
                  background:  'var(--bg-panel)',
                  border:      '1px solid var(--border)',
                  color:       'var(--text-primary)',
                  fontFamily:  'var(--font-mono)',
                  fontSize:    'var(--fs-xs)',
                  padding:     '1px 4px',
                  cursor:      'pointer',
                }}
              >
                <option value="all">all</option>
                <option value="open">open</option>
                <option value="pending">pending</option>
                <option value="closed">closed</option>
              </select>
            </div>
          </div>
          <TradesTable
            trades={visibleTrades}
            marks={marks}
            displayCur={displayCur}
            fxRates={fxRates}
            onClose={handleClose}
            onCancel={handleCancel}
          />
        </div>
      </div>

      {/* Disclaimer */}
      <div
        className="px-4 py-1 shrink-0 text-center"
        style={{
          background:   'var(--bg-base)',
          borderTop:    '1px solid var(--border)',
          color:        'var(--text-muted)',
          fontSize:     'var(--fs-xs)',
          letterSpacing: '0.04em',
        }}
      >
        Research tool. Not financial advice. Backtests are hypothetical and subject to survivorship and look-ahead error.
      </div>
    </div>
  );
}
