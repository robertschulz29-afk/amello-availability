import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { validatePassword } from '@/lib/password-policy';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!username || !email || !password) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const passwordCheck = validatePassword(password, username);
  if (!passwordCheck.valid) {
    return NextResponse.json({ error: passwordCheck.reason }, { status: 400 });
  }

  const passwordHash = hashPassword(password);

  try {
    await query(
      `INSERT INTO users (username, email, password_hash, role, status)
       VALUES ($1, $2, $3, 'viewer', 'registered')`,
      [username, email, passwordHash],
    );
    return NextResponse.json(
      { message: 'Your account has been created and is pending admin activation' },
      { status: 201 },
    );
  } catch (e: any) {
    if (e?.code === '23505') {
      return NextResponse.json({ error: 'Username or email already exists' }, { status: 409 });
    }
    console.error('[POST /api/auth/register] error', e);
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 });
  }
}
