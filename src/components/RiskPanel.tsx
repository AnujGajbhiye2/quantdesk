'use client';

import Panel from './Panel';
import type { RiskExposure } from '@/core/risk/exposure';
import type { AccountSummary } from '@/core/paper/account';

interface Props {
  exposure: RiskExposure | null;
  account:  AccountSummary | null;
}

function Gauge({ label, used, limit, unit, title }: {
  label: string;
  used:  number;
  limit: number;
  unit:  string;
  title: string;
}) {
  const frac  = limit > 0 ? Math.min(used / limit, 1) : 0;
  const color = frac >= 1 ? 'var(--color-down)' : frac >= 0.75 ? 'var(--color-accent)' : 'var(--color-up)';
  return (
    <div title={title} style={{ minWidth: 150, flex: 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
        <span>{label}</span>
        <span style={{ color, fontVariantNumeric: 'tabular-nums' }}>
          {used.toFixed(unit === '' ? 0 : 1)}{unit} / {limit.toFixed(unit === '' ? 0 : 1)}{unit}
        </span>
      </div>
      <div style={{ background: 'var(--bg-panel-header)', height: 6, marginTop: 2 }}>
        <div style={{ background: color, height: '100%', width: `${frac * 100}%` }} />
      </div>
    </div>
  );
}

/**
 * Live exposure vs the risk rules the broker enforces. When a gauge fills,
 * the next trade that would cross it is rejected with the same numbers.
 */
export default function RiskPanel({ exposure, account }: Props) {
  if (!exposure) {
    return (
      <Panel title="RISK" className="h-full" subtitle="exposure gauges load with the account">
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>- loading -</span>
      </Panel>
    );
  }

  const { limits } = exposure;
  const equity = account?.equity ?? 0;
  const hasAccount = account != null;

  const openRiskPct  = equity > 0 ? (exposure.openRiskUSD / equity) * 100 : 0;
  const largestPct   = equity > 0 && exposure.largestPosition
    ? (exposure.largestPosition.costUSD / equity) * 100
    : 0;
  const drawdownPct  = hasAccount && account.startingBalance > 0
    ? Math.max(0, ((account.startingBalance - account.equity) / account.startingBalance) * 100)
    : 0;

  return (
    <Panel
      title="RISK"
      className="h-full"
      subtitle="Exposure vs the rules the broker enforces - a full gauge means the next trade crossing it gets rejected."
      info={
        'Four rules keep the account alive:\n' +
        `1. No position over ${limits.maxPositionPct}% of equity - one bad trade cannot sink you.\n` +
        `2. Total stop-loss risk across open trades capped at ${limits.maxOpenRiskPct}% of equity - a bad week stays survivable. Trades without a stop are counted at FULL cost.\n` +
        `3. Max ${limits.maxOpenTrades} open trades - more is unmanageable and usually correlated.\n` +
        `4. Trading halts if equity falls ${limits.haltDrawdownPct}% below budget - a losing system must stop, not "win it back".\n` +
        'Limits configurable via RISK_* env vars.'
      }
    >
      {!hasAccount ? (
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
          set a budget to activate risk enforcement - gauges measure against account equity
        </span>
      ) : (
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Gauge
            label="OPEN RISK"
            used={openRiskPct}
            limit={limits.maxOpenRiskPct}
            unit="%"
            title={`$${exposure.openRiskUSD.toFixed(2)} lost if every stop hits - capped at ${limits.maxOpenRiskPct}% of equity. Stop-less trades counted at full cost.`}
          />
          <Gauge
            label="LARGEST POSITION"
            used={largestPct}
            limit={limits.maxPositionPct}
            unit="%"
            title={
              exposure.largestPosition
                ? `${exposure.largestPosition.symbol}: $${exposure.largestPosition.costUSD.toFixed(2)} of equity`
                : 'no open positions'
            }
          />
          <Gauge
            label="OPEN TRADES"
            used={exposure.openTrades}
            limit={limits.maxOpenTrades}
            unit=""
            title="simultaneously open paper trades"
          />
          <Gauge
            label="DRAWDOWN"
            used={drawdownPct}
            limit={limits.haltDrawdownPct}
            unit="%"
            title={`equity below starting budget - at ${limits.haltDrawdownPct}% all new entries halt`}
          />
        </div>
      )}
    </Panel>
  );
}
