import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
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
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
