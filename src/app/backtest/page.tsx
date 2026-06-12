'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import DublinClock from '@/components/DublinClock';
import MetricsPanel from '@/components/MetricsPanel';
import TradesTable from '@/components/TradesTable';
import MonthlyReturnsHeatmap from '@/components/MonthlyReturnsHeatmap';
import ExitProjection, { type ExitProjectionData } from '@/components/ExitProjection';
import SignalTimeline from '@/components/SignalTimeline';
import type { BacktestResult } from '@/core/backtest/engine';
import type { Bar, TradeIdea } from '@/core/types';
import { toWeekly } from '@/core/data/resample';

// Charts must be client-side only (no SSR)
const PriceChart       = dynamic(() => import('@/components/PriceChart'), { ssr: false });
const EquityCurveChart = dynamic(() => import('@/components/EquityCurveChart'), { ssr: false });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Strategy { id: string; name: string; description: string }

type BacktestResponse = BacktestResult & {
  currentIdea: TradeIdea | null;
  projection:  ExitProjectionData | null;
};

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

  const [symbol,      setSymbol]     = useState(searchParams.get('symbol') ?? '');
  const [strategies,  setStrategies] = useState<Strategy[]>([]);
  const [strategyId,  setStrategyId] = useState('');
  const [result,      setResult]     = useState<BacktestResponse | null>(null);
  const [bars,        setBars]       = useState<Bar[]>([]);
  const [status,      setStatus]     = useState('');
  const [busy,        setBusy]       = useState(false);
  const [chartTf,       setChartTf]       = useState<'1d' | '1w'>('1d');
  const [rawBars,       setRawBars]       = useState<Bar[]>([]);
  const [suggestions,   setSuggestions]   = useState<Array<{ symbol: string; name: string; inDb?: boolean }>>([]);
  const [suggestCursor, setSuggestCursor] = useState(-1);
  const [suggestOpen,   setSuggestOpen]   = useState(false);
  const [searching,     setSearching]     = useState(false);
  const symbolInput   = useRef<HTMLInputElement>(null);
  const debounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestRef    = useRef<HTMLDivElement>(null);

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

  // Auto-run if symbol supplied in URL
  useEffect(() => {
    const urlSym = searchParams.get('symbol');
    if (urlSym && strategyId) {
      setSymbol(urlSym);
      runBacktest(urlSym, strategyId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategyId]);

  // Re-resample when timeframe toggle changes
  useEffect(() => {
    if (rawBars.length === 0) return;
    setBars(chartTf === '1w' ? toWeekly(rawBars) : rawBars);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartTf]);

  const fetchSuggestions = useCallback((q: string) => {
    if (q.length < 1) { setSuggestions([]); setSuggestOpen(false); setSearching(false); return; }
    setSearching(true);
    setSuggestOpen(true);
    fetch(`/api/search?q=${encodeURIComponent(q)}&limit=8`)
      .then((r) => r.json())
      .then((d: { results?: Array<{ symbol: string; name: string; inDb?: boolean }> }) => {
        const results = d.results ?? [];
        setSuggestions(results);
        setSuggestOpen(results.length > 0);
        setSuggestCursor(-1);
      })
      .catch(() => { setSuggestions([]); setSuggestOpen(false); })
      .finally(() => setSearching(false));
  }, []);

  function handleSymbolChange(val: string) {
    const upper = val.toUpperCase();
    setSymbol(upper);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(upper), 200);
  }

  function pickSuggestion(sym: string) {
    setSymbol(sym);
    setSuggestOpen(false);
    setSuggestions([]);
    symbolInput.current?.focus();
  }

  function handleSymbolKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!suggestOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSuggestCursor((c) => Math.min(c + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSuggestCursor((c) => Math.max(c - 1, -1));
    } else if (e.key === 'Enter' && suggestCursor >= 0) {
      e.preventDefault();
      const picked = suggestions[suggestCursor];
      if (picked) pickSuggestion(picked.symbol);
    } else if (e.key === 'Escape') {
      setSuggestOpen(false);
    }
  }

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
      setBars(chartTf === '1w' ? toWeekly(daily) : daily);

      setStatus(`${data.trades.length} trades | return ${data.metrics.totalReturnPct.toFixed(2)}%`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(classifyBacktestError(msg));
    } finally {
      setBusy(false);
    }
  }

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
            <a href="/backtest" style={{ color: 'var(--color-accent)', textDecoration: 'none' }}>BACKTEST</a>
            <a href="/compare" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>COMPARE</a>
            <a href="/paper" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>PAPER</a>
            <a href="/journal" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>JOURNAL</a>
          </nav>
        </div>

        {/* Controls */}
        <form
          onSubmit={(e) => { e.preventDefault(); void runBacktest(); }}
          className="flex items-center gap-3 flex-1"
          style={{ minWidth: 0 }}
        >
          <div style={{ position: 'relative' }}>
            <input
              ref={symbolInput}
              type="text"
              value={symbol}
              onChange={(e) => handleSymbolChange(e.target.value)}
              onKeyDown={handleSymbolKeyDown}
              onBlur={() => setTimeout(() => setSuggestOpen(false), 200)}
              onFocus={() => { if (suggestions.length > 0) setSuggestOpen(true); }}
              placeholder="SYMBOL"
              autoComplete="off"
              style={{
                background: 'var(--bg-panel)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--fs-xs)',
                padding: '3px 8px',
                width: 120,
              }}
            />
            {suggestOpen && searching && suggestions.length === 0 && (
              <div
                style={{
                  position:   'absolute',
                  top:        '100%',
                  left:       0,
                  zIndex:     200,
                  background: 'var(--bg-panel)',
                  border:     '1px solid var(--border)',
                  minWidth:   260,
                  padding:    '4px 10px',
                  color:      'var(--text-muted)',
                  fontSize:   'var(--fs-xs)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                searching...
              </div>
            )}
            {suggestOpen && suggestions.length > 0 && (
              <div
                ref={suggestRef}
                style={{
                  position:   'absolute',
                  top:        '100%',
                  left:       0,
                  zIndex:     200,
                  background: 'var(--bg-panel)',
                  border:     '1px solid var(--border)',
                  minWidth:   260,
                  maxHeight:  220,
                  overflowY:  'auto',
                }}
              >
                {suggestions.map((s, i) => (
                  <div
                    key={s.symbol}
                    onMouseDown={() => pickSuggestion(s.symbol)}
                    style={{
                      padding:    '4px 10px',
                      cursor:     'pointer',
                      background: i === suggestCursor ? 'var(--bg-panel-header)' : 'transparent',
                      borderBottom: '1px solid var(--border)',
                      display:    'flex',
                      gap:        12,
                      alignItems: 'baseline',
                    }}
                  >
                    <span style={{ color: 'var(--color-accent)', fontWeight: 600, minWidth: 90, fontSize: 'var(--fs-xs)', fontFamily: 'var(--font-mono)' }}>
                      {s.symbol}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {s.name}
                    </span>
                    {s.inDb === false && (
                      <span
                        title="not ingested yet - backtest will fail until data is loaded"
                        style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', fontFamily: 'var(--font-mono)' }}
                      >
                        no data
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
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
          {symbol && (
            <a
              href={`/symbol/${encodeURIComponent(symbol)}`}
              title="full decision dossier: bull/bear case, edge history, fundamentals, news"
              style={{
                color: 'var(--color-accent)',
                fontSize: 'var(--fs-xs)',
                textDecoration: 'none',
                border: '1px solid var(--border)',
                padding: '3px 10px',
                whiteSpace: 'nowrap',
              }}
            >
              DOSSIER
            </a>
          )}
          {/* Timeframe toggle */}
          <div className="flex items-center gap-1 shrink-0">
            {(['1d', '1w'] as const).map((tf) => (
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

          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', flexShrink: 0 }}>{status}</span>
        </form>

        <DublinClock />
      </div>

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
            strategyNames={Object.fromEntries(strategies.map((s) => [s.id, s.name]))}
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
