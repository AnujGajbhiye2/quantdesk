'use client';

import { useEffect, useState } from 'react';

type Session =
  | 'EU OPEN'
  | 'US PRE-MARKET'
  | 'US OPEN'
  | 'US AFTER-HOURS'
  | 'CLOSED';

function getSession(date: Date): Session {
  // All times in UTC
  const utcHour = date.getUTCHours();
  const utcMin = date.getUTCMinutes();
  const utcTotal = utcHour * 60 + utcMin;
  const dayOfWeek = date.getUTCDay(); // 0=Sun, 6=Sat

  if (dayOfWeek === 0 || dayOfWeek === 6) return 'CLOSED';

  // EU open: 07:00–15:30 UTC (Frankfurt/London)
  // US pre-market: 13:00–14:30 UTC (08:00–09:30 ET)
  // US open: 14:30–21:00 UTC (09:30–16:00 ET)
  // US after-hours: 21:00–01:00 UTC (16:00–20:00 ET)

  if (utcTotal >= 7 * 60 && utcTotal < 13 * 60) return 'EU OPEN';
  if (utcTotal >= 13 * 60 && utcTotal < 14 * 60 + 30) return 'US PRE-MARKET';
  if (utcTotal >= 14 * 60 + 30 && utcTotal < 21 * 60) return 'US OPEN';
  if (utcTotal >= 21 * 60 || utcTotal < 1 * 60) return 'US AFTER-HOURS';
  return 'CLOSED';
}

const SESSION_COLORS: Record<Session, string> = {
  'EU OPEN': '#e3b341',
  'US PRE-MARKET': '#8b949e',
  'US OPEN': '#26a641',
  'US AFTER-HOURS': '#8b949e',
  CLOSED: '#f85149',
};

export default function DublinClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) return <span style={{ color: 'var(--text-muted)' }}>--:--:-- --</span>;

  const timeStr = new Intl.DateTimeFormat('en-IE', {
    timeZone: 'Europe/Dublin',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(now);

  const session = getSession(now);
  const color = SESSION_COLORS[session];

  return (
    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
      <span style={{ color: 'var(--text-primary)' }}>{timeStr} IE</span>
      {' '}
      <span style={{ color, fontSize: 'var(--fs-xs)' }}>[{session}]</span>
    </span>
  );
}
