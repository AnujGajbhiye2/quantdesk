'use client';

import { useCallback, useEffect, useState } from 'react';
import DublinClock from '@/components/DublinClock';
import NewPaperTrade from '@/components/NewPaperTrade';
import AccountStrip from '@/components/AccountStrip';
import type { AccountSummary } from '@/core/paper/account';
import { fmtMoney } from '@/core/format/currency';
import type { TradeBook } from '@/core/paper/tradebook';
import type { PaperTradeWithHold } from '@/core/paper/hold';
import type { PaperTrade } from '@/core/types';

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
 * Format a P&L value. Pass currency for per-trade display; omit for
 * aggregate (mixed-currency) totals where the glyph would be misleading.
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

function OverallStats({ book }: { book: TradeBook }) {
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
        { label: 'CLOSED',       value: String(book.closed) },
        { label: 'WIN RATE',       value: `${(book.winRate * 100).toFixed(1)}%` },
        { label: 'TOTAL P&L',      value: fmtPnl(book.totalPnl), color: book.totalPnl >= 0 ? 'var(--color-up)' : 'var(--color-down)' },
        { label: 'OPEN MTM',       value: book.openUnrealizedPnl !== 0 ? `~${fmtPnl(book.openUnrealizedPnl)}` : '--', color: book.openUnrealizedPnl >= 0 ? 'var(--color-up)' : 'var(--color-down)' },
        { label: 'AVG P&L%',       value: pct(book.avgPnlPct), color: book.avgPnlPct >= 0 ? 'var(--color-up)' : 'var(--color-down)' },
        { label: 'OPEN EXPOSURE',  value: fmtPnl(book.openExposure) },
        { label: 'BEST TRADE',   value: book.bestTrade ? fmtPnl(book.bestTrade.pnl) : '--', color: 'var(--color-up)' },
        { label: 'WORST TRADE',  value: book.worstTrade ? fmtPnl(book.worstTrade.pnl) : '--', color: 'var(--color-down)' },
      ].map(({ label, value, color }) => (
        <div key={label} style={{ background: 'var(--bg-panel)', padding: '8px 12px' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', letterSpacing: '0.08em', marginBottom: 2 }}>{label}</div>
          <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 600, color: color ?? 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}

function ByStrategyTable({ book }: { book: TradeBook }) {
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
          <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 400 }}>P&amp;L (CLOSED)</th>
          <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 400 }}>MTM (OPEN)</th>
          <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 400 }}>AVG P&amp;L%</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([id, stats]) => (
          <tr key={id} style={{ borderBottom: '1px solid var(--border)' }}>
            <td style={{ padding: '4px 8px', color: 'var(--color-accent)', fontWeight: 600 }}>{id}</td>
            <td style={{ padding: '4px 8px', textAlign: 'right' }}>{stats.trades}</td>
            <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600 }}>{(stats.winRate * 100).toFixed(1)}%</td>
            <td style={{ padding: '4px 8px', textAlign: 'right', ...pnlStyle(stats.totalPnl) }}>{fmtPnl(stats.totalPnl)}</td>
            <td style={{ padding: '4px 8px', textAlign: 'right', ...pnlStyle(stats.openUnrealizedPnl) }}>
              {stats.openUnrealizedPnl !== 0 ? `~${fmtPnl(stats.openUnrealizedPnl)}` : '--'}
            </td>
            <td style={{ padding: '4px 8px', textAlign: 'right', ...pnlStyle(stats.avgPnlPct) }}>{pct(stats.avgPnlPct)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TradesTable({
  trades,
  marks,
  onClose,
}: {
  trades:  PaperTradeWithHold[];
  marks:   Map<string, MarkEntry>;
  onClose: (id: string) => void;
}) {
  if (trades.length === 0) {
    return <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', padding: 8 }}>no trades yet</p>;
  }
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
      <thead>
        <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
          <th style={{ textAlign: 'left',  padding: '3px 6px', fontWeight: 400 }}>DATE</th>
          <th style={{ textAlign: 'left',  padding: '3px 6px', fontWeight: 400 }}>SYMBOL</th>
          <th style={{ textAlign: 'left',  padding: '3px 6px', fontWeight: 400 }}>STRATEGY</th>
          <th style={{ textAlign: 'center',padding: '3px 6px', fontWeight: 400 }}>SIDE</th>
          <th style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 400 }}>ENTRY</th>
          <th
            style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 400 }}
            title="latest stored close for open trades - what the position is worth right now"
          >
            CUR
          </th>
          <th style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 400 }}>STOP</th>
          <th style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 400 }}>TARGET</th>
          <th style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 400 }}>QTY</th>
          <th style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 400 }}>EXIT</th>
          <th style={{ textAlign: 'right', padding: '3px 6px', fontWeight: 400 }}>P&amp;L</th>
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
          const cur   = t.currency ?? 'USD';
          const mark  = t.status === 'open' ? marks.get(t.id) : undefined;
          const isMtm = mark != null;
          const displayPnl    = isMtm ? mark.unrealizedPnl    : t.pnl;
          const displayPnlPct = isMtm ? mark.unrealizedPnlPct : t.pnlPct;
          const hold          = holdCell(t);

          return (
            <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '3px 6px', color: 'var(--text-muted)' }}>{fmtDate(t.entryTime)}</td>
              <td style={{ padding: '3px 6px', color: 'var(--color-accent)', fontWeight: 600 }}>{t.symbol}</td>
              <td style={{ padding: '3px 6px', color: 'var(--text-muted)' }}>{t.strategyId}</td>
              <td style={{ padding: '3px 6px', textAlign: 'center', color: t.side === 'long' ? 'var(--color-up)' : 'var(--color-down)', fontWeight: 600 }}>
                {t.side.toUpperCase()}
              </td>
              <td style={{ padding: '3px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {fmtMoney(t.entryPrice, cur)}
              </td>
              <td style={{ padding: '3px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', ...(mark != null ? pnlStyle(mark.unrealizedPnl) : { color: 'var(--text-muted)' }) }}>
                {mark != null ? fmtMoney(mark.markPrice, cur) : '--'}
              </td>
              <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--color-down)', fontVariantNumeric: 'tabular-nums' }}>
                {t.stopPrice != null ? fmtMoney(t.stopPrice, cur) : '--'}
              </td>
              <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--color-up)', fontVariantNumeric: 'tabular-nums' }}>
                {t.targetPrice != null ? fmtMoney(t.targetPrice, cur) : '--'}
              </td>
              <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {fmtNum(t.qty, 4)}
              </td>
              <td style={{ padding: '3px 6px', textAlign: 'right', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {t.exitPrice != null ? fmtMoney(t.exitPrice, cur) : '--'}
              </td>
              <td style={{ padding: '3px 6px', textAlign: 'right', ...pnlStyle(displayPnl ?? null) }}>
                {displayPnl != null
                  ? `${isMtm ? '~' : ''}${fmtPnl(displayPnl, cur)}`
                  : '--'}
              </td>
              <td style={{ padding: '3px 6px', textAlign: 'right', ...pnlStyle(displayPnlPct ?? null) }}>
                {displayPnlPct != null ? `${isMtm ? '~' : ''}${pct(displayPnlPct)}` : '--'}
              </td>
              <td style={{ padding: '3px 6px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }} title={hold.title}>
                {hold.text}
              </td>
              <td style={{ padding: '3px 6px', textAlign: 'center', color: t.status === 'open' ? 'var(--color-accent)' : 'var(--text-muted)' }}>
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
  const [trades,    setTrades]    = useState<PaperTradeWithHold[]>([]);
  const [marks,     setMarks]     = useState<Map<string, MarkEntry>>(new Map());
  const [book,      setBook]      = useState<TradeBook | null>(null);
  const [account,   setAccount]   = useState<AccountSummary | null>(null);
  const [sweeping,  setSweeping]  = useState(false);
  const [sweepMsg,  setSweepMsg]  = useState('');

  // Load data on mount (and after mutations)
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
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {sweepMsg && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{sweepMsg}</span>}
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

      {/* New trade form */}
      <NewPaperTrade onOpened={handleOpened} />

      {/* Body */}
      <div className="flex-1 overflow-auto" style={{ background: 'var(--bg-base)' }}>
        {/* Overall stats */}
        {book && <OverallStats book={book} />}

        {/* By strategy */}
        {book && (
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', letterSpacing: '0.08em', marginBottom: 8 }}>
              [ PERFORMANCE BY STRATEGY ]
            </div>
            <ByStrategyTable book={book} />
          </div>
        )}

        {/* Trades */}
        <div style={{ padding: '12px 16px' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', letterSpacing: '0.08em', marginBottom: 8 }}>
            [ ALL TRADES ({trades.length}) ]
          </div>
          <TradesTable trades={trades} marks={marks} onClose={handleClose} />
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
