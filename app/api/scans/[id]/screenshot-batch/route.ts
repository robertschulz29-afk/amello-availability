// app/api/scans/[id]/screenshot-batch/route.ts
// Sequentially captures screenshots for every hotel in a scan.

import { NextRequest, NextResponse } from 'next/server';
import { sql, query } from '@/lib/db';
import { captureAndStoreScreenshot } from '@/lib/screenshot';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const scanId = Number(params.id);
  if (!Number.isFinite(scanId) || scanId <= 0) {
    return NextResponse.json({ error: 'invalid scan id' }, { status: 400 });
  }

  // Fetch scan dates
  const scanQ = await sql<{
    base_checkin: string;
    fixed_checkout: string;
  }>`
    SELECT base_checkin::text AS base_checkin, fixed_checkout::text AS fixed_checkout
    FROM scans
    WHERE id = ${scanId}
  `;

  if (scanQ.rows.length === 0) {
    return NextResponse.json({ error: 'scan not found' }, { status: 404 });
  }

  const { base_checkin: checkInDate, fixed_checkout: checkOutDate } = scanQ.rows[0];

  // Fetch hotels snapshotted for this scan
  const hotelsQ = await query<{ id: number; code: string }>(
    `SELECT hotel_id AS id, code
     FROM scan_hotels
     WHERE scan_id = $1 AND bookable = true AND active = true
     ORDER BY code`,
    [scanId],
  );

  const hotels = hotelsQ.rows;
  let processed = 0;
  let errors = 0;

  for (const hotel of hotels) {
    try {
      await captureAndStoreScreenshot({
        hotelCode: hotel.code,
        hotelId: hotel.id,
        scanId,
        checkInDate,
        checkOutDate,
      });
      processed++;
    } catch (e: any) {
      console.error(
        `[screenshot-batch] scan=${scanId} hotel=${hotel.code} error:`,
        e?.message ?? e,
      );
      errors++;
    }
  }

  console.log(`[screenshot-batch] scan=${scanId} done — processed=${processed} errors=${errors}`);
  return NextResponse.json({ processed, errors });
}
