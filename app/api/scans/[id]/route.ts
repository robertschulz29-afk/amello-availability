import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { normalizeYMD } from '@/lib/scrapers/process-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const scanId = Number(params.id);
  if (!Number.isFinite(scanId) || scanId <= 0) {
    return NextResponse.json({ error: 'invalid scan id' }, { status: 400 });
  }

  try {
    const scanQ = await sql`
      SELECT
        id,
        scanned_at,
        base_checkin::text as base_checkin,
        days,
        stay_nights,
        timezone,
        total_cells,
        done_cells,
        status,
        fixed_checkout::text as fixed_checkout
      FROM scans
      WHERE id=${scanId}
    `;
    if (scanQ.rows.length === 0) return NextResponse.json({ error: 'scan not found' }, { status: 404 });
    const scan = scanQ.rows[0];

    const hotelsQ = await sql`
      SELECT id, name, code, brand, region, country
      FROM hotels
      ORDER BY id ASC
    `;
    const hotels = hotelsQ.rows as Array<{
      id: number; name: string; code: string; brand?: string | null; region?: string | null; country?: string | null
    }>;
    const hotelById = new Map<number, (typeof hotels)[number]>();
    for (const h of hotels) hotelById.set(h.id, h);

    const rowsQ = await sql`
      SELECT hotel_id, check_in_date::text as check_in_date, status, response_json, source
      FROM scan_results
      WHERE scan_id = ${scanId}
    `;
    const rows = rowsQ.rows as Array<{ hotel_id: number; check_in_date: any; status: string; source: string; response_json: any }>;

    const fullSet: Array<{
      scan_id: number;
      hotel_id: number;
      hotel_name: string;
      check_in_date: string;
      status: string;
      source: string;
      response_json: any;
    }> = [];

    for (const row of rows) {
      const hotel = hotelById.get(row.hotel_id);
      if (!hotel) continue;
      const checkIn = normalizeYMD(row.check_in_date) ?? '';

      fullSet.push({
        scan_id: scanId,
        hotel_id: row.hotel_id,
        hotel_name: hotel.name,
        check_in_date: checkIn,
        status: row.status,
        source: row.source,
        response_json: row.source === 'amello' ? row.response_json : null,
      });
    }

    return NextResponse.json({
      // identity
      scanId: scan.id,
      scannedAt: scan.scanned_at,

      // parameters
      baseCheckIn: scan.base_checkin ? (normalizeYMD(scan.base_checkin) ?? '') : null,
      fixedCheckout: scan.fixed_checkout ? (normalizeYMD(scan.fixed_checkout) ?? '') : null,
      days: scan.days ?? null,
      stayNights: scan.stay_nights ?? null,
      timezone: scan.timezone ?? null,

      // progress
      totalCells: scan.total_cells ?? null,
      doneCells: scan.done_cells ?? null,
      status: scan.status ?? null,

      // full raw data
      fullSet,
    });
  } catch (err: any) {
    console.error('[GET /api/scans/[id]] error', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
