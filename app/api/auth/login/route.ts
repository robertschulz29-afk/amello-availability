import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyPassword, createSessionToken, COOKIE_NAME, MAX_AGE } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();

  if (!username || !password) {
    return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
  }

  const { rows } = await query('SELECT password_hash, role, status FROM users WHERE username = $1', [username]);
  const user = rows[0];

  if (!user || !verifyPassword(password, user.password_hash)) {
    return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
  }

  if (user.status === 'registered') {
    return NextResponse.json({ error: 'Your account is pending admin activation' }, { status: 403 });
  }
  if (user.status === 'inactive') {
    return NextResponse.json({ error: 'This account has been deactivated. Contact an administrator.' }, { status: 403 });
  }

  const token = await createSessionToken(username, user.role);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: MAX_AGE,
    path: '/',
  });
  return res;
}
