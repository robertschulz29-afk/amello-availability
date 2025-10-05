// app/api/scans/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeDateToYMD(d: any): string {
  // Accept Date object, string, or postgres date
  if (!d && d !== 0) return String(d);
  if (d instanceof Date) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  // If the DB driver returns a string like '2025-10-07T00:00:00.000Z' or '2025-10-07'
  const s = String(d);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const scanId = Number(params.id);
  if (!Number.isFinite(scanId) || scanId <= 0) {
    return NextResponse.json({ error: 'invalid scan id' }, { status: 400 });
  }

  try {
    // Load scan header
    const scanQ = await sql`
      SELECT id, scanned_at, fixed_checkout, start_offset, end_offset, stay_nights, timezone, total_cells, done_cells, status
      FROM scans
      WHERE id = ${scanId}
    `;
    if (scanQ.rows.length === 0) {
      return NextResponse.json({ error: 'scan not found' }, { status: 404 });
    }
    const scan = scanQ.rows[0];

    // Load hotels (id, name, code)
    const hotelsQ = await sql`
      SELECT id, name, code FROM hotels ORDER BY id ASC
    `;
    const hotels = hotelsQ.rows as Array<{ id: number; name: string; code: string }>;
    const hotelById = new Map<number, { id: number; name: string; code: string }>();
    for (const h of hotels) hotelById.set(h.id, h);

    // Load scan_results (no response_json to keep payload small)
    const rowsQ = await sql`
      SELECT hotel_id, check_in_date, status
      FROM scan_results
      WHERE scan_id = ${scanId}
    `;
    const rows = rowsQ.rows as Array<{ hotel_id: number; check_in_date: any; status: string }>;

    // Build dates set and results map
    const datesSet = new Set<string>();
    const results: Record<string, Record<string, 'green' | 'red'>> = {};

    for (const row of rows) {
      const hotel = hotelById.get(row.hotel_id);
      if (!hotel) continue;
      const hotelCode = hotel.code;
      const checkIn = normalizeDateToYMD(row.check_in_date);
      datesSet.add(checkIn);
      results[hotelCode] = results[hotelCode] || {};
      results[hotelCode][checkIn] = row.status === 'green' ? 'green' : 'red';
    }

    // Sort dates ascending
    const dates = Array.from(datesSet).sort();

    // Ensure hotels with no results are present (optional)
    for (const h of hotels) {
      if (!results[h.code]) results[h.code] = {};
    }

    const resp = {
      scanId: scan.id,
      scannedAt: scan.scanned_at,
      startOffset: scan.start_offset,
      endOffset: scan.end_offset,
      stayNights: scan.stay_nights,
      timezone: scan.timezone,
      totalCells: scan.total_cells ?? null,
      doneCells: scan.done_cells ?? null,
      status: scan.status ?? null,
      dates,
      results,
    };

    return NextResponse.json(resp);
  } catch (err: any) {
    console.error('[GET /api/scans/[id]] error', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
