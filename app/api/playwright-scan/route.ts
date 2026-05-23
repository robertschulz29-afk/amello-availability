import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST — trigger a new playwright scan
// Body: { checkIn: string, takeScreenshot?: boolean }
export async function POST(req: NextRequest) {
  let body: { checkIn?: string; takeScreenshot?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { checkIn, takeScreenshot = false } = body;

  // Validate checkIn format
  if (!checkIn || !/^\d{4}-\d{2}-\d{2}$/.test(checkIn)) {
    return NextResponse.json({ error: 'checkIn must be a YYYY-MM-DD date' }, { status: 400 });
  }

  // Block if a scan is already running
  const runningQ = await query<{ id: number }>(
    `SELECT id FROM playwright_scans WHERE status = 'running' LIMIT 1`,
    [],
  );
  if (runningQ.rows.length > 0) {
    return NextResponse.json(
      { error: 'A scan is already running', scanId: runningQ.rows[0].id },
      { status: 409 },
    );
  }

  // Load active+bookable hotels
  const hotelsQ = await query<{ id: number; name: string; code: string }>(
    `SELECT id, name, code FROM hotels WHERE active = true AND bookable = true ORDER BY id`,
    [],
  );
  const hotels = hotelsQ.rows;
  const total = hotels.length * 4; // 4 occupancy configs

  // Insert the scan row
  const insertQ = await query<{ id: number }>(
    `INSERT INTO playwright_scans (check_in, take_screenshot, status, total)
     VALUES ($1, $2, 'running', $3)
     RETURNING id`,
    [checkIn, takeScreenshot, total],
  );
  const scanId = insertQ.rows[0].id;

  // Fire-and-forget: POST to process endpoint with first chunk
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    console.error('[playwright-scan] NEXT_PUBLIC_APP_URL is not set — cannot self-call process');
  } else {
    // No await — fire and forget
    fetch(`${appUrl}/api/playwright-scan/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scanId, offset: 0, takeScreenshot }),
    }).catch(err => {
      console.error('[playwright-scan] Failed to fire process request:', err);
    });
  }

  return NextResponse.json({ scanId, total });
}

// GET — poll scan status
// Query param: scanId
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const scanId = Number(searchParams.get('scanId'));

  if (!Number.isFinite(scanId) || scanId <= 0) {
    return NextResponse.json({ error: 'scanId query param required' }, { status: 400 });
  }

  const scanQ = await query(
    `SELECT id, check_in, take_screenshot, status, total, processed, errors, created_at, finished_at
     FROM playwright_scans WHERE id = $1`,
    [scanId],
  );

  if (scanQ.rows.length === 0) {
    return NextResponse.json({ error: 'scan not found' }, { status: 404 });
  }

  return NextResponse.json(scanQ.rows[0]);
}

// DELETE — cancel a running scan
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const scanId = Number(searchParams.get('scanId'));

  if (!Number.isFinite(scanId) || scanId <= 0) {
    return NextResponse.json({ error: 'scanId query param required' }, { status: 400 });
  }

  await query(
    `UPDATE playwright_scans SET status = 'cancelled', finished_at = NOW()
     WHERE id = $1 AND status = 'running'`,
    [scanId],
  );

  return NextResponse.json({ ok: true });
}
