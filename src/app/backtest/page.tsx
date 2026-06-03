'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import DublinClock from '@/components/DublinClock';
import MetricsPanel from '@/components/MetricsPanel';
import type { BacktestResult } from '@/core/backtest/engine';
import type { Bar, Timeframe } from '@/core/types';
import { toWeekly } from '@/core/data/resample';

// Chart must be client-side only (no SSR)
const PriceChart = dynamic(() => import('@/components/PriceChart'), { ssr: false });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Strategy { id: string; name: string; description: string }

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
  const [result,      setResult]     = useState<BacktestResult | null>(null);
  const [bars,        setBars]       = useState<Bar[]>([]);
  const [status,      setStatus]     = useState('');
  const [busy,        setBusy]       = useState(false);
  const [chartTf,     setChartTf]    = useState<'1d' | '1w'>('1d');
  const [rawBars,     setRawBars]    = useState<Bar[]>([]);
  const symbolInput = useRef<HTMLInputElement>(null);

  // Load strategy list on mount
  useEffect(() => {
    fetch('/api/strategies')
      .then((r) => r.json())
      .then((d: { strategies: Strategy[] }) => {
        setStrategies(d.strategies);
        if (d.strategies.length > 0 && !strategyId) {
          setStrategyId(d.strategies[0].id);
        }
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
      const data = await res.json() as BacktestResult & { error?: string };
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
            <a href="/paper" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>PAPER</a>
          </nav>
        </div>

        {/* Controls */}
        <form
          onSubmit={(e) => { e.preventDefault(); void runBacktest(); }}
          className="flex items-center gap-3 flex-1"
          style={{ minWidth: 0 }}
        >
          <input
            ref={symbolInput}
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="SYMBOL"
            style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--fs-xs)',
              padding: '3px 8px',
              width: 100,
            }}
          />
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

      {/* Body */}
      <div
        className="flex-1 grid overflow-hidden"
        style={{
          gridTemplateColumns: result ? '1fr 220px' : '1fr',
          gap: '1px',
          background: 'var(--border)',
          minHeight: 0,
        }}
      >
        {/* Chart */}
        <div style={{ background: 'var(--bg-panel)', overflow: 'hidden', position: 'relative' }}>
          {result ? (
            <PriceChart
              bars={bars}
              trades={result.trades}
              equityCurve={result.equityCurve}
            />
          ) : (
            <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>
              {busy ? 'Loading...' : 'Enter a symbol and select a strategy, then click RUN.'}
            </div>
          )}
        </div>

        {/* Metrics */}
        {result && (
          <div style={{ background: 'var(--bg-panel)', overflow: 'auto' }}>
            <MetricsPanel metrics={result.metrics} numTrades={result.trades.length} />
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
