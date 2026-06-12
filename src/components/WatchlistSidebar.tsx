'use client';

import InfoTip from './InfoTip';
import type { WatchlistItem } from '@/app/api/watchlist/route';

interface Props {
  items:      WatchlistItem[];
  strategies: { id: string; name: string }[];
  onUnpin:    (symbol: string) => void;
  onClose:    () => void;
  onNavigate: (symbol: string) => void;
}

const STALE_MS = 7 * 86_400_000;

function sideColor(side: 'long' | 'short' | 'flat'): string {
  if (side === 'long') return 'var(--color-up)';
  if (side === 'short') return 'var(--color-down)';
  return 'var(--color-accent)';
}

/**
 * Compact watchlist sidebar ([w] to toggle): pinned symbols with the latest
 * signal status per strategy as a colour-coded dot strip. One glance = full
 * picture of current signals across the pinned universe.
 */
export default function WatchlistSidebar({ items, strategies, onUnpin, onClose, onNavigate }: Props) {
  return (
    <div
      style={{
        position: 'fixed',
        right: 0,
        top: 0,
        bottom: 0,
        width: 280,
        zIndex: 150,
        background: 'var(--bg-panel)',
        borderLeft: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'var(--font-mono)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 8px',
          background: 'var(--bg-panel-header)',
          borderBottom: '1px solid var(--border)',
          fontSize: 'var(--fs-xs)',
          letterSpacing: '0.08em',
        }}
      >
        <span style={{ color: 'var(--color-accent)', fontWeight: 700 }}>
          WATCHLIST
          <span style={{ marginLeft: 4 }}>
            <InfoTip
              term="WATCHLIST"
              text="Your pinned symbols with the latest stored signal per strategy as colour dots: green long, red short, amber flat, grey no data. Dimmed dots are stale. One glance = current picture across everything you care about."
            />
          </span>
        </span>
        <span style={{ color: 'var(--text-muted)' }}>
          [w] close
          <button
            onClick={onClose}
            aria-label="close watchlist"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              marginLeft: 8,
            }}
          >
            x
          </button>
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {items.length === 0 && (
          <div
            style={{
              color: 'var(--text-muted)',
              fontSize: 'var(--fs-xs)',
              padding: '16px 10px',
              textAlign: 'center',
            }}
          >
            — empty —
            <div style={{ marginTop: 6 }}>press p on a selected row to pin</div>
          </div>
        )}

        {items.map((item) => {
          const statusMap = new Map(item.statuses.map((s) => [s.strategyId, s]));
          const newestMs = item.statuses.reduce(
            (max, s) => Math.max(max, new Date(s.time).getTime()),
            0,
          );
          const newestDate = newestMs > 0
            ? new Date(newestMs).toISOString().slice(0, 10)
            : null;

          return (
            <div
              key={item.symbol}
              style={{ borderBottom: '1px solid var(--border)', padding: '5px 8px' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <button
                  onClick={() => onNavigate(item.symbol)}
                  title={`backtest ${item.symbol}`}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--color-accent)',
                    fontWeight: 600,
                    fontSize: 'var(--fs-sm)',
                    fontFamily: 'var(--font-mono)',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  {item.symbol}
                </button>
                <button
                  onClick={() => onUnpin(item.symbol)}
                  title={`unpin ${item.symbol}`}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--fs-xs)',
                  }}
                >
                  x
                </button>
              </div>

              <div style={{ display: 'flex', gap: 4, marginTop: 3, alignItems: 'center' }}>
                {strategies.map((strat) => {
                  const status = statusMap.get(strat.id);
                  if (!status) {
                    return (
                      <span
                        key={strat.id}
                        title={`${strat.name}: no signal on record`}
                        style={{
                          width: 8,
                          height: 8,
                          background: 'var(--border)',
                          display: 'inline-block',
                        }}
                      />
                    );
                  }
                  // Dim statuses much older than the newest one - the signals
                  // table only fills on scans; an old LONG must not look current.
                  const stale = newestMs - new Date(status.time).getTime() > STALE_MS;
                  return (
                    <span
                      key={strat.id}
                      title={`${strat.name}: ${status.side.toUpperCase()} (${status.time})${stale ? ' - stale' : ''}`}
                      style={{
                        width: 8,
                        height: 8,
                        background: sideColor(status.side),
                        opacity: stale ? 0.35 : 1,
                        display: 'inline-block',
                      }}
                    />
                  );
                })}
              </div>

              {newestDate && (
                <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', marginTop: 2 }}>
                  latest signal {newestDate}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div
        style={{
          padding: '3px 8px',
          borderTop: '1px solid var(--border)',
          color: 'var(--text-muted)',
          fontSize: 'var(--fs-xs)',
        }}
      >
        long · short · flat · no data
      </div>
    </div>
  );
}
