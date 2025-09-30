// app/api/scans/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const scanId = Number(params.id);
    if (!Number.isFinite(scanId) || scanId <= 0) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    // Ensure scan exists
    const s = await sql<{ id: number; scanned_at: string; fixed_checkout: string; start_offset: number; end_offset: number; timezone: string }>`
      SELECT id, scanned_at, fixed_checkout, start_offset, end_offset, timezone
      FROM scans
      WHERE id = ${scanId}
    `;
    if (s.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const scan = s.rows[0];

    // Fetch hotels and results
    const hotels = (await sql<{ id:number; name:string; code:string }>`
      SELECT id, name, code FROM hotels ORDER BY id ASC
    `).rows;

    const rows = (await sql<{ hotel_id:number; check_in_date: string | Date; status: 'green'|'red' }>`
      SELECT hotel_id, check_in_date, status
      FROM scan_results
      WHERE scan_id = ${scanId}
      ORDER BY hotel_id, check_in_date
    `).rows;

    // Build results matrix: { [hotelCode]: { [YYYY-MM-DD]: 'green'|'red' } }
    const results: Record<string, Record<string, 'green'|'red'>> = {};
    const datesSet = new Set<string>();

    for (const h of hotels) results[h.code] = {};

    for (const row of rows) {
      const h = hotels.find(x => x.id === row.hotel_id);
      if (!h) continue;

      let d: string;
      if (typeof row.check_in_date === 'string') {
        // Expect 'YYYY-MM-DD'
        d = row.check_in_date.slice(0, 10);
      } else {
        const dt = row.check_in_date as Date;
        const y = dt.getUTCFullYear();
        const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
        const day = String(dt.getUTCDate()).padStart(2, '0');
        d = `${y}-${m}-${day}`;
      }
      datesSet.add(d);
      results[h.code][d] = row.status;
    }

    const dates = Array.from(datesSet).sort();
    return NextResponse.json({
      scanId,
      scannedAt: scan.scanned_at,
      fixedCheckout: scan.fixed_checkout,
      dates,
      results,
    });
  } catch (err: any) {
    console.error('[GET /api/scans/[id]] error:', err);
    return NextResponse.json({ error: 'Failed to load scan' }, { status: 500 });
  }
}
