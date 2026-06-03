'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import DublinClock from './DublinClock';
import CommandBar, { type CommandBarHandle } from './CommandBar';
import ScanResultsPanel from './ScanResultsPanel';
import GainersLosersPanel from './GainersLosersPanel';
import SignalDashboardPanel from './SignalDashboardPanel';
import TradesPanel from './TradesPanel';
import MarketSummaryStrip from './MarketSummaryStrip';
import GoToSymbolOverlay from './GoToSymbolOverlay';
import { useKeyboardNav } from './useKeyboardNav';
import type { MarketRow } from '@/core/market/snapshot';
import type { PaperTrade, Signal, SymbolMeta } from '@/core/types';
import { marketOf, ALL_MARKETS, type Market } from '@/core/market/markets';

interface Props {
  initialRows:       MarketRow[];
  initialTrades:     PaperTrade[];
  initialStrategies: { id: string; name: string }[];
  allSymbols:        { symbol: string; name: string; assetClass: SymbolMeta['assetClass']; exchange?: string }[];
}

export default function Dashboard({
  initialRows,
  initialTrades,
  initialStrategies,
  allSymbols,
}: Props) {
  const [rows,       setRows]       = useState<MarketRow[]>(initialRows);
  const [trades,     setTrades]     = useState<PaperTrade[]>(initialTrades);
  const [signals,    setSignals]    = useState<Signal[]>([]);
  const [strategies]               = useState(initialStrategies);
  const [scanStratId, setScanStratId] = useState(initialStrategies[0]?.id ?? '');
  const [gotoOpen,   setGotoOpen]  = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [scanStatus, setScanStatus] = useState('');
  const [marketFilter, setMarketFilter] = useState<Market | 'ALL'>('ALL');
  const cmdRef = useRef<CommandBarHandle>(null);
  const router = useRouter();

  // Build a symbol -> market map from allSymbols (already has assetClass/exchange)
  const symbolMarketMap = useRef(new Map<string, Market>());
  useEffect(() => {
    symbolMarketMap.current.clear();
    for (const s of allSymbols) {
      symbolMarketMap.current.set(s.symbol, marketOf({ symbol: s.symbol, assetClass: s.assetClass, exchange: s.exchange }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSymbols]);

  // Visible markets (only show tabs for markets present in the current data)
  const presentMarkets = ALL_MARKETS.filter((m) =>
    rows.some((r) => symbolMarketMap.current.get(r.symbol) === m),
  );

  const filteredRows = marketFilter === 'ALL'
    ? rows
    : rows.filter((r) => symbolMarketMap.current.get(r.symbol) === marketFilter);

  const { selected, setSelected } = useKeyboardNav({
    count:        rows.length,
    onActivate:   (i) => {
      if (rows[i]) router.push(`/backtest?symbol=${rows[i].symbol}`);
    },
    onCommand:    () => cmdRef.current?.focus(),
    onGoToSymbol: () => setGotoOpen(true),
    enabled:      !gotoOpen,
  });

  const handleMarketRefresh = useCallback((newRows: MarketRow[]) => {
    setRows(newRows);
    setSelected(-1);
  }, [setSelected]);

  const handleSignals = useCallback((sigs: Signal[]) => {
    setSignals(sigs);
  }, []);

  // Fetch fresh market + trades data
  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const [mRes, tRes] = await Promise.all([
        fetch('/api/market'),
        fetch('/api/paper', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list' }) }),
      ]);
      if (mRes.ok) {
        const { rows: newRows } = await mRes.json() as { rows: MarketRow[] };
        setRows(newRows);
        setSelected(-1);
      }
      if (tRes.ok) {
        const { trades: newTrades } = await tRes.json() as { trades: PaperTrade[] };
        setTrades(newTrades);
      }
    } finally {
      setRefreshing(false);
    }
  }, [setSelected]);

  // Quick scan from the signal-dashboard strategy picker
  const quickScan = useCallback(async () => {
    if (!scanStratId) return;
    setScanStatus('scanning...');
    try {
      const res = await fetch('/api/scan', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ strategyId: scanStratId }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { signals: Signal[]; scanned: number; durationMs: number };
      setSignals(data.signals);
      setScanStatus(`${data.signals.length} signal(s) across ${data.scanned} symbol(s) in ${data.durationMs}ms`);
    } catch (err) {
      setScanStatus(`error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [scanStratId]);

  // Auto-run quick scan when strategy changes (if signals already shown)
  useEffect(() => {
    if (signals.length > 0) void quickScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanStratId]);

  return (
    <>
      {gotoOpen && (
        <GoToSymbolOverlay
          allSymbols={allSymbols}
          onClose={() => setGotoOpen(false)}
        />
      )}

      <div className="flex flex-col h-full" style={{ minHeight: '100vh' }}>
        {/* Status bar */}
        <div
          className="flex items-center justify-between px-4 py-2 shrink-0 gap-4"
          style={{
            background: 'var(--bg-panel-header)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div className="flex items-center gap-4 shrink-0">
            <span style={{ color: 'var(--color-accent)', fontWeight: 700, letterSpacing: '0.1em', fontSize: '13px' }}>
              QUANTDESK
            </span>
            <nav className="flex gap-3" style={{ fontSize: '11px' }}>
              <a href="/" style={{ color: 'var(--color-accent)', textDecoration: 'none' }}>DASH</a>
              <a href="/backtest" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>BACKTEST</a>
              <a href="/paper" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>PAPER</a>
            </nav>
          </div>

          <CommandBar
            ref={cmdRef}
            onMarketRefresh={handleMarketRefresh}
            onSignals={handleSignals}
          />

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => void refreshAll()}
              disabled={refreshing}
              title="Refresh market data"
              style={{
                background: 'var(--bg-panel)',
                border: '1px solid var(--border)',
                color: refreshing ? 'var(--color-accent)' : 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                padding: '2px 8px',
                cursor: 'pointer',
                letterSpacing: '0.04em',
              }}
            >
              {refreshing ? 'REFRESHING...' : 'REFRESH'}
            </button>
            <span style={{ color: 'var(--text-muted)', fontSize: '10px', whiteSpace: 'nowrap' }}>
              [/] cmd &nbsp; [g] symbol &nbsp; [j/k] nav
            </span>
            <DublinClock />
          </div>
        </div>

        {/* Strategy picker bar for signal dashboard */}
        <div
          className="flex items-center gap-3 px-4 py-1 shrink-0"
          style={{ background: 'var(--bg-panel-header)', borderBottom: '1px solid var(--border)' }}
        >
          <span style={{ color: 'var(--text-muted)', fontSize: '10px', letterSpacing: '0.06em' }}>SIGNAL SCAN:</span>
          <select
            value={scanStratId}
            onChange={(e) => setScanStratId(e.target.value)}
            style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              padding: '1px 6px',
            }}
          >
            {strategies.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
            {strategies.length === 0 && <option value="">no strategies</option>}
          </select>
          <button
            onClick={() => void quickScan()}
            style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              color: 'var(--color-accent)',
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              padding: '1px 10px',
              cursor: 'pointer',
            }}
          >
            SCAN
          </button>
          {scanStatus && (
            <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{scanStatus}</span>
          )}
        </div>

        {/* Market filter tabs */}
        {presentMarkets.length > 0 && (
          <div
            className="flex items-center gap-1 px-4 py-1 shrink-0 overflow-x-auto"
            style={{ background: 'var(--bg-panel-header)', borderBottom: '1px solid var(--border)' }}
          >
            {(['ALL', ...presentMarkets] as (Market | 'ALL')[]).map((m) => (
              <button
                key={m}
                onClick={() => { setMarketFilter(m); setSelected(-1); }}
                style={{
                  background: marketFilter === m ? 'var(--color-accent)' : 'var(--bg-panel)',
                  border: '1px solid var(--border)',
                  color: marketFilter === m ? '#0a0e14' : 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--fs-xs)',
                  padding: '1px 10px',
                  cursor: 'pointer',
                  fontWeight: marketFilter === m ? 700 : 400,
                  letterSpacing: '0.06em',
                }}
              >
                {m}
              </button>
            ))}
          </div>
        )}

        {/* Main grid */}
        <div
          className="flex-1 grid overflow-hidden"
          style={{
            gridTemplateRows: '1fr 1fr 120px 80px',
            gridTemplateColumns: '1fr 1fr',
            gap: '1px',
            background: 'var(--border)',
            minHeight: 0,
          }}
        >
          {/* Row 1 */}
          <ScanResultsPanel rows={filteredRows} selected={selected} />
          <GainersLosersPanel rows={filteredRows} />

          {/* Row 2 - Signal dashboard (full width) */}
          <div className="col-span-2 overflow-hidden" style={{ background: 'var(--bg-panel)' }}>
            <SignalDashboardPanel rows={filteredRows} signals={signals} />
          </div>

          {/* Row 3 - Recent trades (full width) */}
          <div className="col-span-2 overflow-hidden" style={{ background: 'var(--bg-panel)' }}>
            <TradesPanel trades={trades} />
          </div>

          {/* Row 4 - Market summary */}
          <MarketSummaryStrip rows={filteredRows} />
        </div>

        {/* Disclaimer */}
        <div
          className="px-4 py-1 shrink-0 text-center"
          style={{
            background: 'var(--bg-base)',
            borderTop: '1px solid var(--border)',
            color: 'var(--text-muted)',
            fontSize: '10px',
            letterSpacing: '0.04em',
          }}
        >
          Research tool. Not financial advice. Backtests are hypothetical and subject to survivorship and look-ahead error.
        </div>
      </div>
    </>
  );
}
