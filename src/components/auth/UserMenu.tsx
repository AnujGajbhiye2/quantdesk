'use client';

import { useEffect, useRef, useState } from 'react';
import { signOut } from 'next-auth/react';
import { useAuth } from '@/components/auth/AuthContext';

/** Small user icon in the nav bar - click opens a dropdown with name/email + sign out. */
export default function UserMenu() {
  const { email, name, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  const label = name ?? email ?? 'account';
  const initial = (name ?? email ?? '?').charAt(0).toUpperCase();

  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={label}
        aria-label="User menu"
        aria-expanded={open}
        style={{
          width: 26,
          height: 26,
          borderRadius: '50%',
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          color: 'var(--color-accent)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-xs)',
          fontWeight: 700,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {initial}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 200,
            background: 'var(--bg-panel-header)',
            border: '1px solid var(--border)',
            minWidth: 200,
            fontFamily: 'var(--font-mono)',
          }}
        >
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ color: 'var(--text-primary)', fontSize: 'var(--fs-sm)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {name ?? 'no name set'}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {email}
            </div>
            {isAdmin && (
              <div style={{ color: 'var(--color-accent)', fontSize: 'var(--fs-xs)', marginTop: 4, letterSpacing: '0.06em' }}>
                ADMIN
              </div>
            )}
          </div>
          <button
            onClick={() => void signOut({ redirectTo: '/login' })}
            style={{
              width: '100%',
              textAlign: 'left',
              background: 'none',
              border: 'none',
              color: 'var(--color-down)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--fs-xs)',
              padding: '8px 12px',
              cursor: 'pointer',
              letterSpacing: '0.06em',
            }}
          >
            SIGN OUT
          </button>
        </div>
      )}
    </div>
  );
}
