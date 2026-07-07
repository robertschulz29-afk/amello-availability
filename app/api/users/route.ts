import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifySessionToken, COOKIE_NAME } from '@/lib/auth-edge';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { rows } = await query(
    `SELECT id, username, email, role, status, created_at FROM users ORDER BY username`,
  );
  return NextResponse.json(rows);
}
