import { NextRequest, NextResponse } from 'next/server';
import { sql, query } from '@/lib/db';
import { runChunk } from '@/lib/playwright-scan-runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) { return processNext(req); }
export async function POST(req: NextRequest) { return processNext(req); }

async function processNext(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('[playwright-process-next] cron tick', new Date().toISOString());

  try {
    const scanQ = await sql`
      SELECT id, check_in, take_screenshot
      FROM playwright_scans
      WHERE status = 'running'
      ORDER BY id ASC
      LIMIT 1
    `;

    if (scanQ.rows.length === 0) {
      return NextResponse.json({ message: 'No running playwright scans' });
    }

    const scan = scanQ.rows[0];
    const scanId: number = scan.id;
    const takeScreenshot: boolean = scan.take_screenshot ?? false;

    const offsetQ = await query(
      `SELECT COUNT(DISTINCT hotel_id)::int AS cnt FROM playwright_scan_results WHERE scan_id = $1`,
      [scanId],
    );
    const offset: number = offsetQ.rows[0].cnt;

    const totalQ = await query(
      `SELECT COUNT(*)::int AS cnt FROM hotels WHERE active = true AND bookable = true`,
      [],
    );
    const total: number = totalQ.rows[0].cnt;

    if (offset >= total) {
      await sql`UPDATE playwright_scans SET status = 'done', finished_at = NOW() WHERE id = ${scanId}`;
      return NextResponse.json({ message: 'Scan complete', scanId });
    }

    console.log(`[playwright-process-next] scan=${scanId} offset=${offset}/${total}`);

    const result = await runChunk({ scanId, offset, takeScreenshot });
    return NextResponse.json({ scanId, offset, total, ...result });

  } catch (e: any) {
    console.error('[playwright-process-next] fatal', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
