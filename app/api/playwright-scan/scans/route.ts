import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await sql`
      SELECT id, check_in, take_screenshot, status, total, processed, errors, created_at, finished_at
      FROM playwright_scans
      ORDER BY id DESC
      LIMIT 50
    `;
    return NextResponse.json(result.rows);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
