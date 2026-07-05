import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { authConfig } from './auth.config';
import { getUserByEmail, upsertOAuthUser } from '@/core/db/users';
import { isAdminEmail } from '@/core/auth/admin';

export const { auth, handlers, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    ...authConfig.providers,
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(creds) {
        const email = String(creds?.email ?? '').toLowerCase().trim();
        const password = String(creds?.password ?? '');
        if (!email || !password) return null;

        // Admin-email reservation: the admin account never has a password -
        // it can only sign in via Google. This stops anyone from registering
        // the admin email and impersonating it.
        if (isAdminEmail(email)) return null;

        const user = getUserByEmail(email);
        if (!user?.passwordHash) return null;
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;
        return { id: user.id, email: user.email, name: user.name ?? null };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account }) {
      // Persist google sign-ins into the users table (credentials users are
      // already persisted at signup time). Not required for the session
      // (JWT carries everything needed) - kept for a visible user list.
      if (account?.provider === 'google' && user.email) {
        upsertOAuthUser(user.email, user.name ?? null);
      }
      return true;
    },
  },
});
