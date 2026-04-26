import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Returns hotels for a scan ordered by name.
// Prefers scan_hotels snapshot (all hotels at scan time); falls back to distinct scan_results.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const scanIDParam = searchParams.get('scanID');
    const hotelIDParam = searchParams.get('hotelID');

    if (!scanIDParam) return NextResponse.json({ error: 'scanID required' }, { status: 400 });
    const scanID = parseInt(scanIDParam, 10);

    const hotelIDs = hotelIDParam
      ? hotelIDParam.split(',').map(s => parseInt(s.trim(), 10)).filter(n => isFinite(n))
      : [];

    // Check if scan_hotels snapshot exists for this scan
    const snapCheck = await query(
      `SELECT 1 FROM scan_hotels WHERE scan_id = $1 LIMIT 1`,
      [scanID],
    );

    let rows: { hotel_id: number; hotel_name: string }[];

    if (snapCheck.rows.length > 0) {
      // Use snapshot — returns all hotels at scan time
      const conditions = [`scan_id = $1`];
      const params: (number | string)[] = [scanID];
      if (hotelIDs.length === 1) {
        conditions.push(`hotel_id = $2`);
        params.push(hotelIDs[0]);
      } else if (hotelIDs.length > 1) {
        const ph = hotelIDs.map((_, i) => `$${i + 2}`).join(', ');
        conditions.push(`hotel_id IN (${ph})`);
        params.push(...hotelIDs);
      }
      conditions.push(`bookable = true`, `active = true`);
      const res = await query(
        `SELECT hotel_id, name AS hotel_name FROM scan_hotels
         WHERE ${conditions.join(' AND ')} ORDER BY hotel_name`,
        params,
      );
      rows = res.rows;
    } else {
      // Fallback: distinct hotels from scan_results
      const conditions = [`sr.scan_id = $1`];
      const params: (number | string)[] = [scanID];
      if (hotelIDs.length === 1) {
        conditions.push(`sr.hotel_id = $2`);
        params.push(hotelIDs[0]);
      } else if (hotelIDs.length > 1) {
        const ph = hotelIDs.map((_, i) => `$${i + 2}`).join(', ');
        conditions.push(`sr.hotel_id IN (${ph})`);
        params.push(...hotelIDs);
      }
      conditions.push(`h.bookable = true`, `h.active = true`);
      const res = await query(
        `SELECT DISTINCT sr.hotel_id, COALESCE(h.name, 'Hotel ' || sr.hotel_id) AS hotel_name
         FROM scan_results sr LEFT JOIN hotels h ON h.id = sr.hotel_id
         WHERE ${conditions.join(' AND ')} ORDER BY hotel_name`,
        params,
      );
      rows = res.rows;
    }

    return NextResponse.json(rows);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
