import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — list recent playwright scans
export async function GET() {
  const scansQ = await query(
    `SELECT id, check_in, take_screenshot, status, total, processed, errors, created_at, finished_at
     FROM playwright_scans ORDER BY id DESC LIMIT 50`,
    [],
  );
  return NextResponse.json(scansQ.rows);
}
