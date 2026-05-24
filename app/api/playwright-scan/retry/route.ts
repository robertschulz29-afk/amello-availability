import { NextRequest, NextResponse } from 'next/server';
import { sql, query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/playwright-scan/retry  body: { scanId }
export async function POST(req: NextRequest) {
  try {
    const { scanId } = await req.json();
    if (!Number.isFinite(scanId) || scanId <= 0) {
      return NextResponse.json({ error: 'invalid scanId' }, { status: 400 });
    }

    const scanQ = await sql`SELECT id, status FROM playwright_scans WHERE id = ${scanId}`;
    if (!scanQ.rows.length) return NextResponse.json({ error: 'scan not found' }, { status: 404 });
    if (scanQ.rows[0].status === 'running') {
      return NextResponse.json({ error: 'scan is still running' }, { status: 409 });
    }

    const errorQ = await query(
      `SELECT COUNT(*)::int AS cnt FROM playwright_scan_results WHERE scan_id = $1 AND error IS NOT NULL`,
      [scanId],
    );
    const errorCount: number = errorQ.rows[0].cnt;
    if (errorCount === 0) {
      return NextResponse.json({ error: 'no errors to retry' }, { status: 400 });
    }

    // Block if another scan is already running
    const running = await sql`SELECT id FROM playwright_scans WHERE status = 'running' LIMIT 1`;
    if (running.rows.length > 0) {
      return NextResponse.json({ error: 'another scan is already running', runningScanId: running.rows[0].id }, { status: 409 });
    }

    await sql`
      UPDATE playwright_scans
      SET status = 'running', retry_attempted = FALSE, locked_until = NULL, finished_at = NULL
      WHERE id = ${scanId}
    `;

    return NextResponse.json({ scanId, errorCount, message: 'Scan re-queued for retry — cron will pick it up shortly' });
  } catch (e: any) {
    console.error('[POST /api/playwright-scan/retry]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
