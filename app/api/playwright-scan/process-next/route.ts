import { NextRequest, NextResponse } from 'next/server';
import { sql, query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resolveAppUrl(req: NextRequest): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest) { return processNext(req); }
export async function POST(req: NextRequest) { return processNext(req); }

async function processNext(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('[playwright-process-next] cron tick', new Date().toISOString());

  try {
    // Find the oldest running playwright scan
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

    // Compute next offset: how many distinct hotels already have results
    const offsetQ = await query(
      `SELECT COUNT(DISTINCT hotel_id)::int AS cnt FROM playwright_scan_results WHERE scan_id = $1`,
      [scanId],
    );
    const offset: number = offsetQ.rows[0].cnt;

    // Check total hotels
    const totalQ = await query(
      `SELECT COUNT(*)::int AS cnt FROM hotels WHERE active = true AND bookable = true`,
      [],
    );
    const total: number = totalQ.rows[0].cnt;

    if (offset >= total) {
      await sql`UPDATE playwright_scans SET status = 'done', finished_at = NOW() WHERE id = ${scanId}`;
      return NextResponse.json({ message: 'Scan complete', scanId });
    }

    const appUrl = resolveAppUrl(req);

    console.log(`[playwright-process-next] scan=${scanId} offset=${offset}/${total}`);

    const res = await fetch(`${appUrl}/api/playwright-scan/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scanId, offset, takeScreenshot, appUrl }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[playwright-process-next] process route error', res.status, text.slice(0, 200));
      return NextResponse.json({ error: 'Process route failed', status: res.status }, { status: 500 });
    }

    const result = await res.json();
    console.log('[playwright-process-next] done', result);
    return NextResponse.json({ scanId, offset, total, ...result });

  } catch (e: any) {
    console.error('[playwright-process-next] fatal', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
