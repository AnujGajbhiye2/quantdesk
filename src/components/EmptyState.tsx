interface Props {
  message: string;
  hint?: string;
  /** 'empty' renders in muted grey; 'error' renders in red. Default: 'empty'. */
  tone?: 'empty' | 'error';
}

export default function EmptyState({ message, hint, tone = 'empty' }: Props) {
  const color = tone === 'error' ? 'var(--color-down)' : 'var(--text-muted)';
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '2px 0' }}>
      <span style={{ color, fontSize: '12px' }}>{message}</span>
      {hint && (
        <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>{hint}</span>
      )}
    </div>
  );
}
