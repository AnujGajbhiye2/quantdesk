import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getUserByEmail, createUser } from '@/core/db/users';
import { isAdminEmail } from '@/core/auth/admin';

interface SignupBody {
  email?: string;
  password?: string;
  name?: string;
}

export async function POST(request: Request) {
  const body = (await request.json()) as SignupBody;
  const email = (body.email ?? '').toLowerCase().trim();
  const password = body.password ?? '';
  const name = body.name?.trim() || null;

  if (!email || !password || password.length < 8) {
    return NextResponse.json(
      { error: 'email and a password of 8+ characters are required' },
      { status: 400 }
    );
  }
  if (isAdminEmail(email)) {
    return NextResponse.json({ error: 'this email is reserved' }, { status: 403 });
  }
  if (getUserByEmail(email)) {
    return NextResponse.json({ error: 'an account with this email already exists' }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  createUser(email, passwordHash, name);
  return NextResponse.json({ ok: true });
}
