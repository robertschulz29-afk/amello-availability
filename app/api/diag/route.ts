import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Only accessible with DIAG_SECRET or in development
  const diagSecret = process.env.DIAG_SECRET;
  if (diagSecret && req.headers.get('authorization') !== `Bearer ${diagSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!diagSecret && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }

  try {
    const hasUrl = !!process.env.POSTGRES_URL;

    // Try a ping (will throw if DB not reachable)
    const ping = await sql`SELECT 1 AS ok`;

    // Which required tables exist?
    const tables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema='public'
        AND table_name IN ('hotels','scans','scan_results','meta','scan_sources','scan_results_extended')
      ORDER BY table_name
    `;

    return NextResponse.json({
      env: { POSTGRES_URL: hasUrl ? 'set' : 'missing' },
      ping: ping.rows[0],
      tables: tables.rows.map((r: any) => r.table_name),
    });
  } catch (err: any) {
    console.error('[GET /api/diag] error:', err);
    return NextResponse.json({ error: 'Database connection failed' }, { status: 500 });
  }
}
