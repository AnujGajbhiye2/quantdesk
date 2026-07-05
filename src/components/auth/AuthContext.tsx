'use client';

/**
 * Exposes isAdmin (derived server-side from the session) to client
 * components so they can hide controls that only apply to the admin.
 *
 * This is a UX convenience only - it decides what renders, not what is
 * allowed. The real enforcement lives server-side: middleware.ts redirects
 * non-admins away from admin-only pages, and every mutating/trade-reading
 * API route calls requireAdmin()/requireUser() (src/core/auth/guard.ts).
 * Hiding a button here never substitutes for that.
 */

import { createContext, useContext } from 'react';

interface AuthContextValue {
  isAdmin: boolean;
  email:   string | null;
  name:    string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  isAdmin,
  email,
  name,
  children,
}: {
  isAdmin: boolean;
  email:   string | null;
  name:    string | null;
  children: React.ReactNode;
}) {
  return (
    <AuthContext.Provider value={{ isAdmin, email, name }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
