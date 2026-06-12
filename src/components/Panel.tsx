import type { ReactNode } from 'react';
import EmptyState from './EmptyState';
import InfoTip from './InfoTip';

interface PanelProps {
  title: string;
  children?: ReactNode;
  className?: string;
  headerRight?: ReactNode;
  /** One-line plain-language note on what this panel does and why it matters - shown as a [?] popover. */
  info?: string;
  /** Always-visible one-liner under the title - what this panel is FOR. */
  subtitle?: string;
}

export default function Panel({ title, children, className = '', headerRight, info, subtitle }: PanelProps) {
  return (
    <div
      className={`flex flex-col overflow-hidden ${className}`}
      style={{
        background: 'var(--bg-panel)',
        border: '1px solid var(--border)',
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-1 shrink-0"
        style={{
          background: 'var(--bg-panel-header)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', letterSpacing: '0.08em' }}>
          [ {title} ]
          {info && (
            <span style={{ marginLeft: 4 }}>
              <InfoTip term={title} text={info} />
            </span>
          )}
        </span>
        {headerRight && (
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>{headerRight}</span>
        )}
      </div>
      {subtitle && (
        <div
          className="px-3 py-0.5 shrink-0"
          style={{
            color: 'var(--text-muted)',
            fontSize: 'var(--fs-xs)',
            borderBottom: '1px solid var(--border)',
            opacity: 0.85,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={subtitle}
        >
          {subtitle}
        </div>
      )}
      <div className="flex-1 overflow-auto p-3" style={{ minHeight: 0 }}>
        {children ?? <EmptyState message="— no data —" />}
      </div>
    </div>
  );
}
