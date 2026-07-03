import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { runChunk } from '@/lib/playwright-scan-runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  // Authenticate server-to-server cron calls via CRON_SECRET bearer token
  // (this route is bypassed by middleware's session check — see middleware.ts).
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const scanId         = Number(body?.scanId);
  const offset         = Number.isFinite(body?.offset) ? Number(body.offset) : 0;
  const takeScreenshot: boolean = body?.takeScreenshot === true;

  if (!Number.isFinite(scanId) || scanId <= 0) {
    return NextResponse.json({ error: 'invalid scanId' }, { status: 400 });
  }

  try {
    const result = await runChunk({ scanId, offset, takeScreenshot });
    return NextResponse.json(result);
  } catch (e: any) {
    console.error('[process] unhandled error', e.message);
    await sql`UPDATE playwright_scans SET status = 'failed', finished_at = NOW() WHERE id = ${scanId}`.catch(() => {});
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
