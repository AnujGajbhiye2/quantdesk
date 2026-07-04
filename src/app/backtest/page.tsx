'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import DublinClock from '@/components/primitives/DublinClock';
import AppHeader from '@/components/primitives/AppHeader';
import MetricsPanel from '@/components/panels/MetricsPanel';
import TradesTable from '@/components/panels/TradesTable';
import MonthlyReturnsHeatmap from '@/components/charts/MonthlyReturnsHeatmap';
import ExitProjection, { type ExitProjectionData } from '@/components/trade/ExitProjection';
import SignalTimeline from '@/components/charts/SignalTimeline';
import type { BacktestResult } from '@/core/backtest/engine';
import type { Bar, TradeIdea } from '@/core/types';
import { toWeekly } from '@/core/data/resample';
import { compute as computeIndicator } from '@/core/indicators/registry';
import type { OverlayLine, IndicatorPane } from '@/components/charts/PriceChart';
import ResearchTabs, { saveLastSymbol, getLastSymbol } from '@/components/primitives/ResearchTabs';

// Charts must be client-side only (no SSR)
const PriceChart       = dynamic(() => import('@/components/charts/PriceChart'), { ssr: false });
const EquityCurveChart = dynamic(() => import('@/components/charts/EquityCurveChart'), { ssr: false });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Strategy { id: string; name: string; description: string }

type BacktestResponse = BacktestResult & {
  currentIdea: TradeIdea | null;
  projection:  ExitProjectionData | null;
};

interface SavedRun {
  id:         string;
  createdAt:  string;
  strategyId: string;
  symbol:     string;
  timeframe:  string;
  metrics:    { totalReturnPct: number; sharpe: number; maxDrawdownPct: number; numTrades: number };
}

// ---------------------------------------------------------------------------
// On-chart indicators
// ---------------------------------------------------------------------------

type IndicatorToggle = 'BB' | 'SMA20' | 'SMA50' | 'RSI' | 'STOCH' | 'VOL';
const ALL_TOGGLES: IndicatorToggle[] = ['BB', 'SMA20', 'SMA50', 'RSI', 'STOCH', 'VOL'];

// Each live strategy's trigger indicator - selecting the strategy auto-enables
// the set that makes its signals explainable on the chart. Params match the
// strategies' defaults (bollinger 20/2, RSI 14, stoch 14/3/3).
const STRATEGY_TOGGLES: Record<string, IndicatorToggle[]> = {
  'bollinger-reversion': ['BB', 'VOL'],
  'rsi-reversion':       ['RSI', 'VOL'],
  'stoch-reversal':      ['STOCH', 'VOL'],
};

function buildIndicators(bars: Bar[], active: Set<IndicatorToggle>): {
  overlays: OverlayLine[];
  panes: IndicatorPane[];
} {
  const overlays: OverlayLine[] = [];
  const panes: IndicatorPane[] = [];
  if (bars.length < 2) return { overlays, panes };

  const asRecord = (v: ReturnType<typeof computeIndicator>) => v as Record<string, number[]>;
  const asArray  = (v: ReturnType<typeof computeIndicator>) => v as number[];

  if (active.has('BB')) {
    const bb = asRecord(computeIndicator('bbands', bars, { period: 20, stddev: 2 }));
    overlays.push(
      { id: 'bb-upper',  color: '#58a6ff', values: bb.upper },
      { id: 'bb-middle', color: '#58a6ff', values: bb.middle, dashed: true },
      { id: 'bb-lower',  color: '#58a6ff', values: bb.lower },
    );
  }
  if (active.has('SMA20')) {
    overlays.push({ id: 'sma20', color: '#e3b341', values: asArray(computeIndicator('sma', bars, { period: 20 })) });
  }
  if (active.has('SMA50')) {
    overlays.push({ id: 'sma50', color: '#bc8cff', values: asArray(computeIndicator('sma', bars, { period: 50 })) });
  }
  if (active.has('RSI')) {
    panes.push({
      id: 'rsi',
      lines: [{ id: 'rsi', color: '#58a6ff', values: asArray(computeIndicator('rsi', bars, { period: 14 })) }],
      refLines: [{ value: 30, color: '#26a641' }, { value: 50, color: '#8b949e' }, { value: 70, color: '#f85149' }],
    });
  }
  if (active.has('STOCH')) {
    const st = asRecord(computeIndicator('stoch', bars, { kperiod: 14, kslow: 3, dperiod: 3 }));
    panes.push({
      id: 'stoch',
      lines: [
        { id: 'k', color: '#58a6ff', values: st.k },
        { id: 'd', color: '#e3b341', values: st.d },
      ],
      refLines: [{ value: 20, color: '#26a641' }, { value: 80, color: '#f85149' }],
    });
  }
  if (active.has('VOL')) {
    panes.push({
      id: 'volume',
      lines: [{ id: 'vol', color: '#8b949e', values: bars.map((b) => b.volume) }],
      histogram: true,
    });
  }
  return { overlays, panes };
}

// ---------------------------------------------------------------------------
// Error message classifier
// ---------------------------------------------------------------------------

function classifyBacktestError(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes('no bars found') || lower.includes('ingest data first')) {
    return `no data - run: npm run ingest -- --universe <json>`;
  }
  if (
    lower.includes('rate') ||
    lower.includes('429') ||
    lower.includes('too many requests') ||
    lower.includes('quota')
  ) {
    return 'provider rate-limited - wait a moment and retry';
  }
  if (lower.includes('not registered') || lower.includes('strategy')) {
    return `strategy error: ${msg}`;
  }
  return `error: ${msg}`;
}

// ---------------------------------------------------------------------------
// Inner page (uses useSearchParams - must be inside Suspense)
// ---------------------------------------------------------------------------

function BacktestInner() {
  const searchParams = useSearchParams();

  const [symbol,     setSymbol]     = useState(searchParams.get('symbol') ?? '');
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [strategyId, setStrategyId] = useState('');
  const [result,     setResult]     = useState<BacktestResponse | null>(null);
  const [bars,       setBars]       = useState<Bar[]>([]);
  const [status,     setStatus]     = useState('');
  const [busy,       setBusy]       = useState(false);
  const [chartTf,    setChartTf]    = useState<'15m' | '1d' | '1w'>('1d');
  const [rawBars,    setRawBars]    = useState<Bar[]>([]);
  const [bars15m,    setBars15m]    = useState<Bar[] | null>(null); // lazy-fetched on first 15m toggle
  const [runs,       setRuns]       = useState<SavedRun[]>([]);

  const loadRuns = () => {
    fetch('/api/backtest?runs=30')
      .then((r) => r.json())
      .then((d: { runs?: SavedRun[] }) => setRuns(d.runs ?? []))
      .catch(() => { /* history is best-effort */ });
  };
  useEffect(loadRuns, []);
  const [indToggles, setIndToggles] = useState<Set<IndicatorToggle>>(new Set(['VOL']));

  // Selecting a strategy auto-enables its trigger indicator set
  useEffect(() => {
    const preset = STRATEGY_TOGGLES[strategyId];
    if (preset) setIndToggles(new Set(preset));
  }, [strategyId]);

  const { overlays, panes } = useMemo(
    () => buildIndicators(bars, indToggles),
    [bars, indToggles],
  );

  function toggleIndicator(t: IndicatorToggle) {
    setIndToggles((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  }

  const strategyNames = useMemo(
    () => Object.fromEntries(strategies.map((s) => [s.id, s.name])),
    [strategies],
  );

  // Load strategy list on mount
  useEffect(() => {
    fetch('/api/strategies')
      .then((r) => r.json())
      .then((d: { strategies: Strategy[] }) => {
        setStrategies(d.strategies);
        // ?strategy=<id> (e.g. from the /compare table) preselects a strategy
        const urlStrat = searchParams.get('strategy');
        const preferred = d.strategies.find((s) => s.id === urlStrat)?.id
          ?? d.strategies[0]?.id;
        if (preferred && !strategyId) setStrategyId(preferred);
      })
      .catch(() => setStatus('could not load strategies'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-run if symbol supplied in URL (also re-fires when the shared research
  // search box navigates here with a new ?symbol=), else fall back to the last
  // symbol searched.
  const urlSymbolParam = searchParams.get('symbol');
  useEffect(() => {
    const urlSym = urlSymbolParam ?? getLastSymbol();
    if (urlSym && strategyId) {
      setSymbol(urlSym);
      runBacktest(urlSym, strategyId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategyId, urlSymbolParam]);

  // Re-resample / re-fetch when timeframe toggle changes. 15m bars exist only
  // for the auto-trade universe and are lazy-fetched once per symbol.
  useEffect(() => {
    if (rawBars.length === 0) return;
    if (chartTf === '15m') {
      if (bars15m) { setBars(bars15m); return; }
      fetch(`/api/bars?symbol=${encodeURIComponent(symbol)}&timeframe=15m`)
        .then((r) => r.json())
        .then((d: { bars: Bar[] }) => {
          const b = d.bars ?? [];
          setBars15m(b);
          setBars(b.length > 0 ? b : rawBars);
          if (b.length === 0) setStatus('no 15m bars stored for this symbol - showing daily');
        })
        .catch(() => setBars(rawBars));
      return;
    }
    setBars(chartTf === '1w' ? toWeekly(rawBars) : rawBars);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartTf]);

  async function runBacktest(sym?: string, sid?: string) {
    const s = sym ?? symbol;
    const id = sid ?? strategyId;
    if (!s) { setStatus('enter a symbol'); return; }
    if (!id) { setStatus('select a strategy'); return; }

    setBusy(true);
    setStatus(`running ${id} on ${s}...`);
    setResult(null);
    setBars([]);

    try {
      const res = await fetch('/api/backtest', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ strategyId: id, symbol: s }),
      });
      const data = await res.json() as BacktestResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? res.statusText);

      setResult(data);
      // Re-fetch bars for the chart (they're not in BacktestResult)
      const bRes  = await fetch(`/api/bars?symbol=${encodeURIComponent(s)}`);
      const bData = await bRes.json() as { bars: Bar[] };
      const daily = bData.bars ?? [];
      setRawBars(daily);
      setBars15m(null); // new symbol - stale 15m cache
      setBars(chartTf === '1w' ? toWeekly(daily) : daily);

      setStatus(`${data.trades.length} trades | return ${data.metrics.totalReturnPct.toFixed(2)}%`);
      saveLastSymbol(s);
      loadRuns(); // pick up the just-saved run in the history list
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(classifyBacktestError(msg));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-full" style={{ minHeight: '100vh' }}>
      <AppHeader right={<DublinClock />} />
      <ResearchTabs symbol={symbol} />

      {/* Page-specific toolbar: strategy pick + chart controls, not global nav */}
      <form
        onSubmit={(e) => { e.preventDefault(); void runBacktest(); }}
        className="flex items-center gap-3 px-4 py-1 flex-wrap shrink-0"
        style={{ background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)' }}
      >
        {symbol && <span style={{ color: 'var(--color-accent)', fontSize: 'var(--fs-xs)', fontWeight: 700 }}>{symbol}</span>}
        <select
          value={strategyId}
          onChange={(e) => setStrategyId(e.target.value)}
          style={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-xs)',
            padding: '3px 8px',
            maxWidth: '100%',
            minWidth: 0,
          }}
        >
          {strategies.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <button
          type="submit"
          disabled={busy}
          style={{
            background: 'var(--bg-panel-header)',
            border: '1px solid var(--border)',
            color: 'var(--color-accent)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-xs)',
            padding: '3px 12px',
            cursor: 'pointer',
          }}
        >
          {busy ? '...' : 'RUN'}
        </button>
        <div className="flex items-center gap-1 shrink-0">
          {(['15m', '1d', '1w'] as const).map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => setChartTf(tf)}
              style={{
                background:   chartTf === tf ? 'var(--color-accent)' : 'var(--bg-panel)',
                border:       '1px solid var(--border)',
                color:        chartTf === tf ? '#0a0e14' : 'var(--text-muted)',
                fontFamily:   'var(--font-mono)',
                fontSize:     'var(--fs-xs)',
                padding:      '2px 8px',
                cursor:       'pointer',
                fontWeight:   chartTf === tf ? 700 : 400,
              }}
            >
              {tf.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 shrink-0" title="on-chart indicators - strategy selection presets its trigger set">
          {ALL_TOGGLES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => toggleIndicator(t)}
              style={{
                background:   indToggles.has(t) ? 'var(--bg-panel-header)' : 'var(--bg-panel)',
                border:       `1px solid ${indToggles.has(t) ? 'var(--color-accent)' : 'var(--border)'}`,
                color:        indToggles.has(t) ? 'var(--color-accent)' : 'var(--text-muted)',
                fontFamily:   'var(--font-mono)',
                fontSize:     'var(--fs-xs)',
                padding:      '2px 6px',
                cursor:       'pointer',
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', flexShrink: 0 }}>{status}</span>
      </form>

      {/* Body - page scrolls; chart row on top, result detail below */}
      <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
        <div
          className="grid"
          style={{
            gridTemplateColumns: result ? '1fr 240px' : '1fr',
            gap: '1px',
            background: 'var(--border)',
          }}
        >
          {/* Chart with current-idea price lines */}
          <div
            style={{
              background: 'var(--bg-panel)',
              overflow: 'hidden',
              position: 'relative',
              height: 440,
            }}
          >
            {result ? (
              <PriceChart
                bars={bars}
                trades={result.trades}
                entryPrice={result.currentIdea?.entryPrice}
                stopPrice={result.currentIdea?.stopPrice}
                targetPrice={result.currentIdea?.targetPrice}
                overlays={overlays}
                panes={panes}
                zoomStorageKey="qd-backtest-chart-zoom"
              />
            ) : (
              <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
                {busy ? 'Loading...' : 'Enter a symbol and select a strategy, then click RUN.'}
              </div>
            )}
          </div>

          {/* Right column: metrics + current signal projection */}
          {result && (
            <div
              style={{
                background: 'var(--bg-panel)',
                overflow: 'auto',
                height: 440,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <MetricsPanel metrics={result.metrics} numTrades={result.trades.length} />
              {result.currentIdea && (
                <ExitProjection idea={result.currentIdea} projection={result.projection} />
              )}
            </div>
          )}
        </div>

        {/* Signal history timeline: every stored signal from every strategy */}
        {result && (
          <SignalTimeline
            symbol={result.symbol}
            strategyNames={strategyNames}
          />
        )}

        {/* Result detail: trades + equity curve, then monthly heatmap */}
        {result && (
          <div
            className="grid grid-cols-12 gap-px"
            style={{ background: 'var(--border)', borderTop: '1px solid var(--border)' }}
          >
            <div className="col-span-7" style={{ background: 'var(--bg-panel)', height: 300 }}>
              <TradesTable trades={result.trades} />
            </div>
            <div className="col-span-5" style={{ background: 'var(--bg-panel)', height: 300 }}>
              <EquityCurveChart equityCurve={result.equityCurve} />
            </div>
            <div className="col-span-12" style={{ background: 'var(--bg-panel)' }}>
              <MonthlyReturnsHeatmap equityCurve={result.equityCurve} />
            </div>
          </div>
        )}

        {/* Saved run history - params + metrics snapshots, recallable (WS4.5) */}
        {runs.length > 0 && (
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', letterSpacing: '0.08em', marginBottom: 8 }}>
              [ RUN HISTORY - click to re-run ]
            </div>
            <table style={{ width: '100%', fontSize: 'var(--fs-xs)', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                  <th style={{ padding: '2px 8px' }}>WHEN</th>
                  <th style={{ padding: '2px 8px' }}>STRATEGY</th>
                  <th style={{ padding: '2px 8px' }}>SYMBOL</th>
                  <th style={{ padding: '2px 8px', textAlign: 'right' }}>RET%</th>
                  <th style={{ padding: '2px 8px', textAlign: 'right' }}>SHARPE</th>
                  <th style={{ padding: '2px 8px', textAlign: 'right' }}>MAXDD%</th>
                  <th style={{ padding: '2px 8px', textAlign: 'right' }}>TRADES</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => { setSymbol(r.symbol); setStrategyId(r.strategyId); void runBacktest(r.symbol, r.strategyId); }}
                    style={{ cursor: 'pointer', borderTop: '1px solid var(--border)' }}
                  >
                    <td style={{ padding: '3px 8px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {r.createdAt.slice(0, 16).replace('T', ' ')}
                    </td>
                    <td style={{ padding: '3px 8px' }}>{strategyNames[r.strategyId] ?? r.strategyId}</td>
                    <td style={{ padding: '3px 8px', color: 'var(--color-accent)' }}>{r.symbol}</td>
                    <td style={{ padding: '3px 8px', textAlign: 'right', color: r.metrics.totalReturnPct >= 0 ? '#26a641' : '#f85149' }}>
                      {r.metrics.totalReturnPct.toFixed(1)}
                    </td>
                    <td style={{ padding: '3px 8px', textAlign: 'right' }}>{r.metrics.sharpe.toFixed(2)}</td>
                    <td style={{ padding: '3px 8px', textAlign: 'right' }}>{r.metrics.maxDrawdownPct.toFixed(1)}</td>
                    <td style={{ padding: '3px 8px', textAlign: 'right' }}>{r.metrics.numTrades}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
        Research tool. Not financial advice. Backtests are hypothetical and subject to survivorship and look-ahead error.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exported page - wraps inner in Suspense (required by useSearchParams)
// ---------------------------------------------------------------------------

export default function BacktestPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: 24, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          Loading...
        </div>
      }
    >
      <BacktestInner />
    </Suspense>
  );
}
