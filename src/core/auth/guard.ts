import 'server-only';
import { auth } from '../../../auth';
import { isAdminEmail } from './admin';

export interface SessionUser {
  email:   string;
  isAdmin: boolean;
}

export class AuthError extends Error {
  constructor(message: string, readonly status: 401 | 403) {
    super(message);
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;
  return { email, isAdmin: isAdminEmail(email) };
}

/** Throws AuthError(401) if not logged in. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError('unauthorized', 401);
  return user;
}

/** Throws AuthError(401/403) if not logged in / not the admin. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isAdmin) throw new AuthError('forbidden', 403);
  return user;
}
