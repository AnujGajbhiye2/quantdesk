'use client';

import { use } from 'react';
import useSWR from 'swr';
import DublinClock from '@/components/primitives/DublinClock';
import InfoTip from '@/components/primitives/InfoTip';
import { fmtMoney } from '@/core/format/currency';
import type { DossierResponse } from '@/app/api/dossier/route';
import type { CaseFactor } from '@/core/dossier/case';
import { DataTable } from '@/components/table/DataTable';
import type { ColumnDef } from '@tanstack/react-table';
import type { EdgeStats } from '@/core/edge/types';
import AppNav from '@/components/primitives/AppNav';

/**
 * Decision dossier: the four "analyst desks" (technical, edge and history,
 * fundamentals, news) plus the deterministic bull/bear case, on one page.
 * Mechanical checklist - not advice; every factor shows its numbers.
 */

function SectionTitle({ label, hint }: { label: string; hint: string }) {
  return (
    <div
      style={{
        color: 'var(--text-muted)',
        fontSize: 'var(--fs-xs)',
        letterSpacing: '0.08em',
        padding: '4px 10px',
        background: 'var(--bg-panel-header)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      [ {label} ]
      <InfoTip term={label} text={hint} />
    </div>
  );
}

function FactorList({ factors, color }: { factors: CaseFactor[]; color: string }) {
  if (factors.length === 0) {
    return <div style={{ padding: '6px 10px', color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>- none -</div>;
  }
  return (
    <div style={{ padding: '4px 0' }}>
      {factors.map((f) => (
        <div key={f.label} style={{ padding: '3px 10px', fontSize: 'var(--fs-xs)' }}>
          <span style={{ color, fontWeight: 700 }}>{f.label}</span>
          <div style={{ color: 'var(--text-muted)', marginTop: 1 }}>{f.detail}</div>
        </div>
      ))}
    </div>
  );
}

function kv(label: string, value: string, color?: string) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 10px', fontSize: 'var(--fs-xs)' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ color: color ?? 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

const fmtPct = (v: number | null, digits = 1) =>
  v == null ? '--' : `${(v * 100).toFixed(digits)}%`;
const fmtNum = (v: number | null, digits = 2) =>
  v == null ? '--' : v.toFixed(digits);

const EDGE_COLS: ColumnDef<EdgeStats, unknown>[] = [
  { accessorKey: 'strategyId', header: 'STRATEGY', meta: { accent: true } },
  {
    accessorKey: 'winRate',
    header: 'WIN%',
    cell: ({ getValue }) => fmtPct(getValue() as number, 0),
    meta: { numeric: true },
  },
  {
    accessorKey: 'profitFactor',
    header: 'P-FACTOR',
    cell: ({ getValue }) => {
      const v = getValue() as number;
      return v >= 9999 ? 'inf' : v.toFixed(2);
    },
    meta: { numeric: true },
  },
  {
    accessorKey: 'numTrades',
    header: 'TRADES',
    cell: ({ getValue }) => <span style={{ color: 'var(--text-muted)' }}>{getValue() as number}</span>,
    meta: { numeric: true },
  },
];
const fmtBig = (v: number | null) => {
  if (v == null) return '--';
  if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9)  return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6)  return `${(v / 1e6).toFixed(1)}M`;
  return v.toFixed(0);
};

export default function SymbolDossierPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol: rawSymbol } = use(params);
  const symbol = decodeURIComponent(rawSymbol).toUpperCase();

  const { data: dossier, error: swrError, isLoading } = useSWR<DossierResponse>(
    `/api/dossier?symbol=${encodeURIComponent(symbol)}`,
  );
  const error = swrError
    ? ((swrError as { message?: string }).message ?? String(swrError))
    : '';

  const panelStyle: React.CSSProperties = {
    background: 'var(--bg-panel)',
    border: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'auto',
  };

  return (
    <div className="flex flex-col h-full" style={{ minHeight: '100vh', fontFamily: 'var(--font-mono)' }}>
      {/* Status bar */}
      <div
        className="flex items-center justify-between px-4 py-2 shrink-0 gap-4"
        style={{ background: 'var(--bg-panel-header)', borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-4 shrink-0">
          <span style={{ color: 'var(--color-accent)', fontWeight: 700, letterSpacing: '0.1em', fontSize: 'var(--fs-sm)' }}>
            QUANTDESK
          </span>
          <AppNav />
          <span style={{ color: 'var(--color-accent)', fontWeight: 700, fontSize: 'var(--fs-sm)' }}>
            {symbol}
          </span>
          {dossier && (
            <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>{dossier.name}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <a href={`/backtest?symbol=${symbol}`} style={{ color: 'var(--color-accent)', fontSize: 'var(--fs-xs)', textDecoration: 'none', border: '1px solid var(--border)', padding: '1px 8px' }}>
            BACKTEST
          </a>
          <a href={`/compare?symbol=${symbol}`} style={{ color: 'var(--color-accent)', fontSize: 'var(--fs-xs)', textDecoration: 'none', border: '1px solid var(--border)', padding: '1px 8px' }}>
            COMPARE
          </a>
          <DublinClock />
        </div>
      </div>

      {error && (
        <div style={{ padding: 24, color: 'var(--color-down)', fontSize: 'var(--fs-sm)' }}>{error}</div>
      )}
      {!error && isLoading && (
        <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>building dossier...</div>
      )}

      {dossier && (
        <div className="flex-1 overflow-auto" style={{ background: 'var(--bg-base)' }}>
          {/* Verdict bar */}
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginBottom: 4 }}>
              <span style={{ color: 'var(--color-up)', fontWeight: 700 }}>
                BULL {dossier.case.bullScore}% ({dossier.case.bull.length} factors)
              </span>
              <span>
                mechanical checklist - factors below ARE the reasoning
                <InfoTip
                  term="Bull/bear score"
                  text="Share of evaluable checks that landed bullish: trend, momentum regime, strategy consensus, backtested edge on this symbol, realized signal track record, 52-week position, earnings and valuation. Mechanical and explainable - read the factors, not just the score. Not advice."
                />
              </span>
              <span style={{ color: 'var(--color-down)', fontWeight: 700 }}>
                ({dossier.case.bear.length} factors) BEAR {100 - dossier.case.bullScore}%
              </span>
            </div>
            <div style={{ display: 'flex', height: 10, background: 'var(--bg-panel-header)' }}>
              <div style={{ background: 'var(--color-up)', width: `${dossier.case.bullScore}%` }} />
              <div style={{ background: 'var(--color-down)', width: `${100 - dossier.case.bullScore}%` }} />
            </div>
            {dossier.case.unavailable.length > 0 && (
              <div style={{ marginTop: 4, color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
                not evaluable: {dossier.case.unavailable.join(' · ')}
              </div>
            )}
          </div>

          {/* Bull/bear factors */}
          <div className="grid grid-cols-2 gap-px" style={{ background: 'var(--border)' }}>
            <div style={panelStyle}>
              <SectionTitle label="BULL CASE" hint="Every bullish check that passed, with the numbers behind it." />
              <FactorList factors={dossier.case.bull} color="var(--color-up)" />
            </div>
            <div style={panelStyle}>
              <SectionTitle label="BEAR CASE" hint="Every bearish check that fired, with the numbers behind it. Read this list twice before any trade." />
              <FactorList factors={dossier.case.bear} color="var(--color-down)" />
            </div>
          </div>

          {/* Analyst desks */}
          <div className="grid grid-cols-2 gap-px" style={{ background: 'var(--border)', borderTop: '1px solid var(--border)' }}>
            {/* TECHNICAL */}
            <div style={panelStyle}>
              <SectionTitle label="TECHNICAL" hint="Latest closed-bar state. The chart and full backtests live on the BACKTEST page." />
              {kv('last close', dossier.technical.lastClose != null ? fmtMoney(dossier.technical.lastClose, dossier.currency) : '--')}
              {kv('as of', dossier.technical.lastBarTime?.slice(0, 10) ?? '--')}
              {kv('RSI(14)', fmtNum(dossier.technical.rsi14, 1),
                dossier.technical.rsi14 != null && dossier.technical.rsi14 >= 70 ? 'var(--color-down)'
                : dossier.technical.rsi14 != null && dossier.technical.rsi14 <= 30 ? 'var(--color-up)' : undefined)}
              {kv('SMA50', dossier.technical.sma50 != null ? fmtMoney(dossier.technical.sma50, dossier.currency) : '--')}
              {kv('SMA200', dossier.technical.sma200 != null ? fmtMoney(dossier.technical.sma200, dossier.currency) : '--')}
              {kv('below 52w high', dossier.technical.pctBelow52wHigh != null ? `${dossier.technical.pctBelow52wHigh.toFixed(1)}%` : '--')}
              {kv('signals now', dossier.signals.length > 0
                ? dossier.signals.map((s) => `${s.strategyId}:${s.side.toUpperCase()}${s.conviction ? ` (${s.conviction.score})` : ''}`).join(' ')
                : 'none fresh')}
              {dossier.signals.length > 0 && dossier.signals.map(s => s.conviction && (
                <div key={`${s.strategyId}-conv`} style={{ padding: '2px 10px', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                  <span style={{
                    color: s.conviction.band === 'STRONG' ? 'var(--color-up)'
                         : s.conviction.band === 'WEAK' ? 'var(--color-down)' : 'var(--color-accent)',
                    fontWeight: 700
                  }}>
                    {s.strategyId} conviction: {s.conviction.score} {s.conviction.band}
                  </span>
                  <div style={{ marginTop: 2 }}>{s.reason}</div>
                </div>
              ))}
              {kv('consensus', `${dossier.consensus.long} long / ${dossier.consensus.short} short of ${dossier.consensus.totalStrategies}`)}
            </div>

            {/* EDGE & HISTORY */}
            <div style={panelStyle}>
              <SectionTitle label="EDGE & HISTORY" hint="Backtested edge of each strategy ON THIS SYMBOL (hold cap applied), and whether past stored signals actually worked." />
              {dossier.edges.length === 0 ? (
                <div style={{ padding: '6px 10px', color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
                  no edge stats yet - they compute on the nightly refresh
                </div>
              ) : (
                <DataTable
                  columns={EDGE_COLS}
                  data={[...dossier.edges].sort((a, b) => b.profitFactor - a.profitFactor).slice(0, 8)}
                  dense
                  rowStyle={(row) => ({ opacity: row.numTrades < 15 ? 0.45 : 1 })}
                />
              )}
              <div style={{ borderTop: '1px solid var(--border)', marginTop: 4 }}>
                {kv('past long signals', String(dossier.history.longSignals))}
                {kv('worked within 5 bars', fmtPct(dossier.history.longHitRate, 0),
                  dossier.history.longHitRate != null
                    ? dossier.history.longHitRate >= 0.5 ? 'var(--color-up)' : 'var(--color-down)'
                    : undefined)}
              </div>
            </div>

            {/* FUNDAMENTALS */}
            <div style={panelStyle}>
              <SectionTitle label="FUNDAMENTALS" hint="Yahoo-sourced, refreshed daily, may be delayed. Missing for indices/crypto/forex - that is normal. Swing trades live and die on technicals; this desk exists to catch obvious red flags." />
              {dossier.fundamentals ? (
                <>
                  {kv('market cap', fmtBig(dossier.fundamentals.marketCap))}
                  {kv('trailing P/E', fmtNum(dossier.fundamentals.trailingPE, 1))}
                  {kv('forward P/E', fmtNum(dossier.fundamentals.forwardPE, 1))}
                  {kv('EPS growth (q/q yr)', fmtPct(dossier.fundamentals.epsGrowth, 0),
                    dossier.fundamentals.epsGrowth != null
                      ? dossier.fundamentals.epsGrowth > 0 ? 'var(--color-up)' : 'var(--color-down)'
                      : undefined)}
                  {kv('revenue growth', fmtPct(dossier.fundamentals.revenueGrowth, 0))}
                  {kv('profit margin', fmtPct(dossier.fundamentals.profitMargin, 0))}
                  {kv('analyst consensus', dossier.fundamentals.recommendation ?? '--')}
                  {kv('analyst target', dossier.fundamentals.targetMeanPrice != null
                    ? fmtMoney(dossier.fundamentals.targetMeanPrice, dossier.currency) : '--')}
                </>
              ) : (
                <div style={{ padding: '6px 10px', color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
                  no fundamentals available for this symbol
                </div>
              )}
            </div>

            {/* NEWS */}
            <div style={panelStyle}>
              <SectionTitle label="NEWS" hint="Recent headlines from the provider, refreshed every 6 hours. Headlines are context, not signals - check whether something structural changed before trusting any setup." />
              {dossier.news.length === 0 ? (
                <div style={{ padding: '6px 10px', color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
                  no recent headlines
                </div>
              ) : (
                dossier.news.map((n, i) => (
                  <a
                    key={`${n.link}-${i}`}
                    href={n.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'block',
                      padding: '4px 10px',
                      fontSize: 'var(--fs-xs)',
                      color: 'var(--text-primary)',
                      textDecoration: 'none',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    {n.title}
                    <div style={{ color: 'var(--text-muted)', marginTop: 1 }}>
                      {n.publisher} · {n.publishedAt.slice(0, 10)}
                    </div>
                  </a>
                ))
              )}
            </div>
          </div>
        </div>
      )}

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
        Research tool. Not financial advice. Results hypothetical. Fundamentals and news are third-party and may be delayed.
      </div>
    </div>
  );
}
