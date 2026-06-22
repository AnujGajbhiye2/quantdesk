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

const th: React.CSSProperties = {
  color:         'var(--text-muted)',
  fontSize:      'var(--fs-xs)',
  fontWeight:    400,
  letterSpacing: '0.08em',
  textAlign:     'left',
  padding:       '3px 8px',
  whiteSpace:    'nowrap',
};
const thR: React.CSSProperties = { ...th, textAlign: 'right' };
const td: React.CSSProperties  = {
  fontSize:          'var(--fs-xs)',
  padding:           '4px 8px',
  borderTop:         '1px solid var(--border)',
  whiteSpace:        'nowrap',
  color:             'var(--text-primary)',
  fontVariantNumeric: 'tabular-nums',
};
const tdR: React.CSSProperties = { ...td, textAlign: 'right' };

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
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={th}>SYMBOL</th>
                        <th style={th}>ERROR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latestIngest.errors.map((e) => (
                        <tr key={e.symbol}>
                          <td style={{ ...td, color: 'var(--color-accent)', fontWeight: 600, width: 100 }}>{e.symbol}</td>
                          <td style={{ ...td, color: 'var(--color-down)' }}>{e.error}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Run history (last 10) */}
              {recentIngests.length > 1 && (
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', letterSpacing: '0.08em', marginBottom: 4 }}>
                    RECENT RUNS (LAST 10)
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th style={th}>DATE</th>
                        <th style={th}>TRIGGER</th>
                        <th style={thR}>SYMBOLS</th>
                        <th style={thR}>NEW BARS</th>
                        <th style={thR}>ERRORS</th>
                        <th style={thR}>DURATION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentIngests.map((r) => (
                        <tr key={r.id}>
                          <td style={td}>{fmtDate(r.finishedAt)}</td>
                          <td style={{ ...td, color: 'var(--text-muted)' }}>{r.trigger}</td>
                          <td style={tdR}>{r.totalSymbols}</td>
                          <td style={{ ...tdR, color: r.totalBars > 0 ? 'var(--color-up)' : 'var(--text-muted)' }}>{r.totalBars}</td>
                          <td style={{ ...tdR, color: r.errorCount > 0 ? 'var(--color-down)' : 'var(--color-up)' }}>{r.errorCount}</td>
                          <td style={{ ...tdR, color: 'var(--text-muted)' }}>{r.durationMs}ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>SYMBOL</th>
                    {liveStrategies.map((s) => (
                      <th key={s.id} style={th} colSpan={2}>{s.name.toUpperCase()}</th>
                    ))}
                  </tr>
                  <tr>
                    <th style={{ ...th, borderBottom: '1px solid var(--border)' }}></th>
                    {liveStrategies.flatMap((s) => [
                      <th key={`${s.id}-action`} style={{ ...th, borderBottom: '1px solid var(--border)' }}>DECISION</th>,
                      <th key={`${s.id}-reason`} style={{ ...th, borderBottom: '1px solid var(--border)', minWidth: 240 }}>REASON</th>,
                    ])}
                  </tr>
                </thead>
                <tbody>
                  {decSymbols.map((symbol) => {
                    const stratMap = decisionsBySymbol.get(symbol)!;
                    return (
                      <tr key={symbol}>
                        <td style={{ ...td, color: 'var(--color-accent)', fontWeight: 600 }}>{symbol}</td>
                        {liveStrategies.flatMap((s) => {
                          const d = stratMap.get(s.id);
                          if (!d) {
                            return [
                              <td key={`${s.id}-action`} style={{ ...td, color: 'var(--text-muted)' }}>-</td>,
                              <td key={`${s.id}-reason`} style={{ ...td, color: 'var(--text-muted)' }}>not evaluated</td>,
                            ];
                          }
                          const actionColor = d.fired
                            ? 'var(--color-up)'
                            : d.action === 'hold'
                              ? 'var(--text-muted)'
                              : 'var(--text-primary)';
                          const actionLabel = d.fired
                            ? d.action.replace('_', ' ').toUpperCase()
                            : 'HOLD';
                          return [
                            <td key={`${s.id}-action`} style={{ ...td, color: actionColor, fontWeight: d.fired ? 700 : 400 }}>
                              {actionLabel}
                            </td>,
                            <td key={`${s.id}-reason`} style={{ ...td, color: d.fired ? 'var(--text-primary)' : 'var(--text-muted)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}
                                title={d.reason ?? ''}>
                              {d.reason ?? '--'}
                            </td>,
                          ];
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>SYMBOL</th>
                      <th style={th}>STRATEGY</th>
                      <th style={th}>SIDE</th>
                      <th style={thR}>ENTRY DATE</th>
                      <th style={thR}>ENTRY</th>
                      <th style={thR}>CURRENT</th>
                      <th style={thR}>UNREAL %</th>
                      <th style={thR}>DAYS</th>
                      <th style={thR}>STOP</th>
                      <th style={thR}>TARGET</th>
                      <th style={thR}>TO STOP</th>
                      <th style={thR}>TO TARGET</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openTrades.map((t) => {
                      const mark       = markMap.get(t.id);
                      const current    = mark?.markPrice ?? t.entryPrice;
                      const unrealPct  = mark?.unrealizedPnlPct ?? 0;
                      const days       = daysHeld(t.entryTime);
                      const toStop     = t.stopPrice != null && current > 0
                        ? ((t.stopPrice - current) / current) * 100 : null;
                      const toTarget   = t.targetPrice != null && current > 0
                        ? ((t.targetPrice - current) / current) * 100 : null;
                      return (
                        <tr key={t.id}>
                          <td style={{ ...td, color: 'var(--color-accent)', fontWeight: 600 }}>{t.symbol}</td>
                          <td style={{ ...td, color: 'var(--text-muted)' }}>{stratNameMap.get(t.strategyId) ?? t.strategyId}</td>
                          <td style={{ ...td, color: t.side === 'long' ? 'var(--color-up)' : 'var(--color-down)', fontWeight: 700 }}>
                            {t.side.toUpperCase()}
                          </td>
                          <td style={tdR}>{fmtDate(t.entryTime)}</td>
                          <td style={tdR}>{fmtNum(t.entryPrice)}</td>
                          <td style={tdR}>{fmtNum(current)}</td>
                          <td style={{ ...tdR, color: pnlColor(unrealPct) }}>{pct(unrealPct)}</td>
                          <td style={tdR}>{days}d</td>
                          <td style={{ ...tdR, color: 'var(--color-down)' }}>{t.stopPrice != null ? fmtNum(t.stopPrice) : '--'}</td>
                          <td style={{ ...tdR, color: 'var(--color-up)' }}>{t.targetPrice != null ? fmtNum(t.targetPrice) : '--'}</td>
                          <td style={{ ...tdR, color: toStop != null ? (toStop < -3 ? 'var(--color-down)' : 'var(--color-accent)') : 'var(--text-muted)' }}>
                            {toStop != null ? pct(toStop) : '--'}
                          </td>
                          <td style={{ ...tdR, color: toTarget != null ? 'var(--color-up)' : 'var(--text-muted)' }}>
                            {toTarget != null ? pct(toTarget) : '--'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={th}>SYMBOL</th>
                      <th style={th}>STRATEGY</th>
                      <th style={th}>SIDE</th>
                      <th style={thR}>ENTRY</th>
                      <th style={thR}>EXIT</th>
                      <th style={thR}>P&L %</th>
                      <th style={thR}>DAYS</th>
                      <th style={thR}>EXIT REASON</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentClosed.map((t) => {
                      const days = daysHeld(t.entryTime, t.exitTime);
                      return (
                        <tr key={t.id}>
                          <td style={{ ...td, color: 'var(--color-accent)', fontWeight: 600 }}>{t.symbol}</td>
                          <td style={{ ...td, color: 'var(--text-muted)' }}>{stratNameMap.get(t.strategyId) ?? t.strategyId}</td>
                          <td style={{ ...td, color: t.side === 'long' ? 'var(--color-up)' : 'var(--color-down)', fontWeight: 700 }}>
                            {t.side.toUpperCase()}
                          </td>
                          <td style={tdR}>{fmtDate(t.entryTime)}</td>
                          <td style={tdR}>{fmtDate(t.exitTime)}</td>
                          <td style={{ ...tdR, color: pnlColor(t.pnlPct ?? null) }}>
                            {t.pnlPct != null ? pct(t.pnlPct) : '--'}
                          </td>
                          <td style={tdR}>{days}d</td>
                          <td style={{ ...tdR, color: exitReasonColor(exitReasons.get(t.id)) }}>
                            {exitReasonLabel(exitReasons.get(t.id))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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
