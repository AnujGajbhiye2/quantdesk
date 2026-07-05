'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';

interface Props {
  mode: 'login' | 'signup';
}

const inputStyle: React.CSSProperties = {
  background:    'var(--bg-panel)',
  border:        '1px solid var(--border)',
  color:         'var(--text-primary)',
  fontFamily:    'var(--font-mono)',
  fontSize:      'var(--fs-sm)',
  padding:       '8px 10px',
  width:         '100%',
};

const buttonStyle: React.CSSProperties = {
  background:    'var(--color-accent)',
  border:        'none',
  color:         '#0a0e14',
  fontFamily:    'var(--font-mono)',
  fontSize:      'var(--fs-sm)',
  fontWeight:    700,
  padding:       '9px 10px',
  cursor:        'pointer',
  letterSpacing: '0.04em',
  width:         '100%',
};

const googleButtonStyle: React.CSSProperties = {
  background:    'var(--bg-panel)',
  border:        '1px solid var(--border)',
  color:         'var(--text-primary)',
  fontFamily:    'var(--font-mono)',
  fontSize:      'var(--fs-sm)',
  padding:       '9px 10px',
  cursor:        'pointer',
  letterSpacing: '0.04em',
  width:         '100%',
};

export default function SignInForm({ mode }: Props) {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [name,     setName]     = useState('');
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'signup') {
        const res = await fetch('/api/signup', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ email, password, name }),
        });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? 'signup failed');
        }
      }
      const result = await signIn('credentials', { email, password, redirect: false });
      if (result?.error) {
        throw new Error('invalid email or password');
      }
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <button
        type="button"
        style={googleButtonStyle}
        onClick={() => void signIn('google', { redirectTo: '/' })}
      >
        CONTINUE WITH GOOGLE
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        OR
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {mode === 'signup' && (
          <input
            type="text"
            placeholder="name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
          />
        )}
        <input
          type="email"
          placeholder="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
        />
        <input
          type="password"
          placeholder="password"
          required
          minLength={mode === 'signup' ? 8 : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
        />
        {error && (
          <span style={{ color: 'var(--color-down)', fontSize: 'var(--fs-xs)' }}>
            error: {error}
          </span>
        )}
        <button type="submit" disabled={busy} style={buttonStyle}>
          {busy ? 'WORKING...' : mode === 'signup' ? 'SIGN UP' : 'LOG IN'}
        </button>
      </form>

      <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', textAlign: 'center' }}>
        {mode === 'signup' ? (
          <>already have an account? <a href="/login" style={{ color: 'var(--color-accent)' }}>log in</a></>
        ) : (
          <>no account? <a href="/signup" style={{ color: 'var(--color-accent)' }}>sign up</a></>
        )}
      </div>
    </div>
  );
}
