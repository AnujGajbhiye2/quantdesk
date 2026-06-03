import type { ReactNode } from 'react';
import EmptyState from './EmptyState';

interface PanelProps {
  title: string;
  children?: ReactNode;
  className?: string;
  headerRight?: ReactNode;
}

export default function Panel({ title, children, className = '', headerRight }: PanelProps) {
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
        <span style={{ color: 'var(--text-muted)', fontSize: '11px', letterSpacing: '0.08em' }}>
          [ {title} ]
        </span>
        {headerRight && (
          <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>{headerRight}</span>
        )}
      </div>
      <div className="flex-1 overflow-auto p-3">
        {children ?? <EmptyState message="— no data —" />}
      </div>
    </div>
  );
}
