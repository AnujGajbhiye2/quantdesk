'use client';

import { useCallback, useEffect, useState } from 'react';
import DublinClock from '@/components/primitives/DublinClock';
import NewPaperTrade from '@/components/trade/NewPaperTrade';
import AccountStrip from '@/components/panels/AccountStrip';
import AutoTradePanel from '@/components/panels/AutoTradePanel';
import type { AccountSummary } from '@/core/paper/account';
import { fmtMoney, curGlyph } from '@/core/format/currency';
import type { TradeBook } from '@/core/paper/tradebook';
import type { PaperTradeWithHold } from '@/core/paper/hold';
import type { PaperTrade } from '@/core/types';
import { useSettings } from '@/components/providers/SettingsProvider';
import type { PendingFillResult } from '@/core/paper/broker';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MarkEntry {
  unrealizedPnl:    number;
  unrealizedPnlPct: number;
  markPrice:        number;
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

function fmtDate(s: string | undefined) { return s ? s.slice(0, 10) : '--'; }
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

function ByStrategyTable({
  book,
  displayCur,
  fromUSD,
}: {
  book:       TradeBook;
  displayCur: string;
  fromUSD:    (usdAmount: number) => number;
}) {
  const entries = Object.entries(book.byStrategy)
    .sort((a, b) => b[1].winRate - a[1].winRate);
  if (entries.length === 0) {
    return <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', padding: 8 }}>no strategy data</p>;
  }
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
      <thead>
        <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
          <th style={{ textAlign: 'left',  padding: '4px 8px', fontWeight: 400 }}>STRATEGY</th>
          <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 400 }}>TRADES</th>
          <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 400 }}>WIN RATE</th>
          <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 400 }}>P&amp;L CLOSED ({displayCur})</th>
          <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 400 }}>MTM OPEN ({displayCur})</th>
          <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 400 }}>AVG P&amp;L%</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([id, stats]) => {
          const pnlDisp = fromUSD(stats.totalPnl);
          const mtmDisp = fromUSD(stats.openUnrealizedPnl);
          return (
            <tr key={id} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '4px 8px', color: 'var(--color-accent)', fontWeight: 600 }}>{id}</td>
              <td style={{ padding: '4px 8px', textAlign: 'right' }}>{stats.trades}</td>
              <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600 }}>{(stats.winRate * 100).toFixed(1)}%</td>
              <td style={{ padding: '4px 8px', textAlign: 'right', ...pnlStyle(pnlDisp) }}>{fmtPnl(pnlDisp, displayCur)}</td>
              <td style={{ padding: '4px 8px', textAlign: 'right', ...pnlStyle(mtmDisp) }}>
                {stats.openUnrealizedPnl !== 0 ? `~${fmtPnl(mtmDisp, displayCur)}` : '--'}
              </td>
              <td style={{ padding: '4px 8px', textAlign: 'right', ...pnlStyle(stats.avgPnlPct) }}>{pct(stats.avgPnlPct)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
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
  /** Convert a native-currency amount to displayCur via USD pivot. */
  function cvt(amount: number, nativeCur: string): number {
    const nativeUsdRate = fxRates[nativeCur] ?? 1;
    const dispUsdRate   = fxRates[displayCur] ?? 1;
    return (amount * nativeUsdRate) / dispUsdRate;
  }

  /** Format in displayCur; title (hover) shows original in nativeCur. */
  function fmtCvt(amount: number | undefined | null, nativeCur: string): { text: string; title: string } {
    if (amount == null || !isFinite(amount)) return { text: '--', title: '' };
    const converted = cvt(amount, nativeCur);
    const isDiff = nativeCur !== displayCur;
    return {
      text:  fmtMoney(converted, displayCur),
      title: isDiff ? `${fmtMoney(amount, nativeCur)} (native)` : '',
    };
  }

  if (trades.length === 0) {
    return <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', padding: 8 }}>no trades yet</p>;
  }

  const dispGlyph = curGlyph(displayCur) || displayCur;

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
      <thead>
        <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
          <th style={{ textAlign: 'left',  padding: '3px 6px', fontWeight: 400 }}>DATE</th>
          <th style={{ textAlign: 'left',  padding: '3px 6px', fontWeight: 400 }}>SYMBOL</th>
          <th style={{ textAlign: 'left',  padding: '3px 6px', fontWeight: 400 }}>STRATEGY</th>
          <th style={{ textAlign: 'center',padding: '3px 6px', fontWeight: 400 }}>SIDE</th>
          <th style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 400 }}>ENTRY ({dispGlyph})</th>
          <th
            style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 400 }}
            title="latest stored close for open trades - what the position is worth right now"
          >
            CUR ({dispGlyph})
          </th>
          <th style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 400 }}>STOP ({dispGlyph})</th>
          <th style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 400 }}>TARGET ({dispGlyph})</th>
          <th style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 400 }}>QTY</th>
          <th style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 400 }}>EXIT ({dispGlyph})</th>
          <th style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 400 }}>P&amp;L ({dispGlyph})</th>
          <th style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 400 }}>P&amp;L%</th>
          <th
            style={{ textAlign: 'left', padding: '3px 6px', fontWeight: 400 }}
            title="open: historical median winner hold time (not a forecast); closed: actual days held"
          >
            EST HOLD
          </th>
          <th style={{ textAlign: 'center',padding: '3px 6px', fontWeight: 400 }}>STATUS</th>
          <th style={{ textAlign: 'center',padding: '3px 6px', fontWeight: 400 }}>ACTION</th>
        </tr>
      </thead>
      <tbody>
        {[...trades].reverse().map((t) => {
          const cur           = t.currency ?? 'USD';
          const mark          = t.status === 'open' ? marks.get(t.id) : undefined;
          const isMtm         = mark != null;
          const rawPnl        = isMtm ? mark.unrealizedPnl    : t.pnl;
          const displayPnlPct = isMtm ? mark.unrealizedPnlPct : t.pnlPct;
          const hold          = holdCell(t);

          // Convert price fields to displayCur
          const entryFmt  = fmtCvt(t.entryPrice, cur);
          const curFmt    = mark != null ? fmtCvt(mark.markPrice, cur) : { text: '--', title: '' };
          const stopFmt   = t.stopPrice   != null ? fmtCvt(t.stopPrice,   cur) : { text: '--', title: '' };
          const targetFmt = t.targetPrice != null ? fmtCvt(t.targetPrice, cur) : { text: '--', title: '' };
          const exitFmt   = t.exitPrice   != null ? fmtCvt(t.exitPrice,   cur) : { text: '--', title: '' };

          // P&L: convert native pnl to displayCur
          const pnlConverted = rawPnl != null ? cvt(rawPnl, cur) : null;

          // For pending rows, prices are just the limit price - no mark
          const isPending = t.status === 'pending';

          return (
            <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '3px 6px', color: 'var(--text-muted)' }}>{fmtDate(t.entryTime)}</td>
              <td style={{ padding: '3px 6px', color: 'var(--color-accent)', fontWeight: 600 }}>{t.symbol}</td>
              <td style={{ padding: '3px 6px', color: 'var(--text-muted)' }}>{t.strategyId}</td>
              <td style={{ padding: '3px 6px', textAlign: 'center', color: t.side === 'long' ? 'var(--color-up)' : 'var(--color-down)', fontWeight: 600 }}>
                {t.side.toUpperCase()}
              </td>
              <td style={{ padding: '3px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} title={entryFmt.title}>
                {isPending ? <span style={{ color: '#e6a817' }}>LIMIT {entryFmt.text}</span> : entryFmt.text}
              </td>
              <td style={{ padding: '3px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', ...(mark != null ? pnlStyle(mark.unrealizedPnl) : { color: 'var(--text-muted)' }) }} title={curFmt.title}>
                {isPending ? '--' : curFmt.text}
              </td>
              <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--color-down)', fontVariantNumeric: 'tabular-nums' }} title={stopFmt.title}>
                {stopFmt.text}
              </td>
              <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--color-up)', fontVariantNumeric: 'tabular-nums' }} title={targetFmt.title}>
                {targetFmt.text}
              </td>
              <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {fmtNum(t.qty, 4)}
              </td>
              <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }} title={exitFmt.title}>
                {exitFmt.text}
              </td>
              <td style={{ padding: '3px 6px', textAlign: 'right', ...pnlStyle(pnlConverted) }}
                  title={rawPnl != null && cur !== displayCur ? `${fmtPnl(rawPnl, cur)} (native)` : undefined}>
                {pnlConverted != null && !isPending
                  ? `${isMtm ? '~' : ''}${fmtPnl(pnlConverted, displayCur)}`
                  : '--'}
              </td>
              <td style={{ padding: '3px 6px', textAlign: 'right', ...pnlStyle(displayPnlPct ?? null) }}>
                {displayPnlPct != null && !isPending ? `${isMtm ? '~' : ''}${pct(displayPnlPct)}` : '--'}
              </td>
              <td style={{ padding: '3px 6px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }} title={hold.title}>
                {isPending ? '--' : hold.text}
              </td>
              <td style={{
                padding: '3px 6px',
                textAlign: 'center',
                color: t.status === 'open'
                  ? 'var(--color-accent)'
                  : t.status === 'pending'
                    ? '#e6a817'
                    : 'var(--text-muted)',
              }}>
                {t.status.toUpperCase()}
              </td>
              <td style={{ padding: '3px 6px', textAlign: 'center' }}>
                {t.status === 'open' && (
                  <button
                    onClick={() => onClose(t.id)}
                    style={{
                      background:   'var(--bg-panel)',
                      border:       '1px solid var(--color-down)',
                      color:        'var(--color-down)',
                      fontFamily:   'var(--font-mono)',
                      fontSize:     'var(--fs-xs)',
                      padding:      '1px 6px',
                      cursor:       'pointer',
                    }}
                  >
                    CLOSE
                  </button>
                )}
                {t.status === 'pending' && (
                  <button
                    onClick={() => onCancel(t.id)}
                    style={{
                      background:   'var(--bg-panel)',
                      border:       '1px solid #e6a817',
                      color:        '#e6a817',
                      fontFamily:   'var(--font-mono)',
                      fontSize:     'var(--fs-xs)',
                      padding:      '1px 6px',
                      cursor:       'pointer',
                    }}
                  >
                    CANCEL
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Page (client component - needs state for new trade form + close action)
// ---------------------------------------------------------------------------

export default function PaperPage() {
  const [trades,       setTrades]       = useState<PaperTradeWithHold[]>([]);
  const [marks,        setMarks]        = useState<Map<string, MarkEntry>>(new Map());
  const [book,         setBook]         = useState<TradeBook | null>(null);
  const [account,      setAccount]      = useState<AccountSummary | null>(null);
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
    const [tRes, bRes, mRes, aRes] = await Promise.all([
      fetch('/api/paper', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list' }) }),
      fetch('/api/paper', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'tradebook' }) }),
      fetch('/api/paper', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'mark', useQuotes: false }) }),
      fetch('/api/paper', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'account' }) }),
    ]);
    if (aRes.ok) {
      const { account: acct } = await aRes.json() as { account: AccountSummary | null };
      setAccount(acct);
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
      {/* Status bar */}
      <div
        className="flex items-center justify-between px-4 py-2 shrink-0"
        style={{ background: 'var(--bg-panel-header)', borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-4">
          <span style={{ color: 'var(--color-accent)', fontWeight: 700, letterSpacing: '0.1em', fontSize: 'var(--fs-sm)' }}>
            QUANTDESK
          </span>
          <nav className="flex gap-3" style={{ fontSize: 'var(--fs-xs)' }}>
            <a href="/" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>DASH</a>
            <a href="/backtest" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>BACKTEST</a>
            <a href="/compare" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>COMPARE</a>
            <a href="/paper" style={{ color: 'var(--color-accent)', textDecoration: 'none' }}>PAPER</a>
            <a href="/journal" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>JOURNAL</a>
            <a href="/settings" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>SETTINGS</a>
          </nav>
        </div>
        <div className="flex items-center gap-3">
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
        </div>
      </div>

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
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-mono)' }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left',   padding: '2px 6px', fontWeight: 400 }}>SYMBOL</th>
                  <th style={{ textAlign: 'center', padding: '2px 6px', fontWeight: 400 }}>SIDE</th>
                  <th style={{ textAlign: 'right',  padding: '2px 6px', fontWeight: 400 }}>LIMIT</th>
                  <th style={{ textAlign: 'right',  padding: '2px 6px', fontWeight: 400 }}>CURRENT</th>
                  <th style={{ textAlign: 'right',  padding: '2px 6px', fontWeight: 400 }}>DISTANCE</th>
                  <th style={{ textAlign: 'right',  padding: '2px 6px', fontWeight: 400 }}>STOP</th>
                  <th style={{ textAlign: 'right',  padding: '2px 6px', fontWeight: 400 }}>TARGET</th>
                  <th style={{ textAlign: 'right',  padding: '2px 6px', fontWeight: 400 }}>QTY</th>
                  <th style={{ textAlign: 'left',   padding: '2px 6px', fontWeight: 400 }}>REQUESTED</th>
                  <th style={{ textAlign: 'left',   padding: '2px 6px', fontWeight: 400 }}>FILL CHECK</th>
                  <th style={{ textAlign: 'center', padding: '2px 6px', fontWeight: 400 }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {pendingOrders.map((order) => {
                  const diag   = fillDiagnostics.get(order.id);
                  const limit  = order.entryPrice;
                  const cur    = order.currency ?? 'USD';

                  // Distance from limit (+ = favorable, - = needs to move further)
                  let distPct: number | null = null;
                  let distColor              = 'var(--text-muted)';
                  let currentCell            = '--';
                  if (diag?.quotePrice != null) {
                    currentCell = fmtMoney(diag.quotePrice, cur);
                    const raw   = (diag.quotePrice - limit) / limit * 100;
                    // For long: positive raw = price above limit = further from fill (bad)
                    // For short: negative raw = price below limit = further from fill (bad)
                    distPct = order.side === 'long' ? raw : -raw;
                    // distPct < 0 means approaching the fill
                    distColor = distPct <= 0
                      ? 'var(--color-up)'    // heading toward fill
                      : 'var(--color-down)'; // moving away
                  }

                  // Fill-check status line
                  let fillCheckNode: React.ReactNode = <span style={{ color: 'var(--text-muted)' }}>--</span>;
                  if (diag) {
                    const col = diag.action === 'filled'       ? 'var(--color-up)'
                              : diag.action === 'fill-blocked' ? 'var(--color-down)'
                              : diag.crossed                   ? '#e6a817'
                              : 'var(--text-muted)';
                    fillCheckNode = (
                      <span style={{ color: col, whiteSpace: 'nowrap' }}
                            title={diag.reason ?? ''}>
                        {diag.action === 'filled'       ? `FILLED @ ${fmtMoney(diag.fillPrice ?? limit, cur)}`
                         : diag.action === 'fill-blocked' ? 'BLOCKED (budget/risk)'
                         : diag.reason ?? 'checking...'}
                      </span>
                    );
                  }

                  return (
                    <tr key={order.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '3px 6px', color: 'var(--color-accent)', fontWeight: 600 }}>
                        {order.symbol}
                      </td>
                      <td style={{ padding: '3px 6px', textAlign: 'center',
                                   color: order.side === 'long' ? 'var(--color-up)' : 'var(--color-down)',
                                   fontWeight: 700 }}>
                        {order.side.toUpperCase()}
                      </td>
                      <td style={{ padding: '3px 6px', textAlign: 'right', color: '#e6a817', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtMoney(limit, cur)}
                      </td>
                      <td style={{ padding: '3px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                                   color: diag?.quotePrice != null ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                        {currentCell}
                      </td>
                      <td style={{ padding: '3px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                                   color: distPct != null ? distColor : 'var(--text-muted)' }}>
                        {distPct != null
                          ? `${distPct >= 0 ? '+' : ''}${distPct.toFixed(2)}%`
                          : '--'}
                      </td>
                      <td style={{ padding: '3px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                                   color: order.stopPrice != null ? 'var(--color-down)' : 'var(--text-muted)' }}>
                        {order.stopPrice != null ? fmtMoney(order.stopPrice, cur) : '--'}
                      </td>
                      <td style={{ padding: '3px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                                   color: order.targetPrice != null ? 'var(--color-up)' : 'var(--text-muted)' }}>
                        {order.targetPrice != null ? fmtMoney(order.targetPrice, cur) : '--'}
                      </td>
                      <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                        {fmtNum(order.qty, 4)}
                      </td>
                      <td style={{ padding: '3px 6px', color: 'var(--text-muted)' }}>
                        {fmtDate(order.entryTime)}
                      </td>
                      <td style={{ padding: '3px 6px', fontSize: 'var(--fs-xs)', maxWidth: 260, overflow: 'hidden',
                                   textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {fillCheckNode}
                      </td>
                      <td style={{ padding: '3px 6px', textAlign: 'center' }}>
                        <button
                          onClick={() => void handleCancel(order.id)}
                          style={{
                            background:  'var(--bg-panel)',
                            border:      '1px solid var(--color-down)',
                            color:       'var(--color-down)',
                            fontFamily:  'var(--font-mono)',
                            fontSize:    'var(--fs-xs)',
                            padding:     '1px 6px',
                            cursor:      'pointer',
                          }}
                        >
                          CANCEL
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
