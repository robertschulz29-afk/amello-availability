// app/api/rooms-cr-api/route.ts
// Returns screenshot + room imagery data for the Rooms/CR-API page.

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const scanId = Number(searchParams.get('scanId'));
  const hotelId = Number(searchParams.get('hotelId'));

  if (!Number.isFinite(scanId) || scanId <= 0) {
    return NextResponse.json({ error: 'invalid scanId' }, { status: 400 });
  }
  if (!Number.isFinite(hotelId) || hotelId <= 0) {
    return NextResponse.json({ error: 'invalid hotelId' }, { status: 400 });
  }

  try {
    const [screenshotQ, imageryQ] = await Promise.all([
      query<{ screenshot_url: string }>(
        `SELECT screenshot_url FROM scan_screenshots WHERE scan_id = $1 AND hotel_id = $2 LIMIT 1`,
        [scanId, hotelId],
      ),
      query<{ room_name: string; image_url: string }>(
        `SELECT room_name, image_url FROM room_imagery WHERE hotel_id = $1 ORDER BY room_name`,
        [hotelId],
      ),
    ]);

    const screenshot =
      screenshotQ.rows.length > 0
        ? { url: screenshotQ.rows[0].screenshot_url }
        : null;

    return NextResponse.json({
      screenshot,
      roomImagery: imageryQ.rows,
    });
  } catch (e: any) {
    console.error('[GET /api/rooms-cr-api] error', e);
    return NextResponse.json({ error: e.message || 'failed to load data' }, { status: 500 });
  }
}
