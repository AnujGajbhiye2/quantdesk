import NextAuth from 'next-auth';
import { authConfig } from '../auth.config';

// Next 16 renamed middleware.ts -> proxy.ts (default export, previously the
// named `middleware` export). The proxy runtime is always nodejs now (no
// edge option), but we still consume only the lightweight Edge-safe
// authConfig here - the Credentials provider (DB + bcrypt) belongs in
// auth.ts, used everywhere else, so this file's job stays a simple session
// check.
export default NextAuth(authConfig).auth;

export const config = {
  // Run on every route except Next internals and static assets. The
  // `authorized` callback in auth.config.ts decides pass-through vs redirect.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|woff2?)$).*)'],
};
