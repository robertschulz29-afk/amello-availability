import { NextRequest, NextResponse } from 'next/server';
import { sql, query } from '@/lib/db';
import { captureAndStoreScreenshot } from '@/lib/screenshot';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const scanId = Number(params.id);
  if (!Number.isFinite(scanId) || scanId <= 0) {
    return NextResponse.json({ error: 'invalid scan id' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const offset = Number.isFinite(body?.offset) && body.offset >= 0 ? Number(body.offset) : 0;
  const limit = Math.max(1, Math.min(10, Number.isFinite(body?.limit) ? Number(body.limit) : 3));

  const scanQ = await sql`
    SELECT fixed_checkout::text AS fixed_checkout
    FROM scans WHERE id = ${scanId}
  `;
  if (scanQ.rows.length === 0) {
    return NextResponse.json({ error: 'scan not found' }, { status: 404 });
  }
  const { fixed_checkout: checkOutDate } = scanQ.rows[0];

  // All hotels in the scan snapshot. For each, pick a green amello date if one exists,
  // otherwise any amello date, otherwise fall back to the scan's base_checkin.
  const hotelsQ = await query<{ hotel_id: number; code: string; check_in_date: string }>(
    `SELECT sh.hotel_id, sh.code,
            COALESCE(
              MIN(sr_green.check_in_date)::text,
              MIN(sr_any.check_in_date)::text,
              s.base_checkin::text
            ) AS check_in_date
     FROM scan_hotels sh
     JOIN scans s ON s.id = sh.scan_id
     LEFT JOIN scan_results sr_green
            ON sr_green.scan_id = sh.scan_id
           AND sr_green.hotel_id = sh.hotel_id
           AND sr_green.source   = 'amello'
           AND sr_green.status   = 'green'
     LEFT JOIN scan_results sr_any
            ON sr_any.scan_id = sh.scan_id
           AND sr_any.hotel_id = sh.hotel_id
           AND sr_any.source   = 'amello'
     WHERE sh.scan_id = $1
     GROUP BY sh.hotel_id, sh.code, s.base_checkin
     ORDER BY sh.code`,
    [scanId],
  );

  // Filter out hotels that already have a screenshot for this scan
  const existingQ = await query<{ hotel_id: number }>(
    `SELECT hotel_id FROM scan_screenshots WHERE scan_id = $1`,
    [scanId],
  );
  const existingIds = new Set(existingQ.rows.map(r => r.hotel_id));
  const pending = hotelsQ.rows.filter(h => !existingIds.has(h.hotel_id));

  const total = pending.length;
  const slice = pending.slice(offset, offset + limit);
  let processed = 0;
  let errors = 0;

  for (const hotel of slice) {
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

  const nextOffset = offset + slice.length;
  const hasMore = nextOffset < total;

  console.log(`[screenshot-batch] scan=${scanId} offset=${offset} processed=${processed} errors=${errors} hasMore=${hasMore}`);
  return NextResponse.json({ processed, errors, total, nextOffset, hasMore });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const scanId = Number(params.id);
  if (!Number.isFinite(scanId) || scanId <= 0) {
    return NextResponse.json({ error: 'invalid scan id' }, { status: 400 });
  }

  // Load existing screenshot paths before deleting DB rows
  const existingQ = await query<{ hotel_code: string }>(
    `SELECT hotel_code FROM scan_screenshots WHERE scan_id = $1`,
    [scanId],
  );
  const storagePaths = existingQ.rows.map(r => `scan-${scanId}/${r.hotel_code}.jpg`);

  // Delete DB rows
  await query(`DELETE FROM scan_screenshots WHERE scan_id = $1`, [scanId]);

  // Delete Storage files (best-effort — don't fail if some are missing)
  if (storagePaths.length > 0) {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    await supabase.storage.from('scan-screenshots').remove(storagePaths);
  }

  console.log(`[screenshot-batch] DELETE scan=${scanId} removed=${storagePaths.length}`);
  return NextResponse.json({ deleted: storagePaths.length });
}
