import { NextRequest, NextResponse } from 'next/server';
import { query, sql } from '@/lib/db';
import { runChunk } from '@/lib/playwright-scan-runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// POST — trigger a new scan
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { checkIn, takeScreenshot = false } = body;

    if (!checkIn || !/^\d{4}-\d{2}-\d{2}$/.test(checkIn)) {
      return NextResponse.json({ error: 'checkIn must be YYYY-MM-DD' }, { status: 400 });
    }

    // Block concurrent scans
    const running = await sql`SELECT id FROM playwright_scans WHERE status = 'running' LIMIT 1`;
    if (running.rows.length > 0) {
      return NextResponse.json(
        { error: 'A scan is already running', scanId: running.rows[0].id },
        { status: 409 },
      );
    }

    const hotels = await query(
      `SELECT id FROM hotels WHERE active = true AND bookable = true`,
      [],
    );
    const total = hotels.rows.length * 4;

    const scanRow = await sql`
      INSERT INTO playwright_scans (check_in, take_screenshot, total)
      VALUES (${checkIn}, ${takeScreenshot}, ${total})
      RETURNING id
    `;
    const scanId = scanRow.rows[0].id;

    // Kick off the first chunk directly — cron handles subsequent chunks
    runChunk({ scanId, offset: 0, takeScreenshot }).catch((e: any) =>
      console.error('[playwright-scan] kickoff chunk failed', e.message),
    );

    return NextResponse.json({ scanId, total });
  } catch (e: any) {
    console.error('[POST /api/playwright-scan]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// GET — poll scan status
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const scanId = Number(searchParams.get('scanId'));
    if (!Number.isFinite(scanId) || scanId <= 0) {
      return NextResponse.json({ error: 'invalid scanId' }, { status: 400 });
    }

    const row = await sql`
      SELECT id, check_in, take_screenshot, status, total, processed, errors, created_at, finished_at
      FROM playwright_scans WHERE id = ${scanId}
    `;
    if (!row.rows.length) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json(row.rows[0]);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
