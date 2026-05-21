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

  const scanQ = await sql`
    SELECT fixed_checkout::text AS fixed_checkout
    FROM scans WHERE id = ${scanId}
  `;
  if (scanQ.rows.length === 0) {
    return NextResponse.json({ error: 'scan not found' }, { status: 404 });
  }
  const { fixed_checkout: checkOutDate } = scanQ.rows[0];

  // One row per hotel: pick a green amello result's check_in_date; skip hotels with none.
  const hotelsQ = await query<{ hotel_id: number; code: string; check_in_date: string }>(
    `SELECT sr.hotel_id, sh.code,
            MIN(sr.check_in_date)::text AS check_in_date
     FROM scan_results sr
     JOIN scan_hotels sh ON sh.scan_id = sr.scan_id AND sh.hotel_id = sr.hotel_id
     WHERE sr.scan_id = $1
       AND sr.source  = 'amello'
       AND sr.status  = 'green'
     GROUP BY sr.hotel_id, sh.code
     ORDER BY sh.code`,
    [scanId],
  );

  const hotels = hotelsQ.rows;
  let processed = 0;
  let errors = 0;

  for (const hotel of hotels) {
    try {
      await captureAndStoreScreenshot({
        hotelCode: hotel.code,
        hotelId: hotel.hotel_id,
        scanId,
        checkInDate: hotel.check_in_date,
        checkOutDate,
      });
      processed++;
    } catch (e: any) {
      console.error(`[screenshot-batch] scan=${scanId} hotel=${hotel.code} error:`, e?.message ?? e);
      errors++;
    }
  }

  console.log(`[screenshot-batch] scan=${scanId} done — processed=${processed} skipped=${hotelsQ.rows.length - processed - errors} errors=${errors}`);
  return NextResponse.json({ processed, errors, total: hotels.length });
}
