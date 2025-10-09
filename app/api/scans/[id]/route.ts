import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeDateToYMD(d: any): string {
  if (d instanceof Date) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  const s = String(d ?? '');
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const scanId = Number(params.id);
  if (!Number.isFinite(scanId) || scanId <= 0) {
    return NextResponse.json({ error: 'invalid scan id' }, { status: 400 });
  }

  try {
    const scanQ = await sql`
      SELECT id, scanned_at, base_checkin, days, stay_nights, timezone, total_cells, done_cells, status
      FROM scans WHERE id=${scanId}
    `;
    if (scanQ.rows.length === 0) return NextResponse.json({ error: 'scan not found' }, { status: 404 });
    const scan = scanQ.rows[0];

    const hotelsQ = await sql`SELECT id, name, code, brand, region, country FROM hotels ORDER BY id ASC`;
    const hotels = hotelsQ.rows as Array<{ id:number; name:string; code:string; brand?:string|null; region?:string|null; country?:string|null }>;
    const hotelById = new Map<number, (typeof hotels)[number]>();
    for (const h of hotels) hotelById.set(h.id, h);

    const rowsQ = await sql`
      SELECT hotel_id, check_in_date, status
      FROM scan_results
      WHERE scan_id = ${scanId}
    `;
    const rows = rowsQ.rows as Array<{ hotel_id:number; check_in_date:any; status:string }>;

    const datesSet = new Set<string>();
    const results: Record<string, Record<string, 'green'|'red'>> = {};
    for (const row of rows) {
      const hotel = hotelById.get(row.hotel_id);
      if (!hotel) continue;
      const code = hotel.code;
      const checkIn = normalizeDateToYMD(row.check_in_date);
      datesSet.add(checkIn);
      (results[code] ||= {})[checkIn] = row.status === 'green' ? 'green' : 'red';
    }
    const dates = Array.from(datesSet).sort();
    for (const h of hotels) if (!results[h.code]) results[h.code] = {};

    return NextResponse.json({
      scanId: scan.id,
      scannedAt: scan.scanned_at,
      baseCheckIn: scan.base_checkin,
      days: scan.days,
      stayNights: scan.stay_nights,
      timezone: scan.timezone,
      totalCells: scan.total_cells ?? null,
      doneCells: scan.done_cells ?? null,
      status: scan.status ?? null,
      dates,
      results,
    });
  } catch (err:any) {
    console.error('[GET /api/scans/[id]] error', err);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
