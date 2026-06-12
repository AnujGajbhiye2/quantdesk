'use client';

import { useRef, useState, useImperativeHandle, forwardRef } from 'react';
import type { MarketRow } from '@/core/market/snapshot';
import type { EdgeSummary } from '@/core/edge/context';
import type { EnrichedTradeIdea } from '@/core/signals/gate';
import type { Signal } from '@/core/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommandBarHandle {
  focus(): void;
}

interface CommandBarProps {
  onMarketRefresh: (rows: MarketRow[]) => void;
  onSignals: (
    signals: Signal[],
    ideas?:  EnrichedTradeIdea[],
    edges?:  Record<string, EdgeSummary | null>,
  ) => void;
}

// ---------------------------------------------------------------------------
// Command parser
// ---------------------------------------------------------------------------

/**
 * Parse a minimal command syntax:
 *   scan --strategy=<id> [--symbols=SYM1,SYM2]
 *
 * Returns null if unrecognised.
 */
function parseCommand(raw: string): { cmd: string; args: Record<string, string> } | null {
  const parts = raw.trim().split(/\s+/);
  if (parts.length === 0) return null;
  const cmd = parts[0].toLowerCase();
  const args: Record<string, string> = {};
  for (const part of parts.slice(1)) {
    const m = part.match(/^--([a-z-]+)=(.+)$/);
    if (m) args[m[1]] = m[2];
  }
  return { cmd, args };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const CommandBar = forwardRef<CommandBarHandle, CommandBarProps>(function CommandBar(
  { onMarketRefresh, onSignals },
  ref,
) {
  const inputRef   = useRef<HTMLInputElement>(null);
  const [value, setValue]   = useState('');
  const [status, setStatus] = useState<string>('ready');
  const [busy, setBusy]     = useState(false);

  useImperativeHandle(ref, () => ({
    focus() { inputRef.current?.focus(); },
  }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseCommand(value);
    if (!parsed) {
      setStatus(`unknown command: "${value}"`);
      return;
    }

    if (parsed.cmd === 'scan') {
      const strategyId = parsed.args['strategy'];
      if (!strategyId) {
        setStatus('scan: --strategy=<id> required');
        return;
      }
      const symbols = parsed.args['symbols']?.split(',').map((s) => s.trim());

      setBusy(true);
      setStatus('scanning...');

      try {
        const t0  = Date.now();
        const res = await fetch('/api/scan', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ strategyId, symbols }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json() as {
          signals:    Signal[];
          ideas?:     EnrichedTradeIdea[];
          edges?:     Record<string, EdgeSummary | null>;
          scanned:    number;
          durationMs: number;
        };
        onSignals(data.signals, data.ideas, data.edges);

        // Refresh market data
        const mRes  = await fetch('/api/market');
        const mData = await mRes.json() as { rows: MarketRow[] };
        onMarketRefresh(mData.rows);

        const elapsed = Date.now() - t0;
        setStatus(
          `scan complete - ${data.signals.length} signal(s) across ${data.scanned} symbols in ${elapsed}ms`,
        );
        setValue('');
      } catch (err) {
        setStatus(`error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(false);
      }
      return;
    }

    setStatus(`unknown command: "${parsed.cmd}" - try: scan --strategy=rsi-reversion`);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-3 flex-1"
      style={{ minWidth: 0 }}
    >
      <span style={{ color: 'var(--color-accent)', flexShrink: 0, fontSize: 'var(--fs-sm)' }}>
        &gt;
      </span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={busy}
        placeholder="scan --strategy=rsi-reversion [--symbols=AAPL,MSFT]"
        style={{
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-sm)',
          flex: 1,
          minWidth: 0,
        }}
      />
      <span
        style={{
          color: busy ? 'var(--color-accent)' : 'var(--text-muted)',
          fontSize: 'var(--fs-xs)',
          flexShrink: 0,
          maxWidth: '50%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {status}
      </span>
    </form>
  );
});

export default CommandBar;
