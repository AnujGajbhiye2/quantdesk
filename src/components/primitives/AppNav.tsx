'use client';

import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/',                   label: 'DASH' },
  { href: '/backtest',           label: 'BACKTEST' },
  { href: '/compare',            label: 'COMPARE' },
  { href: '/paper',              label: 'PAPER' },
  { href: '/journal',            label: 'JOURNAL' },
  { href: '/dashboard/session',  label: 'SESSION' },
  { href: '/settings',           label: 'SETTINGS' },
];

export default function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-6" style={{ fontSize: 'var(--fs-sm)' }}>
      {LINKS.map(({ href, label }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <a
            key={href}
            href={href}
            style={{
              color: active ? 'var(--color-accent)' : 'var(--text-muted)',
              textDecoration: 'none',
            }}
          >
            {label}
          </a>
        );
      })}
    </nav>
  );
}
