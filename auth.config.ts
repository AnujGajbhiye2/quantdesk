import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';
import { isAdminEmail } from '@/core/auth/admin';

// Edge-safe config: no DB, no bcrypt. This is what middleware.ts imports
// (Next runs middleware on the Edge runtime). The Credentials provider needs
// the DB and bcrypt, so it is appended only in auth.ts (Node runtime) - never
// import auth.ts (or anything that pulls in libsql/bcryptjs) from this file.
export const authConfig = {
  providers: [Google],
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  callbacks: {
    // Runs on every request middleware intercepts. false -> redirect to
    // pages.signIn; a Response -> used as-is (used here for the admin-path
    // redirect below).
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isPublic =
        pathname === '/login' ||
        pathname === '/signup' ||
        pathname.startsWith('/api/auth') ||
        pathname.startsWith('/api/signup');
      if (isPublic) return true;
      if (!auth?.user) return false;

      // /paper and /journal now show executed trades + performance to any
      // logged-in user (read-only) - only ops internals (/dashboard/session)
      // and account settings stay admin-only pages.
      const adminOnlyPaths = ['/dashboard', '/settings'];
      const isAdminPath = adminOnlyPaths.some((p) => pathname.startsWith(p));
      if (isAdminPath && !auth.user.isAdmin) {
        return Response.redirect(new URL('/', request.nextUrl));
      }
      return true;
    },
    jwt({ token }) {
      // Re-derived every request off the email, not the OAuth profile - so
      // flipping ADMIN_EMAIL takes effect without forcing a re-login.
      token.isAdmin = isAdminEmail(token.email);
      return token;
    },
    session({ session, token }) {
      if (session.user) session.user.isAdmin = !!token.isAdmin;
      return session;
    },
  },
} satisfies NextAuthConfig;
