import { describe, it, expect } from 'vitest';
import { buildHeartbeatText } from './heartbeat';

const baseOpts = {
  seq: 7,
  haltState:    { halted: false as const },
  openCount:    2,
  openedToday:  1,
  closedToday:  0,
  ddLine:       'DD: 1.2% | breaker at -20% of $10000',
  freshLabel:   'fresh (45m ago)',
  signalCount:  14,
  sweepLine:    'Sweep: 2 open checked, none closed',
  refreshTime:  '2025-01-15 17:05 ET',
  gapsLine:     'Gaps: none detected',
};

describe('buildHeartbeatText', () => {
  it('includes seq number in header', () => {
    const text = buildHeartbeatText(
      { totalBars: 200, symbolCount: 50, refreshErrors: 0, post: { pendingFills: { results: [] }, sweep: { results: [] }, scan: { result: null }, edge: { result: null }, gaps: { results: [] } } },
      baseOpts,
    );
    expect(text).toContain('#7');
    expect(text).toContain('2025-01-15 17:05 ET');
  });

  it('shows bars ingested and symbol count', () => {
    const text = buildHeartbeatText(
      { totalBars: 347, symbolCount: 503, refreshErrors: 0, post: { pendingFills: { results: [] }, sweep: { results: [] }, scan: { result: null }, edge: { result: null }, gaps: { results: [] } } },
      baseOpts,
    );
    expect(text).toContain('347 bars');
    expect(text).toContain('503 symbols');
  });

  it('shows ERROR tag when refresh had errors', () => {
    const text = buildHeartbeatText(
      { totalBars: 100, symbolCount: 10, refreshErrors: 3, post: { pendingFills: { results: [] }, sweep: { results: [] }, scan: { result: null }, edge: { result: null }, gaps: { results: [] } } },
      baseOpts,
    );
    expect(text).toContain('3 ERROR');
  });

  it('renders INACTIVE drawdown breaker branch', () => {
    const text = buildHeartbeatText(
      { totalBars: 0, symbolCount: 0, refreshErrors: 0, post: { pendingFills: { results: [] }, sweep: { results: [] }, scan: { result: null }, edge: { result: null }, gaps: { results: [] } } },
      { ...baseOpts, ddLine: 'DD breaker: INACTIVE - no budget set' },
    );
    expect(text).toContain('INACTIVE');
  });

  it('renders stale data freshness', () => {
    const text = buildHeartbeatText(
      { totalBars: 0, symbolCount: 0, refreshErrors: 0, post: { pendingFills: { results: [] }, sweep: { results: [] }, scan: { result: null }, edge: { result: null }, gaps: { results: [] } } },
      { ...baseOpts, freshLabel: 'STALE (26.0h ago)' },
    );
    expect(text).toContain('STALE');
  });

  it('renders HALT ACTIVE when halted', () => {
    const text = buildHeartbeatText(
      { totalBars: 0, symbolCount: 0, refreshErrors: 0, post: { pendingFills: { results: [] }, sweep: { results: [] }, scan: { result: null }, edge: { result: null }, gaps: { results: [] } } },
      { ...baseOpts, haltState: { halted: true, reason: 'remote halt via Telegram [set 2025-01-15T12:00:00Z]' } },
    );
    expect(text).toContain('HALT ACTIVE');
    expect(text).toContain('remote halt via Telegram');
  });

  it('always includes cron-alive confirmation line', () => {
    const text = buildHeartbeatText(
      { totalBars: 0, symbolCount: 0, refreshErrors: 0, post: { pendingFills: { results: [] }, sweep: { results: [] }, scan: { result: null }, edge: { result: null }, gaps: { results: [] } } },
      baseOpts,
    );
    expect(text).toContain('Cron: alive');
  });

  it('renders the gaps line', () => {
    const text = buildHeartbeatText(
      { totalBars: 0, symbolCount: 0, refreshErrors: 0, post: { pendingFills: { results: [] }, sweep: { results: [] }, scan: { result: null }, edge: { result: null }, gaps: { results: [] } } },
      { ...baseOpts, gapsLine: 'Gaps: 3 missing bar(s) across universe (worst: XYZ x2)' },
    );
    expect(text).toContain('Gaps: 3 missing bar(s)');
    expect(text).toContain('worst: XYZ x2');
  });
});
