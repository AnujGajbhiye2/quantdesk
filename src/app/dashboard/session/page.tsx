import { getDb } from '@/core/db/client';
import { getLatestRun, getDecisionsForRun } from '@/core/db/runs';
import { getLatestIngestRun, getRecentIngestRuns } from '@/core/db/ingest-log';
import { getPaperTrades } from '@/core/db/paper';
import { getExitReasons } from '@/core/db/journal';
import { markOpenTrades } from '@/core/paper/broker';
import { buildPerformanceMetrics } from '@/core/paper/perf';
import { isTradingHalted } from '@/core/paper/halt';
import { listLive as listLiveStrategies } from '@/core/strategy/registry';
import Panel from '@/components/primitives/Panel';
import EmptyState from '@/components/primitives/EmptyState';
import { HaltBanner, KillSwitch } from './KillSwitch';
import { DecisionLogTable } from '@/components/dashboard/DecisionLogTable';
import {
  IngestErrorsTable,
  IngestRunsTable,
  OpenPositionsTable,
  ClosedTradesTable,
} from '@/components/dashboard/SessionTables';
import type { IngestErrorRow, IngestRunRow, OpenPositionRow, ClosedTradeRow } from '@/components/dashboard/SessionTables';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initDb() {
  try { getDb(); } catch (e) { console.error('[quantdesk] DB init failed:', e); }
}

function pct(v: number, sign = true) {
  const s = sign && v >= 0 ? '+' : '';
  return `${s}${v.toFixed(2)}%`;
}

function pnlColor(v: number | null | undefined): string {
  if (v == null) return 'var(--text-muted)';
  return v >= 0 ? 'var(--color-up)' : 'var(--color-down)';
}

function fmtDate(s: string | undefined | null) {
  return s ? s.slice(0, 10) : '--';
}

function fmtNum(n: number | undefined | null, dec = 2) {
  if (n == null || !isFinite(n)) return '--';
  return n.toFixed(dec);
}

function daysHeld(entryTime: string, exitTime?: string | null): number {
  const end = exitTime ? new Date(exitTime) : new Date();
  return Math.round((end.getTime() - new Date(entryTime).getTime()) / 86_400_000);
}

function exitReasonColor(reason: string | undefined | null): string {
  if (!reason) return 'var(--text-muted)';
  if (reason === 'stop')   return 'var(--color-down)';
  if (reason === 'target') return 'var(--color-up)';
  return 'var(--text-muted)';
}

function exitReasonLabel(reason: string | undefined | null): string {
  const map: Record<string, string> = {
    stop:   'STOP HIT',
    target: 'TARGET HIT',
    time:   'TIME EXIT',
    manual: 'MANUAL',
    signal: 'SIGNAL',
  };
  return reason ? (map[reason] ?? reason.toUpperCase()) : '--';
}

// ---------------------------------------------------------------------------
// Stat grid cell
// ---------------------------------------------------------------------------

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div
      style={{
        padding:     '6px 12px',
        borderRight: '1px solid var(--border)',
      }}
    >
      <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', letterSpacing: '0.08em' }}>
        {label}
      </div>
      <div
        style={{
          color:             color ?? 'var(--text-primary)',
          fontSize:          'var(--fs-sm)',
          fontWeight:        600,
          fontVariantNumeric: 'tabular-nums',
          marginTop:         2,
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SessionPage() {
  initDb();

  // --- Data loading ---
  const latestIngest  = getLatestIngestRun();
  const recentIngests = getRecentIngestRuns(10);
  const latestRun     = getLatestRun();
  const decisionRows  = latestRun ? getDecisionsForRun(latestRun.id) : [];
  const openTrades    = getPaperTrades({ status: 'open' });
  const closedAll     = getPaperTrades({ status: 'closed' });
  const recentClosed  = [...closedAll]
    .sort((a, b) => (b.exitTime ?? '').localeCompare(a.exitTime ?? ''))
    .slice(0, 20);
  const marks         = markOpenTrades('1d');
  const markMap       = new Map(marks.map((m) => [m.trade.id, m]));
  const exitReasons   = getExitReasons(recentClosed.map((t) => t.id));
  const perf          = buildPerformanceMetrics();
  const haltState     = isTradingHalted();
  const liveStrategies = listLiveStrategies();
  const stratNameMap  = new Map(liveStrategies.map((s) => [s.id, s.name]));

  // Staleness check: warn if last run > 26h ago
  const isStale = latestRun
    ? (Date.now() - new Date(latestRun.finishedAt).getTime()) > 26 * 3600 * 1000
    : true;

  // Group decisions by symbol
  type DecBySymbol = Map<string, Map<string, { action: string; fired: boolean; reason: string | null }>>;
  const decisionsBySymbol: DecBySymbol = new Map();
  for (const r of decisionRows) {
    if (!decisionsBySymbol.has(r.symbol)) decisionsBySymbol.set(r.symbol, new Map());
    decisionsBySymbol.get(r.symbol)!.set(r.strategyId, {
      action: r.action,
      fired:  r.fired === 1,
      reason: r.reason,
    });
  }
  const decSymbols = Array.from(decisionsBySymbol.keys()).sort();

  // Serialize nested Maps to plain objects for the client component
  const decisionsPlain: Record<string, Record<string, { action: string; fired: boolean; reason: string | null }>> = {};
  for (const [sym, stratMap] of decisionsBySymbol) {
    decisionsPlain[sym] = Object.fromEntries(stratMap);
  }

  // Serialize open positions with computed values for SessionTables client components
  const openRows: OpenPositionRow[] = openTrades.map((t) => {
    const mark      = markMap.get(t.id);
    const current   = mark?.markPrice ?? t.entryPrice;
    const unrealPct = mark?.unrealizedPnlPct ?? 0;
    const days      = Math.round((Date.now() - new Date(t.entryTime).getTime()) / 86_400_000);
    const toStop    = t.stopPrice != null && current > 0
      ? ((t.stopPrice - current) / current) * 100 : null;
    const toTarget  = t.targetPrice != null && current > 0
      ? ((t.targetPrice - current) / current) * 100 : null;
    return {
      id:         t.id,
      symbol:     t.symbol,
      strategy:   stratNameMap.get(t.strategyId) ?? t.strategyId,
      side:       t.side,
      entryDate:  t.entryTime,
      entryPrice: t.entryPrice,
      current,
      unrealPct,
      days,
      stop:       t.stopPrice ?? null,
      target:     t.targetPrice ?? null,
      toStop,
      toTarget,
    };
  });

  const REASON_COLOR: Record<string, string> = {
    stop:   'var(--color-down)',
    target: 'var(--color-up)',
  };
  const closedRows: ClosedTradeRow[] = recentClosed.map((t) => {
    const days       = Math.round((new Date(t.exitTime ?? Date.now()).getTime() - new Date(t.entryTime).getTime()) / 86_400_000);
    const rawReason  = exitReasons.get(t.id);
    const exitLabel  = rawReason === 'stop' ? 'STOP HIT' : rawReason === 'target' ? 'TARGET HIT' : rawReason === 'time' ? 'TIME EXIT' : rawReason === 'manual' ? 'MANUAL' : rawReason ?? '--';
    return {
      id:         t.id,
      symbol:     t.symbol,
      strategy:   stratNameMap.get(t.strategyId) ?? t.strategyId,
      side:       t.side,
      entryDate:  t.entryTime,
      exitDate:   t.exitTime ?? '',
      pnlPct:     t.pnlPct ?? null,
      days,
      exitReason: exitLabel,
      exitColor:  REASON_COLOR[rawReason ?? ''] ?? 'var(--text-muted)',
    };
  });

  // Serialize ingest run data for IngestRunsTable
  const ingestRunRows: IngestRunRow[] = recentIngests.map((r) => ({
    id:           r.id,
    finishedAt:   r.finishedAt,
    trigger:      r.trigger,
    totalSymbols: r.totalSymbols,
    totalBars:    r.totalBars,
    errorCount:   r.errorCount,
    durationMs:   r.durationMs,
  }));

  const ingestErrorRows: IngestErrorRow[] = (latestIngest?.errors ?? []).map((e) => ({
    symbol: e.symbol,
    error:  e.error,
  }));

  return (
    <div className="flex flex-col" style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      {/* Halt banner - spans full width when active */}
      <HaltBanner halted={haltState.halted} />

      {/* Nav bar */}
      <div
        className="flex items-center justify-between px-4 py-2 shrink-0"
        style={{ background: 'var(--bg-panel-header)', borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-4">
          <span style={{ color: 'var(--color-accent)', fontWeight: 700, letterSpacing: '0.1em', fontSize: 'var(--fs-sm)' }}>
            QUANTDESK
          </span>
          <nav className="flex gap-3" style={{ fontSize: 'var(--fs-xs)' }}>
            <a href="/"                   style={{ color: 'var(--text-muted)',  textDecoration: 'none' }}>DASH</a>
            <a href="/backtest"           style={{ color: 'var(--text-muted)',  textDecoration: 'none' }}>BACKTEST</a>
            <a href="/compare"            style={{ color: 'var(--text-muted)',  textDecoration: 'none' }}>COMPARE</a>
            <a href="/paper"              style={{ color: 'var(--text-muted)',  textDecoration: 'none' }}>PAPER</a>
            <a href="/journal"            style={{ color: 'var(--text-muted)',  textDecoration: 'none' }}>JOURNAL</a>
            <a href="/dashboard/session"  style={{ color: 'var(--color-accent)', textDecoration: 'none' }}>SESSION</a>
            <a href="/settings"           style={{ color: 'var(--text-muted)',  textDecoration: 'none' }}>SETTINGS</a>
          </nav>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-3 p-3" style={{ flex: 1 }}>

        {/* ----------------------------------------------------------------- */}
        {/* SECTION 1 - LAST RUN SUMMARY                                       */}
        {/* ----------------------------------------------------------------- */}
        <Panel
          title="LAST EOD RUN"
          info="Metadata from the most recent completed EOD refresh. Symbol count, strategy evaluations, and signal/trade results."
        >
          {isStale && (
            <div
              style={{
                background:    'rgba(230,168,23,0.12)',
                border:        '1px solid var(--color-accent)',
                color:         'var(--color-accent)',
                fontSize:      'var(--fs-xs)',
                padding:       '6px 10px',
                marginBottom:  8,
                letterSpacing: '0.06em',
              }}
            >
              {latestRun
                ? `WARNING - last run was ${fmtDate(latestRun.finishedAt)}, more than 26 hours ago. System may not be running.`
                : 'WARNING - no EOD run recorded yet. System may not have run or is newly deployed.'}
            </div>
          )}
          {latestRun ? (
            <div
              style={{
                display:   'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                borderLeft: '1px solid var(--border)',
                borderTop:  '1px solid var(--border)',
              }}
            >
              <Stat label="LAST RUN"          value={fmtDate(latestRun.finishedAt)} />
              <Stat label="TRIGGER"           value={latestRun.trigger.toUpperCase()} />
              <Stat label="SYMBOLS SCANNED"  value={latestRun.symbolsScanned.toString()} />
              <Stat label="EVALUATIONS"       value={latestRun.evaluations.toString()} />
              <Stat label="STRATEGIES"        value={latestRun.strategiesCount.toString()} />
              <Stat label="SIGNALS"           value={latestRun.signalsGenerated.toString()}
                    color={latestRun.signalsGenerated > 0 ? 'var(--color-accent)' : undefined} />
              <Stat label="TRADES OPENED"     value={latestRun.tradesOpened.toString()}
                    color={latestRun.tradesOpened > 0 ? 'var(--color-up)' : undefined} />
              <Stat label="TRADES CLOSED"     value={latestRun.tradesClosed.toString()}
                    color={latestRun.tradesClosed > 0 ? 'var(--text-primary)' : undefined} />
              <Stat label="DURATION"          value={`${latestRun.durationMs}ms`} />
            </div>
          ) : (
            <EmptyState message="No EOD run recorded yet - trigger a refresh first." />
          )}
        </Panel>

        {/* ----------------------------------------------------------------- */}
        {/* SECTION 1b - INGESTION LOG                                        */}
        {/* ----------------------------------------------------------------- */}
        <Panel
          title="INGESTION LOG"
          info="Results of the most recent data refresh (refreshUniverse). Shows bars added, symbol errors, and run history for the last 10 runs."
        >
          {latestIngest ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Latest run summary */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                  borderLeft: '1px solid var(--border)',
                  borderTop:  '1px solid var(--border)',
                }}
              >
                <Stat label="LAST INGEST"     value={fmtDate(latestIngest.finishedAt)} />
                <Stat label="TRIGGER"          value={latestIngest.trigger.toUpperCase()} />
                <Stat label="SYMBOLS"          value={latestIngest.totalSymbols.toString()} />
                <Stat label="NEW BARS"         value={latestIngest.totalBars.toString()}
                      color={latestIngest.totalBars > 0 ? 'var(--color-up)' : undefined} />
                <Stat label="ERRORS"           value={latestIngest.errorCount.toString()}
                      color={latestIngest.errorCount > 0 ? 'var(--color-down)' : 'var(--color-up)'} />
                <Stat label="DURATION"         value={`${latestIngest.durationMs}ms`} />
              </div>

              {/* Symbol errors (latest run) */}
              {latestIngest.errors.length > 0 && (
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', letterSpacing: '0.08em', marginBottom: 4 }}>
                    SYMBOL ERRORS (LATEST RUN)
                  </div>
                  <IngestErrorsTable errors={ingestErrorRows} />
                </div>
              )}

              {/* Run history (last 10) */}
              {recentIngests.length > 1 && (
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', letterSpacing: '0.08em', marginBottom: 4 }}>
                    RECENT RUNS (LAST 10)
                  </div>
                  <IngestRunsTable runs={ingestRunRows} />
                </div>
              )}
            </div>
          ) : (
            <EmptyState
              message="No ingestion run recorded yet."
              hint="Run npm run refresh or trigger via /api/ingest to populate."
            />
          )}
        </Panel>

        {/* ----------------------------------------------------------------- */}
        {/* SECTION 2 - SIGNAL DECISION LOG (most important, full width)      */}
        {/* ----------------------------------------------------------------- */}
        <Panel
          title="SIGNAL DECISION LOG"
          subtitle={latestRun
            ? `Last run: ${fmtDate(latestRun.finishedAt)} - ${decSymbols.length} symbols evaluated`
            : 'No run data - trigger an EOD refresh to populate'}
          info="Per-symbol, per-strategy decisions from the last EOD scan. Shows exactly why each strategy fired or did not fire for each symbol."
        >
          {decSymbols.length === 0 ? (
            <EmptyState
              message="No decision log yet."
              hint="Trigger an EOD refresh with logRun enabled (eod-cron or manual) to populate this table."
            />
          ) : (
            <DecisionLogTable
              symbols={decSymbols}
              decisions={decisionsPlain}
              strategies={liveStrategies.map((s) => ({ id: s.id, name: s.name }))}
            />
          )}
        </Panel>

        {/* ----------------------------------------------------------------- */}
        {/* SECTION 3 + 4 side by side                                        */}
        {/* ----------------------------------------------------------------- */}
        <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>

          {/* SECTION 3 - OPEN POSITIONS */}
          <Panel
            title="OPEN POSITIONS"
            info="Current open paper positions with unrealised P&L using the latest daily close. Current price = last stored bar close, not a live quote."
            className="flex-1 min-w-[540px]"
          >
            {openTrades.length === 0 ? (
              <EmptyState message="No open positions." />
            ) : (
              <OpenPositionsTable positions={openRows} />
            )}
          </Panel>

          {/* SECTION 4 - RECENT TRADE HISTORY */}
          <Panel
            title="RECENT TRADES (LAST 20)"
            info="Last 20 closed paper trades sorted by exit date. P&L is per-trade native currency percentage."
            className="flex-1 min-w-[480px]"
          >
            {recentClosed.length === 0 ? (
              <EmptyState message="No closed trades yet." />
            ) : (
              <ClosedTradesTable trades={closedRows} />
            )}
          </Panel>
        </div>

        {/* ----------------------------------------------------------------- */}
        {/* SECTION 5 + 6 side by side                                        */}
        {/* ----------------------------------------------------------------- */}
        <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>

          {/* SECTION 5 - PERFORMANCE METRICS */}
          <Panel
            title="PERFORMANCE METRICS"
            info="Since-inception paper trading stats from all closed trades. Sharpe shown only once >= 30 closed trades (insufficient sample below that)."
            className="flex-1 min-w-[480px]"
          >
            {perf.totalTrades === 0 ? (
              <EmptyState message="No closed trades yet - nothing to measure." />
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                  borderLeft: '1px solid var(--border)',
                  borderTop:  '1px solid var(--border)',
                }}
              >
                <Stat label="CLOSED TRADES"   value={perf.totalTrades.toString()} />
                <Stat label="WIN RATE"         value={pct(perf.winRate * 100, false)}
                      color={perf.winRate >= 0.5 ? 'var(--color-up)' : 'var(--color-down)'} />
                <Stat label="AVG WIN"          value={pct(perf.avgWinPct)}
                      color="var(--color-up)" />
                <Stat label="AVG LOSS"         value={pct(perf.avgLossPct)}
                      color="var(--color-down)" />
                <Stat label="PROFIT FACTOR"   value={isFinite(perf.profitFactor) ? fmtNum(perf.profitFactor) : '∞'}
                      color={perf.profitFactor >= 1 ? 'var(--color-up)' : 'var(--color-down)'} />
                <Stat label="TOTAL RETURN"    value={pct(perf.totalReturnPct)}
                      color={pnlColor(perf.totalReturnPct)} />
                <Stat label="MAX DRAWDOWN"    value={pct(perf.maxDrawdownPct, false)}
                      color="var(--color-down)" />
                <Stat label="CURR DRAWDOWN"   value={pct(perf.currentDrawdownPct, false)}
                      color={perf.currentDrawdownPct > 5 ? 'var(--color-down)' : 'var(--text-muted)'} />
                {perf.sharpe != null ? (
                  <Stat label="SHARPE (ANN)"  value={fmtNum(perf.sharpe)}
                        color={perf.sharpe >= 1 ? 'var(--color-up)' : perf.sharpe < 0 ? 'var(--color-down)' : undefined} />
                ) : (
                  <Stat label="SHARPE (ANN)"
                        value={`n/a (need >= 30, have ${perf.totalTrades})`}
                        color="var(--text-muted)" />
                )}
              </div>
            )}
          </Panel>

          {/* SECTION 6 - KILL SWITCH */}
          <Panel
            title="KILL SWITCH"
            info="Halt switch backed by SQLite (app_flags). When halted, the auto-trade loop and broker both block new entries. Open positions continue to be managed (stops, targets, time-stops). Requires two clicks to change state."
            className="flex-1 min-w-[320px]"
          >
            <KillSwitch initialState={haltState} />
          </Panel>
        </div>
      </div>

      {/* Disclaimer */}
      <div
        className="px-4 py-1 shrink-0 text-center"
        style={{
          background:    'var(--bg-base)',
          borderTop:     '1px solid var(--border)',
          color:         'var(--text-muted)',
          fontSize:      'var(--fs-xs)',
          letterSpacing: '0.04em',
        }}
      >
        Research tool. Not financial advice. Paper trading results are hypothetical and do not guarantee future performance.
      </div>
    </div>
  );
}
